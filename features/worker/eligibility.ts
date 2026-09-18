/**
 * Assignment eligibility validator (Change 6, task 7.1; design §7).
 *
 * Order is normative. Validates ONE candidate employee against ONE job:
 *   1. employee exists
 *   2. status = active (BD-W2)
 *   3. branch authorized via employee_branches (BD-W1)
 *   4. every required skill present (BD-W11)
 *   5. mandatory qualifications valid at job start (BD-W11)
 *   6. recurring availability covers the interval (branch-tz, TD-W6)
 *   7. no `unavailable` exception overlaps the interval (overrides #6)
 *   8. GLOBAL cross-branch interval conflict: no non-terminal assignment
 *      of this employee on any job in any branch overlaps the window
 *      (BD-W13 multi-branch safety)
 *   9. job timing valid (start < end)
 *  10. one-active backstop (BD-W8 — the DB partial unique is the
 *      concurrency backstop; this is the friendly pre-check)
 *
 * Scheduling feasibility is NOT re-derived here (S15): the slot was
 * validated when the booking confirmed. No second availability engine —
 * this consumes the stored availability rows, not the slot pipeline.
 */
import "server-only";
import type { TransactionClient } from "@/lib/db/server";
import { workerError, WorkerErrorCode } from "./errors";

const MINUTE = 60_000;

export interface EligibilityContext {
  employeeId: string;
  jobId: string;
  branchId: string;
  organizationId: string;
  scheduledStart: string;
  scheduledEnd: string;
  requiredSkills: string[];
}

export interface EmployeeForValidation {
  id: string;
  status: string;
}

/**
 * Resolve whether the employee's recurring availability covers the job
 * window, interpreted in the branch timezone (WORKER §14: branch tz is the
 * operational default). Uses the scheduling timezone helpers (no new
 * engine): local weekday + local time-of-day for window edges.
 */
async function availabilityCovers(
  client: { query: TransactionClient["query"] },
  employeeId: string,
  startIso: string,
  endIso: string,
  timeZone: string,
): Promise<boolean> {
  const { localDateString } = await import("@/features/scheduling/timezone");
  const { materializeLocalTime } = await import("@/features/scheduling/timezone");

  const start = new Date(startIso);
  const end = new Date(endIso);

  // Walk the local dates covered by the window (jobs are intra-day in V1,
  // but the check is written window-correctly: every local day the job
  // touches must have coverage for the overlapping portion).
  const cursor = new Date(start);
  let covered = true;
  while (cursor <= end) {
    const localDate = localDateString(cursor, timeZone);
    const weekday = weekdayOfLocal(localDate);
    const dayStartUtc = materializeLocalTime(localDate, "00:00", timeZone).instant.getTime();
    const dayEndUtc = dayStartUtc + 24 * 60 * MINUTE;

    const res = await client.query<{ start_time: string; end_time: string }>(
      `select start_time::text, end_time::text
       from public.employee_availability
       where employee_id = $1 and weekday = $2
         and effective_from <= $3::date
         and (effective_until is null or effective_until >= $3::date)
       order by start_time`,
      [employeeId, weekday, localDate],
    );

    const windows = res.rows.map((r) => {
      const windowStart = materializeLocalTime(localDate, r.start_time, timeZone).instant.getTime();
      const windowEnd = materializeLocalTime(localDate, r.end_time, timeZone).instant.getTime();
      return { windowStart, windowEnd };
    });

    // Widen with `available` exceptions overlapping this local day (TD-W6:
    // available widens the recurring schedule). Unavailable exceptions are
    // handled earlier as a hard block.
    const widenRes = await client.query<{ start_at: string; end_at: string }>(
      `select start_at::text, end_at::text
       from public.employee_availability_exceptions
       where employee_id = $1 and exception_type = 'available'
         and tstzrange(start_at, end_at) && tstzrange($2::timestamptz, $3::timestamptz)`,
      [employeeId, new Date(dayStartUtc).toISOString(), new Date(dayEndUtc).toISOString()],
    );
    for (const x of widenRes.rows) {
      windows.push({
        windowStart: new Date(x.start_at).getTime(),
        windowEnd: new Date(x.end_at).getTime(),
      });
    }

    // The portion of the job on this local day must be covered by one of
    // the windows (V1: a single window covers the intra-day job).
    const jobPortionStart = Math.max(start.getTime(), dayStartUtc);
    const jobPortionEnd = Math.min(end.getTime(), dayEndUtc);
    if (jobPortionEnd > jobPortionStart) {
      const ok = windows.some((w) => w.windowStart <= jobPortionStart && w.windowEnd >= jobPortionEnd);
      if (!ok) {
        covered = false;
        break;
      }
    }

    cursor.setTime(cursor.getTime() + 24 * 60 * MINUTE);
  }
  return covered;
}

