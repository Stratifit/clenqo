/**
 * Booking events, audit, and outbox writers (Change 5, task 11.1).
 *
 * Events (TD-3.4) are append-only business history with sensitive-data
 * minimization (BOOKING_SYSTEM §50). Audit events are transactional and
 * fail-closed (AUDIT_SYSTEM §50) — a failure aborts the business
 * operation. Outbox rows (TD-6/TD-3.5) are enqueued inside the same
 * transaction; delivery belongs to the Notification change.
 */
import "server-only";
import { writeAuditEvent } from "@/lib/audit/service";
import type { TransactionClient } from "@/lib/db/server";

export type BookingEventType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "booking_assigned"
  | "booking_started"
  | "booking_completed"
  | "booking_no_show"
  | "booking_amount_owed_recorded"
  | "contact_conflict_flagged";

export type BookingActorType = "customer" | "staff" | "system";

export interface BookingEventInput {
  organizationId: string;
  branchId: string;
  bookingId: string;
  eventType: BookingEventType;
  metadata?: Record<string, unknown>;
  actorType: BookingActorType;
  actorUserId?: string | null;
}

/** TD-3.4: bounded, minimized payload writer (inside the caller's tx). */
export async function writeBookingEvent(event: BookingEventInput, tx: TransactionClient): Promise<void> {
  await tx.query(
    `insert into public.booking_events
       (organization_id, branch_id, booking_id, event_type, metadata, actor_type, actor_user_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      event.organizationId,
      event.branchId,
      event.bookingId,
      event.eventType,
      JSON.stringify(event.metadata ?? {}),
      event.actorType,
      event.actorUserId ?? null,
    ],
  );
}

export type OutboxEventType =
  | "booking_confirmation_email"
  | "booking_cancellation_email"
  | "booking_reschedule_email"
  | "magic_link_email";

/** TD-3.5/TD-6: transactional enqueue (delivery is the Notification change). */
export async function enqueueOutbox(
  tx: TransactionClient,
  input: {
    organizationId: string;
    branchId: string;
    bookingId: string | null;
    eventType: OutboxEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.query(
    `insert into public.notification_outbox
       (organization_id, branch_id, booking_id, event_type, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.organizationId,
      input.branchId,
      input.bookingId,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
}

export interface BookingAuditActor {
  actorType: BookingActorType;
  actorUserId?: string | null;
  requestId?: string | null;
}

/** Fail-closed audit wrapper used by every booking mutation. */
export async function auditBooking(
  tx: TransactionClient,
  input: {
    action: string;
    organizationId: string;
    branchId: string;
    bookingId: string;
    actor: BookingAuditActor;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditEvent(
    {
      action: input.action,
      organizationId: input.organizationId,
      branchId: input.branchId,
      actorUserId: input.actor.actorUserId ?? null,
      actorType: input.actor.actorType === "customer" ? "customer" : input.actor.actorType === "system" ? "system" : "user",
      resourceType: "bookings",
      resourceId: input.bookingId,
      requestId: input.actor.requestId ?? null,
      metadata: input.metadata ?? {},
    },
    tx,
  );
}
