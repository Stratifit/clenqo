/**
 * Worker events, audit, and outbox writers (Change 6, task 10.1; TD-W8).
 *
 * Job events are append-only business history with sensitive-data
 * minimization (WORKER §66). Audit events are transactional and fail-closed
 * (AUDIT §50) — a failure aborts the business operation. Outbox rows are
 * enqueued inside the same transaction; delivery belongs to the
 * Notification change (BD-W10).
 */
import "server-only";
import { writeAuditEvent } from "@/lib/audit/service";
import type { TransactionClient } from "@/lib/db/server";

export type JobEventType =
  | "job_created"
  | "job_assigned"
  | "job_unassigned"
  | "job_rescheduled"
  | "job_started"
  | "check_in"
  | "check_out"
  | "job_completed"
  | "job_cancelled"
  | "incident_reported"
  | "assignment_flagged";

export type JobActorType = "staff" | "system" | "customer";

export interface JobEventInput {
  organizationId: string;
  branchId: string;
  jobId: string;
  eventType: JobEventType;
  metadata?: Record<string, unknown>;
  actorType: JobActorType;
  actorUserId?: string | null;
}

/** TD-W8: bounded, minimized payload writer (inside the caller's tx). */
export async function writeJobEvent(event: JobEventInput, tx: TransactionClient): Promise<void> {
  await tx.query(
    `insert into public.job_events
       (organization_id, branch_id, job_id, event_type, metadata, actor_type, actor_user_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      event.organizationId,
      event.branchId,
      event.jobId,
      event.eventType,
      JSON.stringify(event.metadata ?? {}),
      event.actorType,
      event.actorUserId ?? null,
    ],
  );
}

export type WorkerOutboxEventType =
  | "job_created"
  | "job_assigned"
  | "job_unassigned"
  | "job_cancelled";

/** Transactional enqueue (delivery is the Notification change — BD-W10). */
export async function enqueueWorkerOutbox(
  tx: TransactionClient,
  input: {
    organizationId: string;
    branchId: string;
    jobId: string;
    eventType: WorkerOutboxEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.query(
    `insert into public.notification_outbox
       (organization_id, branch_id, booking_id, event_type, payload)
     values ($1, $2, null, $3, $4::jsonb)`,
    [input.organizationId, input.branchId, input.eventType, JSON.stringify(input.payload)],
  );
}

/** Fail-closed audit wrapper used by every worker mutation. */
export async function auditWorker(
  tx: TransactionClient,
  input: {
    action: string;
    organizationId: string;
    branchId?: string | null;
    resourceType: string;
    resourceId: string;
    actorUserId: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditEvent(
    {
      action: input.action,
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      actorUserId: input.actorUserId,
      actorType: input.actorUserId ? "user" : "system",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    },
    tx,
  );
}
