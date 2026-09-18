/**
 * Cleaner job-view queries (Change 7; design §4/§12; BD-C1).
 *
 * The ONLY read surface for cleaner routes. Returns the minimized
 * execution data set bound to the cleaner's ACTIVE assignment:
 *   customer first name, last initial, phone, service address,
 *   execution instructions (BD-C1) — plus the job's own operational
 *   fields. Never returns: email, payment data, unrelated booking/
 *   customer history, internal staff notes, other workers' information.
 * Internal notes are not present in any payload by construction (the
 * selection lists below simply do not include them — the snapshot's
 * only customer fields are customer_display + service_address +
 * instructions).
 */
import "server-only";
import { query } from "@/lib/db/server";
import { workerError, WorkerErrorCode } from "./errors";
import { resolveCleanerContext, type CleanerContext } from "./execution";

/** BD-C1 minimized view: everything a cleaner may see for one job. */
export interface CleanerJobView {
  id: string;
  job_number: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  branch_id: string;
  en_route_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  actual_start: string | null;
  actual_end: string | null;
  service_label: string | null;
  variant_label: string | null;
  addon_labels: string[];
  service_address: Record<string, unknown> | null;
  customer_first_name: string | null;
  customer_last_initial: string | null;
  customer_phone: string | null;
  instructions: string | null;
  assignment_flagged: boolean;
}

const VIEW_COLUMNS = `
  j.id, j.job_number, j.status, j.branch_id,
  j.scheduled_start::text as scheduled_start, j.scheduled_end::text as scheduled_end,
  j.timezone,
  j.en_route_at::text as en_route_at, j.checked_in_at::text as checked_in_at,
  j.checked_out_at::text as checked_out_at, j.actual_start::text as actual_start,
  j.actual_end::text as actual_end,
  j.job_snapshot->>'service_label' as service_label,
  j.job_snapshot->>'variant_label' as variant_label,
  coalesce(
    (select array_agg(x) from jsonb_array_elements_text(j.job_snapshot->'addon_labels') x), '{}'
  ) as addon_labels,
  j.job_snapshot->'service_address' as service_address,
  j.job_snapshot->'customer_display'->>'first_name' as customer_first_name,
  j.job_snapshot->'customer_display'->>'last_initial' as customer_last_initial,
  c.phone as customer_phone,
  j.job_snapshot->>'instructions' as instructions,
  (j.assignment_flag_reason is not null) as assignment_flagged`;

/**
 * Base query: jobs with the cleaner's ACTIVE assignment only. Cancelled/
 * reassigned assignments leave this surface automatically (BD-C1) —
 * assignment_status must still be 'active'. Completed jobs remain
 * visible for the cleaner's own history (minimized snapshot rules hold).
 */
function activeAssignmentJoin(_cleaner: CleanerContext): string {
  return `
  from public.jobs j
  join public.job_assignments ja on ja.job_id = j.id and ja.assignment_status = 'active'
  join public.employees e on e.id = ja.employee_id and e.user_id = $1 and e.status = 'active'
  left join public.bookings b on b.id = j.booking_id
  left join public.customers c on c.id = b.customer_id
  where ja.employee_id = $2 and j.organization_id = $3`;
}

function mapRow(r: Record<string, unknown>): CleanerJobView {
  return {
    id: r.id as string,
    job_number: r.job_number as string,
    status: r.status as string,
    scheduled_start: r.scheduled_start as string,
    scheduled_end: r.scheduled_end as string,
    timezone: r.timezone as string,
    branch_id: r.branch_id as string,
    en_route_at: (r.en_route_at as string | null) ?? null,
    checked_in_at: (r.checked_in_at as string | null) ?? null,
    checked_out_at: (r.checked_out_at as string | null) ?? null,
    actual_start: (r.actual_start as string | null) ?? null,
    actual_end: (r.actual_end as string | null) ?? null,
    service_label: (r.service_label as string | null) ?? null,
    variant_label: (r.variant_label as string | null) ?? null,
    addon_labels: (r.addon_labels as string[]) ?? [],
    service_address: (r.service_address as Record<string, unknown> | null) ?? null,
    customer_first_name: (r.customer_first_name as string | null) ?? null,
    customer_last_initial: (r.customer_last_initial as string | null) ?? null,
    customer_phone: (r.customer_phone as string | null) ?? null,
    instructions: (r.instructions as string | null) ?? null,
    assignment_flagged: Boolean(r.assignment_flagged),
  };
}

