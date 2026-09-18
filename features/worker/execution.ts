/**
 * Cleaner execution contracts (Change 7, tasks 3/4/5; design §4–§6).
 *
 * Worker-owned server-authoritative execution surface over the Change 6
 * job lifecycle. Every contract:
 *   - authenticates via the cleaner resolution chain (§4 — Supabase user
 *     → employees.user_id → ACTIVE employee → branch authorization →
 *     own ACTIVE assignment → job; fail-closed on every step);
 *   - enforces the server-side transition matrix (BD-C2, incl. the
 *     permitted direct assigned → checked_in path and optional en_route);
 *   - mutates in ONE transaction with the job row locked (§5, TD-W7
 *     pattern — concurrent transitions serialize, exactly one wins);
 *   - writes append-only job events + fail-closed audit via the existing
 *     Change 6 writers (no second event/audit engine);
 *   - returns the authoritative post-state (stale-state echo); repeating
 *     an already-applied transition is an idempotent success no-op.
 *
 * Cleaner routes/actions hold ZERO business logic (API_STANDARDS §4) —
 * they only call these functions. No Booking table is ever written here;
 * completion invokes the Booking-owned contract post-commit (BD-C9).
 * No GPS/location data is accepted or stored anywhere (BD-C6); no
 * signature artifacts exist (BD-C8).
 */
import "server-only";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { workerError, WorkerErrorCode, type CompletionGateDetail } from "./errors";
import { writeJobEvent, auditWorker } from "./events";
import { insertIncident, type IncidentRow } from "./incidents";
import { applyJobDerivedBookingTransition } from "@/features/booking/workerContract";

// ---------------------------------------------------------------------------
// §4 Cleaner session context (fail-closed resolution chain)
// ---------------------------------------------------------------------------

export interface CleanerContext {
  userId: string;
  employeeId: string;
  organizationId: string;
  /** Branch ids the employee is operationally authorized for (BD-W1 M2M). */
  branchIds: string[];
}

/**
 * Resolve the authenticated Supabase user to an ACTIVE employee with
 * branch authorization. Denies (stable fail-closed errors) when:
 * unauthenticated (caller's getAuthenticatedUserId), no linked employee,
 * employee not active, or no branch authorization rows. Application role
 * stays distinct from employment (BD-W12); deactivation blocks execution
 * immediately while history rows remain.
 */