/** Local weekday (0=Sunday) from a YYYY-MM-DD string. */
function weekdayOfLocal(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Full eligibility validation. Throws the specific worker error for the
 * FIRST failed rule (normative order). Runs on the caller's transaction
 * client so it participates in the assignment transaction's snapshot.
 */
export async function validateAssignmentEligibility(
  client: { query: TransactionClient["query"] },
  ctxInput: EligibilityContext & { timeZone: string },
): Promise<void> {
  const { employeeId, branchId, jobId, scheduledStart, scheduledEnd, requiredSkills, timeZone } = ctxInput;

  // 1 + 2 — exists & active (BD-W2).
  const emp = await client.query<{ id: string; status: string }>(
    `select id, status from public.employees where id = $1`,
    [employeeId],
  );
  const employee = emp.rows[0];
  if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
  if (employee.status !== "active") throw workerError(WorkerErrorCode.EMPLOYEE_INACTIVE);

  // 3 — branch authorization via employee_branches (BD-W1).
  const authRes = await client.query<{ exists: boolean }>(
    `select exists(
       select 1 from public.employee_branches
       where employee_id = $1 and branch_id = $2
     ) as exists`,
    [employeeId, branchId],
  );
  if (!authRes.rows[0]?.exists) throw workerError(WorkerErrorCode.NOT_BRANCH_AUTHORIZED);

  // 4 + 5 — required skills + qualification validity at job start (BD-W11).
  if (requiredSkills.length > 0) {
    const skillRes = await client.query<{ skill_key: string; expiry_date: string | null }>(
      `select skill_key, expiry_date::text from public.employee_skills
       where employee_id = $1 and skill_key = any($2::text[])`,
      [employeeId, requiredSkills],
    );
    const held = new Map(skillRes.rows.map((r) => [r.skill_key, r.expiry_date]));
    const jobStart = new Date(scheduledStart);
    for (const key of requiredSkills) {
      if (!held.has(key)) throw workerError(WorkerErrorCode.SKILL_MISSING, { skill_key: key });
      const expiry = held.get(key);
      if (expiry) {
        // Mandatory qualification must be valid at the job start.
        const expiryInstant = materializeExpiryInstant(expiry);
        if (expiryInstant.getTime() <= jobStart.getTime()) {
          throw workerError(WorkerErrorCode.QUALIFICATION_EXPIRED, { skill_key: key, expiry_date: expiry });
        }
      }
    }
  }

  // 7 — unavailable exceptions override (checked before #6 so the specific
  // error surfaces when an explicit block exists).
  const excRes = await client.query<{ exists: boolean }>(
    `select exists(
       select 1 from public.employee_availability_exceptions
       where employee_id = $1 and exception_type = 'unavailable'
         and tstzrange(start_at, end_at) && tstzrange($2::timestamptz, $3::timestamptz)
     ) as exists`,
    [employeeId, scheduledStart, scheduledEnd],
  );
  if (excRes.rows[0]?.exists) throw workerError(WorkerErrorCode.EMPLOYEE_UNAVAILABLE);

  // 6 — recurring availability coverage (branch-tz interpretation).
  const covered = await availabilityCovers(client, employeeId, scheduledStart, scheduledEnd, timeZone);
  if (!covered) throw workerError(WorkerErrorCode.AVAILABILITY_CONFLICT);

  // 8 — GLOBAL cross-branch interval conflict (BD-W13). The job's own
  // active assignment is excluded: reschedule revalidation runs while the
  // retained assignment still exists, and it must not conflict with itself.
  const conflictRes = await client.query<{ exists: boolean }>(
    `select exists(
       select 1
       from public.job_assignments ja
       join public.jobs j on j.id = ja.job_id
       where ja.employee_id = $1
         and j.id <> $4::uuid
         and ja.assignment_status in ('active', 'pending')
         and j.scheduled_start < $3::timestamptz
         and j.scheduled_end > $2::timestamptz
     ) as exists`,
    [employeeId, scheduledStart, scheduledEnd, jobId],
  );
  if (conflictRes.rows[0]?.exists) throw workerError(WorkerErrorCode.ASSIGNMENT_CONFLICT);

  // 9 — job timing validity (defensive; the CHECK also guards this).
  if (!(new Date(scheduledEnd) > new Date(scheduledStart))) {
    throw workerError(WorkerErrorCode.JOB_STATE_INVALID, { reason: "invalid_window" });
  }
}

/** End-of-day instant for a YYYY-MM-DD expiry (valid through that date). */
function materializeExpiryInstant(expiryDate: string): Date {
  const [y, m, d] = expiryDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

export { availabilityCovers };