/** One assigned job (BD-C1 minimized view). Denies non-assigned jobs. */
export async function getCleanerJobView(userId: string, jobId: string): Promise<CleanerJobView> {
  const cleaner = await resolveCleanerContext(userId);
  const res = await query<Record<string, unknown>>(
    `select ${VIEW_COLUMNS} ${activeAssignmentJoin(cleaner)} and j.id = $4`,
    [cleaner.userId, cleaner.employeeId, cleaner.organizationId, jobId],
  );
  const row = res.rows[0];
  if (!row) throw workerError(WorkerErrorCode.NOT_ASSIGNED_CLEANER, { job_id: jobId });
  return mapRow(row);
}

export type CleanerJobBucket = "today" | "tomorrow" | "upcoming" | "completed";

/**
 * List the cleaner's jobs by bucket (BD-C1 minimized views). Buckets are
 * evaluated in the job's branch-local timezone (design §10): today /
 * tomorrow compare the branch-local service date against the branch-local
 * "now"; upcoming = after tomorrow; completed = status completed (most
 * recent first, capped for the surface).
 */
export async function listCleanerJobs(
  userId: string,
  bucket: CleanerJobBucket,
  /** Reserved for deterministic reference-time injection in tests/futures. */
  _referenceNow: Date = new Date(),
): Promise<CleanerJobView[]> {
  const cleaner = await resolveCleanerContext(userId);
  const base = `select ${VIEW_COLUMNS} ${activeAssignmentJoin(cleaner)}`;

  if (bucket === "completed") {
    const res = await query<Record<string, unknown>>(
      `${base} and j.status = 'completed'
       order by j.completed_at desc nulls last limit 50`,
      [cleaner.userId, cleaner.employeeId, cleaner.organizationId],
    );
    return res.rows.map(mapRow);
  }

  // Branch-local day boundaries: compute per-job via the stored branch tz
  // (jobs.timezone). A SQL-side (scheduled_start AT TIME ZONE tz)::date
  // comparison keeps this branch-local without a second timezone engine.
  const todayLocal = `(j.scheduled_start at time zone j.timezone)::date`;
  const tomorrowLocal = `((now() at time zone j.timezone)::date + 1)`;
  const todayLocalNow = `((now() at time zone j.timezone)::date)`;

  let where: string;
  if (bucket === "today") where = `and j.status <> 'completed' and j.status <> 'cancelled' and ${todayLocal} = ${todayLocalNow}`;
  else if (bucket === "tomorrow") where = `and j.status <> 'completed' and j.status <> 'cancelled' and ${todayLocal} = ${tomorrowLocal}`;
  else where = `and j.status <> 'completed' and j.status <> 'cancelled' and ${todayLocal} > ${tomorrowLocal}`;

  const res = await query<Record<string, unknown>>(
    `${base} ${where} order by j.scheduled_start asc limit 100`,
    [cleaner.userId, cleaner.employeeId, cleaner.organizationId],
  );
  return res.rows.map(mapRow);
}

/**
 * In-app notification surface source (BD-C7): the cleaner's operational
 * events derived from the EXISTING job_events (no second engine, no
 * delivery). Surfaces assignment-relevant events on the cleaner's jobs.
 */
export interface CleanerNotificationView {
  id: string;
  job_id: string;
  job_number: string;
  event_type: string;
  created_at: string;
}

export async function listCleanerNotifications(userId: string, limit = 20): Promise<CleanerNotificationView[]> {
  const cleaner = await resolveCleanerContext(userId);
  const res = await query<CleanerNotificationView>(
    `select ev.id, ev.job_id, j.job_number, ev.event_type, ev.created_at::text as created_at
     from public.job_events ev
     join public.jobs j on j.id = ev.job_id
     join public.job_assignments ja on ja.job_id = j.id and ja.assignment_status in ('active', 'completed')
     join public.employees e on e.id = ja.employee_id and e.user_id = $1
     where ev.event_type in ('job_assigned', 'job_unassigned', 'job_rescheduled', 'job_cancelled')
     order by ev.created_at desc limit $2`,
    [cleaner.userId, limit],
  );
  return res.rows;
}
