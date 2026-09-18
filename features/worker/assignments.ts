/**
 * Assignment service (Change 6, tasks 7.2–7.3, 8.2; BD-W8/W9, TD-W4/W7).
 *
 * One transaction per assign/reassign: lock the job row → validate state →
 * run the eligibility validator (§7) → write the assignment (the partial
 * unique index is the concurrency backstop) → job `pending→assigned` →
 * events/audit/outbox → COMMIT → Booking-owned transition contract
 * post-commit (job event authoritative for the derived booking transition;
 * the contract never calls back into Worker — structural loop prevention).
 */
import "server-only";
import { requireOrganizationAccess, requirePermission, type AuthContext } from "@/lib/authorization/server";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { writeJobEvent, enqueueWorkerOutbox, auditWorker } from "./events";
import { validateAssignmentEligibility } from "./eligibility";
import { assignCleanerSchema, unassignCleanerSchema, type AssignCleanerInput, type UnassignCleanerInput } from "./schemas/worker";
import { applyJobDerivedBookingTransition } from "@/features/booking/workerContract";

export interface AssignmentRow {
  id: string;
  organization_id: string;
  branch_id: string;
  job_id: string;
  employee_id: string;
  assignment_status: string;
  assigned_at: string;
  assigned_by: string | null;
}

interface JobForAssignment {
  id: string;
  organization_id: string;
  branch_id: string;
  status: string;
  booking_id: string | null;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  required_skills: string[];
}

const JOB_SELECT = `id, organization_id, branch_id, status, booking_id,
  scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
  timezone, required_skills`;

