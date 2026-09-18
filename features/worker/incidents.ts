/**
 * Minimal incident records (Change 6, task 9; DATABASE §29 + BD-W7d).
 *
 * Change 6 supports recording and listing incidents only — the no_show
 * incident is created automatically by the booking→job no-show propagation
 * (jobs.ts). No quality/complaint workflow (explicit non-goal).
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { writeJobEvent, auditWorker } from "./events";
import { reportIncidentSchema, type ReportIncidentInput } from "./schemas/worker";

export interface IncidentRow {
  id: string;
  organization_id: string;
  branch_id: string;
  job_id: string;
  reported_by: string | null;
  incident_type: string;
  severity: string | null;
  description: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

const INCIDENT_COLUMNS = `id, organization_id, branch_id, job_id, reported_by,
  incident_type, severity, description, status, created_at::text as created_at,
  resolved_at::text as resolved_at`;

/** Authorize an incident read/mutation against the parent job's org/branch. */
async function authorizeJobAccess(ctx: AuthContext, jobId: string): Promise<{ organization_id: string; branch_id: string; status: string }> {
  requirePermission(ctx, "jobs.view");
  const res = await query<{ organization_id: string; branch_id: string; status: string }>(
    `select organization_id, branch_id, status from public.jobs where id = $1`,
    [jobId],
  );
  const job = res.rows[0];
  if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
  requireOrganizationAccess(ctx, job.organization_id);
  if (!(await hasBranchScope(ctx, job.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return job;
}

/** Staff incident reporting (jobs.manage — operational record). */
export async function reportIncident(ctx: AuthContext, raw: unknown): Promise<IncidentRow> {
  requirePermission(ctx, "jobs.manage");
  const input = reportIncidentSchema.parse(raw) as ReportIncidentInput;
  const job = await authorizeJobAccess(ctx, input.job_id);

  return withTransaction(async (tx) => {
    const inserted = await insertIncident(tx, {
      organizationId: job.organization_id,
      branchId: job.branch_id,
      jobId: input.job_id,
      incidentType: input.incident_type,
      severity: input.severity ?? null,
      description: input.description ?? null,
      reportedBy: ctx.actor.userId,
    });

    await writeJobEvent(
      {
        organizationId: job.organization_id,
        branchId: job.branch_id,
        jobId: input.job_id,
        eventType: "incident_reported",
        metadata: { incident_type: input.incident_type, incident_id: inserted.id },
        actorType: "staff",
        actorUserId: ctx.actor.userId,
      },
      tx,
    );
    await auditWorker(tx, {
      action: "incident.reported",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "incidents",
      resourceId: inserted.id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { job_id: input.job_id, incident_type: input.incident_type },
    });

    return inserted;
  });
}

/** Shared insert used by staff reporting and the no_show propagation. */
export async function insertIncident(
  tx: TransactionClient,
  input: {
    organizationId: string;
    branchId: string;
    jobId: string;
    incidentType: string;
    severity: string | null;
    description: string | null;
    reportedBy: string | null;
  },
): Promise<IncidentRow> {
  const res = await tx.query<IncidentRow>(
    `insert into public.incidents
       (organization_id, branch_id, job_id, reported_by, incident_type, severity, description, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'open')
     returning ${INCIDENT_COLUMNS}`,
    [
      input.organizationId,
      input.branchId,
      input.jobId,
      input.reportedBy,
      input.incidentType,
      input.severity,
      input.description,
    ],
  );
  return res.rows[0];
}

export async function listIncidentsForJob(ctx: AuthContext, jobId: string): Promise<IncidentRow[]> {
  await authorizeJobAccess(ctx, jobId);
  const res = await query<IncidentRow>(
    `select ${INCIDENT_COLUMNS} from public.incidents where job_id = $1 order by created_at desc`,
    [jobId],
  );
  return res.rows;
}
