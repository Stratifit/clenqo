/**
 * Job read/search + skill-requirement management (Change 6, tasks 6/12;
 * WORKER §68 search fields; jobs.view / jobs.manage permissions).
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { auditWorker } from "./events";
import { setJobSkillsSchema, listJobsSchema, type ListJobsInput } from "./schemas/worker";

export interface JobRow {
  id: string;
  organization_id: string;
  branch_id: string;
  booking_id: string | null;
  job_number: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  job_snapshot: Record<string, unknown>;
  required_skills: string[];
  assignment_flag_reason: string | null;
}

const JOB_COLUMNS = `id, organization_id, branch_id, booking_id, job_number, status,
  scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
  timezone, job_snapshot, required_skills, assignment_flag_reason`;

export async function getJob(ctx: AuthContext, jobId: string): Promise<JobRow> {
  requirePermission(ctx, "jobs.view");
  const res = await query<JobRow>(`select ${JOB_COLUMNS} from public.jobs where id = $1`, [jobId]);
  const job = res.rows[0];
  if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
  requireOrganizationAccess(ctx, job.organization_id);
  if (!(await hasBranchScope(ctx, job.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return job;
}

export async function listJobs(ctx: AuthContext, raw: unknown): Promise<JobRow[]> {
  requirePermission(ctx, "jobs.view");
  const input = listJobsSchema.parse(raw) as ListJobsInput;

  // Branch managers without an explicit branch filter see only their
  // authorized branches (membership_branches is the RLS anchor).
  let allowedBranchIds: string[] | null = null;
  if (ctx.actor.role === "branch_manager") {
    const res = await query<{ branch_id: string }>(
      `select mb.branch_id from public.membership_branches mb where mb.membership_id = $1`,
      [ctx.actor.membershipId],
    );
    allowedBranchIds = res.rows.map((r) => r.branch_id);
    if (input.branch_id && !allowedBranchIds.includes(input.branch_id)) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    if (!input.branch_id) {
      // fall through with allowedBranchIds as the filter
    } else {
      allowedBranchIds = [input.branch_id];
    }
  } else if (input.branch_id) {
    if (!(await hasBranchScope(ctx, input.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    allowedBranchIds = [input.branch_id];
  }
  if (allowedBranchIds && allowedBranchIds.length === 0) return [];

  const conditions: string[] = [`j.organization_id = $1`];
  const vals: unknown[] = [ctx.actor.organizationId];
  let i = 2;
  if (allowedBranchIds) {
    conditions.push(`j.branch_id = any($${i++}::uuid[])`);
    vals.push(allowedBranchIds);
  }
  if (input.status) {
    conditions.push(`j.status = $${i++}`);
    vals.push(input.status);
  }
  if (input.scheduled_on) {
    conditions.push(`j.scheduled_start::date = $${i++}::date`);
    vals.push(input.scheduled_on);
  }
  if (input.query) {
    // WORKER §68: job number, booking number, customer, cleaner.
    conditions.push(
      `(j.job_number ilike $${i} or exists (
         select 1 from public.bookings b where b.id = j.booking_id and b.booking_number ilike $${i}
       ) or j.job_snapshot->'customer_display'->>'first_name' ilike $${i} or exists (
         select 1 from public.job_assignments ja join public.employees e on e.id = ja.employee_id
         where ja.job_id = j.id and (e.first_name ilike $${i} or e.last_name ilike $${i})
       ))`,
    );
    vals.push(`%${input.query}%`);
    i += 1;
  }

  const res = await query<JobRow>(
    `select j.id, j.organization_id, j.branch_id, j.booking_id, j.job_number, j.status,
            j.scheduled_start::text as scheduled_start, j.scheduled_end::text as scheduled_end,
            j.timezone, j.job_snapshot, j.required_skills, j.assignment_flag_reason
     from public.jobs j
     where ${conditions.join(" and ")}
     order by j.scheduled_start asc
     limit ${input.limit}`,
    vals,
  );
  return res.rows;
}

export interface AssignmentRowLite {
  id: string;
  job_id: string;
  employee_id: string;
  assignment_status: string;
  assigned_at: string;
  employee_name: string;
}

export async function listJobAssignments(ctx: AuthContext, jobId: string): Promise<AssignmentRowLite[]> {
  requirePermission(ctx, "jobs.view");
  await getJob(ctx, jobId); // org + branch gate
  const res = await query<AssignmentRowLite>(
    `select ja.id, ja.job_id, ja.employee_id, ja.assignment_status, ja.assigned_at::text as assigned_at,
            e.first_name || ' ' || e.last_name as employee_name
     from public.job_assignments ja join public.employees e on e.id = ja.employee_id
     where ja.job_id = $1 order by ja.assigned_at desc`,
    [jobId],
  );
  return res.rows;
}

/** BD-W11: staff-set job skill requirements (jobs.manage). */
export async function setJobSkills(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "jobs.manage");
  const input = setJobSkillsSchema.parse(raw);

  await withTransaction(async (tx) => {
    const jobRes = await tx.query<{ organization_id: string; branch_id: string; status: string }>(
      `select organization_id, branch_id, status from public.jobs where id = $1 for update`,
      [input.job_id],
    );
    const job = jobRes.rows[0];
    if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
    requireOrganizationAccess(ctx, job.organization_id);
    if (!(await hasBranchScope(ctx, job.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    if (!["pending", "assigned"].includes(job.status)) {
      throw workerError(WorkerErrorCode.JOB_STATE_INVALID, { status: job.status });
    }

    await tx.query(`update public.jobs set required_skills = $2::text[], updated_at = now() where id = $1`, [
      input.job_id,
      input.required_skills,
    ]);

    // BD-W7b discipline: an active assignment must keep satisfying the new
    // requirements — validate, flag (never silently unassign).
    const active = await tx.query<{ employee_id: string }>(
      `select employee_id from public.job_assignments where job_id = $1 and assignment_status = 'active'`,
      [input.job_id],
    );
    if (active.rows[0]) {
      const jobRow = await tx.query<{ scheduled_start: string; scheduled_end: string; timezone: string }>(
        `select scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end, timezone
         from public.jobs where id = $1`,
        [input.job_id],
      );
      try {
        const { validateAssignmentEligibility } = await import("./eligibility");
        await validateAssignmentEligibility(tx, {
          employeeId: active.rows[0].employee_id,
          jobId: input.job_id,
          branchId: job.branch_id,
          organizationId: job.organization_id,
          scheduledStart: jobRow.rows[0].scheduled_start,
          scheduledEnd: jobRow.rows[0].scheduled_end,
          requiredSkills: input.required_skills,
          timeZone: jobRow.rows[0].timezone,
        });
        await tx.query(`update public.jobs set assignment_flag_reason = null where id = $1`, [input.job_id]);
      } catch (err) {
        const reason = err instanceof AppError ? (err.details?.worker_code as string) : "revalidation_failed";
        await tx.query(`update public.jobs set assignment_flag_reason = $2 where id = $1`, [input.job_id, reason]);
      }
    }

    await auditWorker(tx, {
      action: "job.skills_updated",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: input.job_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { required_skills: input.required_skills },
    });
  });
}