/** Authorize a staff assignment mutation against the job's org/branch. */
async function authorizeJobMutation(ctx: AuthContext, job: JobForAssignment): Promise<void> {
  requirePermission(ctx, "jobs.assign");
  requireOrganizationAccess(ctx, job.organization_id);
  const { hasBranchScope } = await import("@/lib/authorization/server");
  if (!(await hasBranchScope(ctx, job.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
}

/**
 * Assign a cleaner (BD-W9 immediate active assignment). Transactional;
 * idempotent when the same employee is already actively assigned.
 */
export async function assignCleaner(ctx: AuthContext, raw: unknown): Promise<AssignmentRow> {
  const input = assignCleanerSchema.parse(raw) as AssignCleanerInput;

  const jobRes = await query<JobForAssignment>(`select ${JOB_SELECT} from public.jobs where id = $1`, [input.job_id]);
  const job = jobRes.rows[0];
  if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
  await authorizeJobMutation(ctx, job);

  const assignment = await withTransaction(async (tx) => {
    // Serialize concurrent assignment attempts (TD-W7).
    const locked = await tx.query<JobForAssignment>(`select ${JOB_SELECT} from public.jobs where id = $1 for update`, [
      input.job_id,
    ]);
    const currentJob = locked.rows[0];
    if (!currentJob) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
    if (!["pending", "assigned"].includes(currentJob.status)) {
      throw workerError(WorkerErrorCode.JOB_STATE_INVALID, { status: currentJob.status });
    }

    // Idempotent no-op: same employee already actively assigned.
    const activeRes = await tx.query<AssignmentRow>(
      `select id, organization_id, branch_id, job_id, employee_id, assignment_status,
              assigned_at::text as assigned_at, assigned_by
       from public.job_assignments where job_id = $1 and assignment_status = 'active'`,
      [input.job_id],
    );
    const existing = activeRes.rows[0];
    if (existing && existing.employee_id === input.employee_id) return existing;
    if (existing) throw workerError(WorkerErrorCode.ASSIGNMENT_EXISTS);

    // Eligibility (§7 order) inside the transaction snapshot.
    await validateAssignmentEligibility(tx, {
      employeeId: input.employee_id,
      jobId: input.job_id,
      branchId: currentJob.branch_id,
      organizationId: currentJob.organization_id,
      scheduledStart: currentJob.scheduled_start,
      scheduledEnd: currentJob.scheduled_end,
      requiredSkills: currentJob.required_skills,
      timeZone: currentJob.timezone,
    });

    const res = await tx.query<AssignmentRow>(
      `insert into public.job_assignments
         (organization_id, branch_id, job_id, employee_id, assignment_status, assigned_by)
       values ($1, $2, $3, $4, 'active', $5)
       returning id, organization_id, branch_id, job_id, employee_id, assignment_status,
                 assigned_at::text as assigned_at, assigned_by`,
      [currentJob.organization_id, currentJob.branch_id, input.job_id, input.employee_id, ctx.actor.userId],
    );
    const assignment = res.rows[0];

    if (currentJob.status === "pending") {
      await tx.query(`update public.jobs set status = 'assigned', updated_at = now() where id = $1`, [input.job_id]);
    }

    await writeJobEvent(
      {
        organizationId: currentJob.organization_id,
        branchId: currentJob.branch_id,
        jobId: input.job_id,
        eventType: "job_assigned",
        metadata: { employee_id: input.employee_id, assigned_by: ctx.actor.userId },
        actorType: "staff",
        actorUserId: ctx.actor.userId,
      },
      tx,
    );
    await enqueueWorkerOutbox(tx, {
      organizationId: currentJob.organization_id,
      branchId: currentJob.branch_id,
      jobId: input.job_id,
      eventType: "job_assigned",
      payload: { employee_id: input.employee_id, job_number: undefined },
    });
    await auditWorker(tx, {
      action: "job.assigned",
      organizationId: currentJob.organization_id,
      branchId: currentJob.branch_id,
      resourceType: "job_assignments",
      resourceId: assignment.id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { job_id: input.job_id, employee_id: input.employee_id },
    });

    return assignment;
  });

  // BD-W7a/TD-W4: derived booking transition AFTER the Worker transaction
  // commits. Booking-owned contract; never calls back into Worker.
  if (job.booking_id) {
    await applyJobDerivedBookingTransition(job.booking_id, "assigned");
  }
  return assignment;
}

/**
 * Unassign (BD-W9 manager-controlled): the active assignment becomes
 * `cancelled` (history preserved); the job returns to `pending` so a
 * replacement can be assigned.
 */
export async function unassignCleaner(ctx: AuthContext, raw: unknown): Promise<void> {
  const input = unassignCleanerSchema.parse(raw) as UnassignCleanerInput;

  const jobRes = await query<JobForAssignment>(`select ${JOB_SELECT} from public.jobs where id = $1`, [input.job_id]);
  const job = jobRes.rows[0];
  if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
  await authorizeJobMutation(ctx, job);

  await withTransaction(async (tx) => {
    const locked = await tx.query<JobForAssignment>(`select ${JOB_SELECT} from public.jobs where id = $1 for update`, [
      input.job_id,
    ]);
    const currentJob = locked.rows[0];
    if (!currentJob) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);

    const activeRes = await tx.query<AssignmentRow & { employee_id: string }>(
      `select id, employee_id from public.job_assignments
       where job_id = $1 and assignment_status = 'active'`,
      [input.job_id],
    );
    const active = activeRes.rows[0];
    if (!active) return; // idempotent no-op

    await tx.query(
      `update public.job_assignments set assignment_status = 'cancelled', updated_at = now() where id = $1`,
      [active.id],
    );
    await tx.query(`update public.jobs set status = 'pending', updated_at = now() where id = $1`, [input.job_id]);

    await writeJobEvent(
      {
        organizationId: currentJob.organization_id,
        branchId: currentJob.branch_id,
        jobId: input.job_id,
        eventType: "job_unassigned",
        metadata: { employee_id: active.employee_id, reason: input.reason ?? null },
        actorType: "staff",
        actorUserId: ctx.actor.userId,
      },
      tx,
    );
    await auditWorker(tx, {
      action: "job.unassigned",
      organizationId: currentJob.organization_id,
      branchId: currentJob.branch_id,
      resourceType: "job_assignments",
      resourceId: active.id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { job_id: input.job_id, employee_id: active.employee_id, reason: input.reason ?? null },
    });
  });
}