export async function resolveCleanerContext(userId: string): Promise<CleanerContext> {
  const res = await query<{
    id: string;
    organization_id: string;
    status: string;
    branch_ids: string[] | null;
  }>(
    `select e.id, e.organization_id, e.status,
            (select coalesce(array_agg(eb.branch_id), '{}')
             from public.employee_branches eb where eb.employee_id = e.id) as branch_ids
     from public.employees e
     where e.user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) throw workerError(WorkerErrorCode.NO_ACTIVE_ASSIGNMENT, { reason: "no_employee_link" });
  if (row.status !== "active") throw workerError(WorkerErrorCode.EMPLOYEE_INACTIVE);
  if (!row.branch_ids || row.branch_ids.length === 0) {
    throw workerError(WorkerErrorCode.NO_ACTIVE_ASSIGNMENT, { reason: "no_branch_authorization" });
  }
  return {
    userId,
    employeeId: row.id,
    organizationId: row.organization_id,
    branchIds: row.branch_ids,
  };
}

/** Job columns the execution surface reads (server-side only). */
export interface ExecutionJobRow {
  id: string;
  organization_id: string;
  branch_id: string;
  booking_id: string | null;
  job_number: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  en_route_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  actual_start: string | null;
  actual_end: string | null;
  completed_at: string | null;
}

const EXECUTION_COLUMNS = `id, organization_id, branch_id, booking_id, job_number, status,
  scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end, timezone,
  en_route_at::text as en_route_at, checked_in_at::text as checked_in_at,
  checked_out_at::text as checked_out_at, actual_start::text as actual_start,
  actual_end::text as actual_end, completed_at::text as completed_at`;

/**
 * Require that the cleaner holds the job's single active assignment.
 * Fail-closed: no active assignment (or branch authorization mismatch)
 * denies every operation. This is the application-layer half of the
 * cleaner boundary — RLS (0013/0012 policies) is the second.
 */
async function requireActiveAssignment(
  cleaner: CleanerContext,
  client: { query: TransactionClient["query"] },
  jobId: string,
): Promise<ExecutionJobRow> {
  const res = await client.query<ExecutionJobRow & { employee_id: string }>(
    `select j.id, j.organization_id, j.branch_id, j.booking_id, j.job_number, j.status,
            j.scheduled_start::text as scheduled_start, j.scheduled_end::text as scheduled_end,
            j.timezone, j.en_route_at::text as en_route_at, j.checked_in_at::text as checked_in_at,
            j.checked_out_at::text as checked_out_at, j.actual_start::text as actual_start,
            j.actual_end::text as actual_end, j.completed_at::text as completed_at,
            ja.employee_id
     from public.jobs j
     join public.job_assignments ja on ja.job_id = j.id
     where j.id = $1 and ja.employee_id = $2 and ja.assignment_status = 'active'
     for update of j`,
    [jobId, cleaner.employeeId],
  );
  const job = res.rows[0];
  if (!job) throw workerError(WorkerErrorCode.NOT_ASSIGNED_CLEANER, { job_id: jobId });
  if (job.organization_id !== cleaner.organizationId || !cleaner.branchIds.includes(job.branch_id)) {
    throw workerError(WorkerErrorCode.NOT_ASSIGNED_CLEANER, { job_id: jobId });
  }
  return job;
}

/**
 * Replay serialization key (design §8): the offline queue replays actions
 * for the same job strictly in creation order. Within one process the
 * per-job promise chain provides the same ordering for double-taps /
 * racing devices, so identical idempotent actions commit exactly once.
 */
const jobActionChains = new Map<string, Promise<unknown>>();
function serializeJobAction<T>(jobKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = jobActionChains.get(jobKey) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  jobActionChains.set(
    jobKey,
    next.catch(() => undefined),
  );
  return next;
}

// ---------------------------------------------------------------------------
// §5 Transition matrix — cleaner-triggered, server-authoritative (BD-C2)
// ---------------------------------------------------------------------------

/** assigned → en_route (optional; records en_route_at; idempotent). */
export async function cleanerEnRoute(userId: string, jobId: string): Promise<ExecutionJobRow> {
  const cleaner = await resolveCleanerContext(userId);
  return serializeJobAction(`${cleaner.organizationId}:${jobId}`, () => withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, jobId);
    if (job.status === "en_route") return job; // idempotent no-op
    if (job.status !== "assigned") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status, to: "en_route" });
    }
    const res = await tx.query<ExecutionJobRow>(
      `update public.jobs set status = 'en_route', en_route_at = now(), updated_at = now()
       where id = $1 returning ${EXECUTION_COLUMNS}`,
      [jobId],
    );
    await writeJobEvent(
      { organizationId: job.organization_id, branchId: job.branch_id, jobId, eventType: "en_route", actorType: "staff", actorUserId: userId },
      tx,
    );
    await auditWorker(tx, {
      action: "job.en_route",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: userId,
      requestId: null,
      metadata: { job_number: job.job_number },
    });
    return res.rows[0];
  }));
}

/**
 * assigned/en_route → checked_in (direct path explicitly permitted —
 * BD-C2; no artificial en_route blocking). Records checked_in_at and
 * actual_start; ensures the checklist snapshot exists (§ checklist).
 */
export async function cleanerCheckIn(userId: string, jobId: string): Promise<ExecutionJobRow> {
  const cleaner = await resolveCleanerContext(userId);
  return serializeJobAction(`${cleaner.organizationId}:${jobId}`, () => withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, jobId);
    if (job.status === "checked_in" || job.status === "in_progress") return job; // idempotent no-op
    if (job.status !== "assigned" && job.status !== "en_route") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status, to: "checked_in" });
    }
    const res = await tx.query<ExecutionJobRow>(
      `update public.jobs
       set status = 'checked_in', checked_in_at = now(), actual_start = now(), updated_at = now()
       where id = $1 returning ${EXECUTION_COLUMNS}`,
      [jobId],
    );
    await ensureChecklistSnapshotTx(tx, job);
    await writeJobEvent(
      { organizationId: job.organization_id, branchId: job.branch_id, jobId, eventType: "check_in", actorType: "staff", actorUserId: userId },
      tx,
    );
    await auditWorker(tx, {
      action: "job.check_in",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: userId,
      requestId: null,
      metadata: { job_number: job.job_number },
    });
    return res.rows[0];
  }));
}

/** checked_in → in_progress (start work). */
export async function cleanerStartWork(userId: string, jobId: string): Promise<ExecutionJobRow> {
  const cleaner = await resolveCleanerContext(userId);
  return serializeJobAction(`${cleaner.organizationId}:${jobId}`, () => withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, jobId);
    if (job.status === "in_progress") return job; // idempotent no-op
    if (job.status !== "checked_in") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status, to: "in_progress" });
    }
    const res = await tx.query<ExecutionJobRow>(
      `update public.jobs set status = 'in_progress', updated_at = now()
       where id = $1 returning ${EXECUTION_COLUMNS}`,
      [jobId],
    );
    await writeJobEvent(
      { organizationId: job.organization_id, branchId: job.branch_id, jobId, eventType: "job_started", actorType: "staff", actorUserId: userId },
      tx,
    );
    await auditWorker(tx, {
      action: "job.started",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: userId,
      requestId: null,
      metadata: { job_number: job.job_number },
    });
    return res.rows[0];
  }));
}

/**
 * Checkout: records checked_out_at + actual_end. Checkout precedes but
 * does NOT perform completion (design §5); allowed from checked_in or
 * in_progress; repeat is an idempotent no-op.
 */
export async function cleanerCheckOut(userId: string, jobId: string): Promise<ExecutionJobRow> {
  const cleaner = await resolveCleanerContext(userId);
  return serializeJobAction(`${cleaner.organizationId}:${jobId}`, () => withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, jobId);
    if (job.checked_out_at) return job; // idempotent no-op
    if (job.status !== "checked_in" && job.status !== "in_progress") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status, to: "checkout" });
    }
    const res = await tx.query<ExecutionJobRow>(
      `update public.jobs set checked_out_at = now(), actual_end = now(), updated_at = now()
       where id = $1 returning ${EXECUTION_COLUMNS}`,
      [jobId],
    );
    await writeJobEvent(
      { organizationId: job.organization_id, branchId: job.branch_id, jobId, eventType: "check_out", actorType: "staff", actorUserId: userId },
      tx,
    );
    await auditWorker(tx, {
      action: "job.check_out",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: userId,
      requestId: null,
      metadata: { job_number: job.job_number },
    });
    return res.rows[0];
  }));
}

// ---------------------------------------------------------------------------
// Checklist (BD-C3; design §3.2–3.4)
// ---------------------------------------------------------------------------

export interface ChecklistSnapshotRow {
  id: string;
  job_id: string;
  template_id: string | null;
  template_version: number;
  snapshot: Array<{ key: string; label: string; mandatory: boolean; sort_order: number }>;
}

export interface ChecklistItemRow {
  id: string;
  job_id: string;
  item_key: string;
  label: string;
  mandatory: boolean;
  sort_order: number;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
}

/**
 * Copy the published checklist template (branch override wins over the
 * org-wide default) into the job's immutable snapshot + items. No-op when
 * a snapshot already exists (idempotent — the snapshot is created at the
 * first execution action). Historical structure never mutates afterwards.
 */
export async function ensureChecklistSnapshotTx(
  tx: TransactionClient,
  job: { id: string; organization_id: string; branch_id: string },
): Promise<ChecklistSnapshotRow | null> {
  const existing = await tx.query<{ id: string }>(
    `select id from public.job_checklist_snapshots where job_id = $1`,
    [job.id],
  );
  if (existing.rows[0]) return null;

  // The job's service identity: snapshot labels survive catalog edits, so
  // resolve the service through booking_items (kind='service', Change 5).
  const svc = await tx.query<{ service_id: string | null }>(
    `select bi.service_id
     from public.jobs j
     join public.booking_items bi on bi.booking_id = j.booking_id and bi.kind = 'service'
     where j.id = $1`,
    [job.id],
  );
  const serviceId = svc.rows[0]?.service_id ?? null;
  if (!serviceId) return null; // internal job without a service — no template

  const tpl = await tx.query<{
    id: string;
    version: number;
    items: Array<{ key: string; label: string; mandatory: boolean; sort_order: number }>;
  }>(
    `select id, version, items
     from public.checklist_templates
     where organization_id = $1 and service_id = $2 and status = 'published'
       and (branch_id = $3 or branch_id is null)
     order by (branch_id = $3) desc, version desc
     limit 1`,
    [job.organization_id, serviceId, job.branch_id],
  );
  const template = tpl.rows[0];
  if (!template || !Array.isArray(template.items) || template.items.length === 0) return null;

  const snapRes = await tx.query<{ id: string }>(
    `insert into public.job_checklist_snapshots
       (organization_id, branch_id, job_id, template_id, template_version, service_id, snapshot)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (job_id) do nothing
     returning id`,
    [
      job.organization_id,
      job.branch_id,
      job.id,
      template.id,
      template.version,
      serviceId,
      JSON.stringify(template.items),
    ],
  );
  const snapshotId = snapRes.rows[0]?.id;
  if (!snapshotId) return null; // concurrent snapshot creation won — idempotent no-op

  const items = template.items
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const item of items) {
    await tx.query(
      `insert into public.job_checklist_items
         (organization_id, branch_id, job_id, snapshot_id, item_key, label, mandatory, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (job_id, item_key) do nothing`,
      [job.organization_id, job.branch_id, job.id, snapshotId, item.key, item.label, item.mandatory ?? false, item.sort_order ?? 0],
    );
  }
  return {
    id: snapshotId,
    job_id: job.id,
    template_id: template.id,
    template_version: template.version,
    snapshot: items,
  };
}

/** Read the job's checklist (items ordered; cleaner-safe field set). */
export async function getJobChecklist(jobId: string): Promise<{ snapshot: ChecklistSnapshotRow | null; items: ChecklistItemRow[] }> {
  const snap = await query<{ id: string; job_id: string; template_id: string | null; template_version: number; snapshot: ChecklistSnapshotRow["snapshot"] }>(
    `select id, job_id, template_id, template_version, snapshot
     from public.job_checklist_snapshots where job_id = $1`,
    [jobId],
  );
  const items = await query<ChecklistItemRow>(
    `select id, job_id, item_key, label, mandatory, sort_order, status,
            completed_at::text as completed_at, completed_by, notes
     from public.job_checklist_items where job_id = $1 order by sort_order, item_key`,
    [jobId],
  );
  return {
    snapshot: snap.rows[0]
      ? { id: snap.rows[0].id, job_id: snap.rows[0].job_id, template_id: snap.rows[0].template_id, template_version: snap.rows[0].template_version, snapshot: snap.rows[0].snapshot }
      : null,
    items: items.rows,
  };
}

/**
 * Complete a checklist item (pending → completed, with optional notes).
 * Provenance: completed_at/completed_by recorded; idempotent on repeat;
 * rejected once the job is terminal (immutable execution history).
 */
export async function completeChecklistItem(
  userId: string,
  input: { job_id: string; item_id: string; notes?: string | null },
): Promise<ChecklistItemRow> {
  const cleaner = await resolveCleanerContext(userId);
  return serializeJobAction(`${cleaner.organizationId}:${input.job_id}`, () => withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, input.job_id);
    if (job.status === "completed" || job.status === "cancelled") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status });
    }
    const itemRes = await tx.query<ChecklistItemRow>(
      `select id, job_id, item_key, label, mandatory, sort_order, status,
              completed_at::text as completed_at, completed_by, notes
       from public.job_checklist_items where id = $1 and job_id = $2 for update`,
      [input.item_id, input.job_id],
    );
    const item = itemRes.rows[0];
    if (!item) throw workerError(WorkerErrorCode.CHECKLIST_ITEM_NOT_FOUND);
    if (item.status === "completed") return item; // idempotent no-op

    const res = await tx.query<ChecklistItemRow>(
      `update public.job_checklist_items
       set status = 'completed', completed_at = now(), completed_by = $2,
           notes = coalesce($3, notes), updated_at = now()
       where id = $1
       returning id, job_id, item_key, label, mandatory, sort_order, status,
                 completed_at::text as completed_at, completed_by, notes`,
      [input.item_id, userId, input.notes ?? null],
    );

    // Event when the LAST mandatory item completes (bounded payload, TD-W8).
    const pendingMandatory = await tx.query<{ n: string }>(
      `select count(*)::text as n from public.job_checklist_items
       where job_id = $1 and mandatory = true and status = 'pending'`,
      [input.job_id],
    );
    if (Number(pendingMandatory.rows[0].n) === 0) {
      await writeJobEvent(
        {
          organizationId: job.organization_id,
          branchId: job.branch_id,
          jobId: input.job_id,
          eventType: "checklist_completed",
          metadata: { all_mandatory_complete: true },
          actorType: "staff",
          actorUserId: userId,
        },
        tx,
      );
    }
    await auditWorker(tx, {
      action: "job.checklist_item_completed",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "job_checklist_items",
      resourceId: input.item_id,
      actorUserId: userId,
      requestId: null,
      metadata: { job_id: input.job_id, item_key: item.item_key },
    });
    return res.rows[0];
  }));
}

// ---------------------------------------------------------------------------
// Incidents (BD-C9/§6 — via the EXISTING Worker incidents model)
// ---------------------------------------------------------------------------

/**
 * Cleaner-created operational incident through the existing incidents
 * model (0012 taxonomy; no separate cleaner incident domain). The
 * incident-evidence media linkage is handled by the media service.
 */
export async function reportCleanerIncident(
  userId: string,
  input: { job_id: string; incident_type: string; severity?: string | null; description?: string | null },
): Promise<IncidentRow> {
  const cleaner = await resolveCleanerContext(userId);
  return withTransaction(async (tx) => {
    const job = await requireActiveAssignment(cleaner, tx, input.job_id);
    if (job.status === "completed" || job.status === "cancelled") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status });
    }
    const inserted = await insertIncident(tx, {
      organizationId: job.organization_id,
      branchId: job.branch_id,
      jobId: input.job_id,
      incidentType: input.incident_type,
      severity: input.severity ?? null,
      description: input.description ?? null,
      reportedBy: userId,
    });
    await writeJobEvent(
      {
        organizationId: job.organization_id,
        branchId: job.branch_id,
        jobId: input.job_id,
        eventType: "incident_reported",
        metadata: { incident_type: input.incident_type, incident_id: inserted.id },
        actorType: "staff",
        actorUserId: userId,
      },
      tx,
    );
    await auditWorker(tx, {
      action: "incident.reported_cleaner",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "incidents",
      resourceId: inserted.id,
      actorUserId: userId,
      requestId: null,
      metadata: { job_id: input.job_id, incident_type: input.incident_type },
    });
    return inserted;
  });
}

// ---------------------------------------------------------------------------
// §6 Completion gates (BD-C9 — evaluated inside the completion transaction)
// ---------------------------------------------------------------------------

/**
 * Evaluate BD-C9 gates for the job. Returns the unmet-gate detail; an
 * empty `blocked: false` means completion may proceed. Order is normative:
 *   1. cleaner has checked in
 *   2. zero pending MANDATORY checklist items
 *   3. zero OPEN incidents with severity high|critical
 * Low/medium open incidents do NOT block.
 */
async function evaluateCompletionGates(
  tx: TransactionClient,
  job: ExecutionJobRow,
): Promise<CompletionGateDetail> {  const detail: CompletionGateDetail = {
    requires_check_in: !job.checked_in_at && job.status !== "completed",
    pending_mandatory_items: [],
    blocking_incidents: 0,
  };
  if (detail.requires_check_in) return detail; // gate 1 fails; report first unmet gate

  const pending = await tx.query<{ label: string }>(
    `select label from public.job_checklist_items
     where job_id = $1 and mandatory = true and status = 'pending'`,
    [job.id],
  );
  detail.pending_mandatory_items = pending.rows.map((r) => r.label);

  const incidents = await tx.query<{ n: string }>(
    `select count(*)::text as n from public.incidents
     where job_id = $1 and status = 'open' and severity in ('high', 'critical')`,
    [job.id],
  );
  detail.blocking_incidents = Number(incidents.rows[0].n);
  return detail;
}

function gateDetailUnmet(d: CompletionGateDetail): boolean {
  return d.requires_check_in || d.pending_mandatory_items.length > 0 || d.blocking_incidents > 0;
}

/**
 * Cleaner self-completion (BD-C9). Gates evaluated transactionally; a
 * blocked completion returns a deterministic COMPLETION_BLOCKED error
 * with the gate detail and NO partial state. On success: job completed
 * (stamps completed_at/actual_end), assignment closed as completed,
 * `job_completed` event + audit — then, post-commit, the Booking-owned
 * contract reflects `completed` on the booking (applyJobDerivedBookingTransition).
 * No Booking table is ever written from here.
 */
export async function completeCleanerJob(userId: string, jobId: string): Promise<ExecutionJobRow> {
  const cleaner = await resolveCleanerContext(userId);
  let bookingId: string | null = null;
  const completed = await serializeJobAction(`${cleaner.organizationId}:${jobId}`, () => withTransaction(async (tx) => {
    // Idempotent replay (§5): a repeat submission AFTER a successful
    // completion finds the assignment already closed (assignment_status
    // 'completed' on a completed job) — acknowledged no-op, no error.
    // Everything else still requires the caller's ACTIVE assignment.
    const pre = await tx.query<ExecutionJobRow>(
      `select ${EXECUTION_COLUMNS}
       from public.jobs j
       where j.id = $1 and j.status = 'completed'
         and exists (
           select 1 from public.job_assignments ja
           where ja.job_id = j.id and ja.employee_id = $2 and ja.assignment_status = 'completed'
         )`,
      [jobId, cleaner.employeeId],
    );
    if (pre.rows[0]) return pre.rows[0];

    const job = await requireActiveAssignment(cleaner, tx, jobId);
    if (job.status === "completed") return job; // idempotent no-op
    if (job.status !== "in_progress" && job.status !== "checked_in" && job.status !== "assigned") {
      throw workerError(WorkerErrorCode.TRANSITION_INVALID, { from: job.status, to: "completed" });
    }
    const gates = await evaluateCompletionGates(tx, job);
    if (gateDetailUnmet(gates)) {
      throw workerError(WorkerErrorCode.COMPLETION_BLOCKED, { gates });
    }
    bookingId = job.booking_id;
    const res = await tx.query<ExecutionJobRow>(
      `update public.jobs
       set status = 'completed', completed_at = now(),
           actual_end = coalesce(actual_end, now()), updated_at = now()
       where id = $1 returning ${EXECUTION_COLUMNS}`,
      [jobId],
    );
    await tx.query(
      `update public.job_assignments set assignment_status = 'completed', updated_at = now()
       where job_id = $1 and assignment_status = 'active'`,
      [jobId],
    );
    await writeJobEvent(
      { organizationId: job.organization_id, branchId: job.branch_id, jobId, eventType: "job_completed", metadata: { completed_by: userId }, actorType: "staff", actorUserId: userId },
      tx,
    );
    await auditWorker(tx, {
      action: "job.completed_cleaner",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: userId,
      requestId: null,
      metadata: { job_number: job.job_number },
    });
    return res.rows[0];
  }));

  // BD-W7a/TD-W4: derived booking completion AFTER the Worker transaction
  // commits, through the EXISTING Booking-owned contract (no second mechanism).
  if (bookingId) {
    await applyJobDerivedBookingTransition(bookingId, "completed");
  }
  return completed;
}

// ---------------------------------------------------------------------------
// Manager override (BD-C9 — existing jobs.manage permission path)
// ---------------------------------------------------------------------------

/**
 * Authorized management completion that BYPASSES the cleaner execution
 * gates (Change 6 `completeJob` is exactly this path: staff-authoritative,
 * permission-controlled by the action layer, audited). Kept as the
 * documented override path — no new permission, no new mechanism.
 */
export { completeJob as managerOverrideCompleteJob } from "./jobs";
