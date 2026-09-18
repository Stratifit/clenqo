/**
 * Booking-owned transition contract (Change 6, TD-W4; BD-W7a).
 *
 * The ONLY path by which job-derived booking transitions occur. The Worker
 * domain calls this AFTER its own transaction commits (the job event is
 * authoritative for the derived booking transition). Idempotent,
 * state-guarded against the 0011 transition matrix, fail-closed audited.
 *
 * Structural loop prevention (BD-W7a): this contract never calls back into
 * Worker; booking-side mutations that affect jobs (cancel/reschedule/no_show)
 * originate only from Booking's own actions, which call the Worker-owned
 * contracts.
 */
import "server-only";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeBookingEvent, auditBooking } from "./events";

export type JobDerivedKind = "assigned" | "in_progress" | "completed";

const DERIVED_EVENTS: Record<JobDerivedKind, "booking_assigned" | "booking_started" | "booking_completed"> = {
  assigned: "booking_assigned",
  in_progress: "booking_started",
  completed: "booking_completed",
};

/**
 * Apply a job-derived booking transition.
 *
 * Matrix (mirrors 0011 bookings_transition_guard):
 *   assigned    → requires booking `confirmed`
 *   in_progress → requires booking `assigned`
 *   completed   → the booking state machine has no `assigned→completed`
 *                 edge, so the contract walks the chain
 *                 (assigned→in_progress→completed), each step writing its
 *                 own event. No-op when the booking is already there.
 */
export async function applyJobDerivedBookingTransition(
  bookingId: string,
  kind: JobDerivedKind,
): Promise<void> {
  const bookingRes = await query<{ id: string; organization_id: string; branch_id: string; status: string }>(
    `select id, organization_id, branch_id, status from public.bookings where id = $1`,
    [bookingId],
  );
  const booking = bookingRes.rows[0];
  if (!booking) throw new AppError(ErrorCode.NOT_FOUND, "Booking not found for job-derived transition.");

  const current = booking.status as string;
  if (current === kind) return; // idempotent no-op (already in target state)

  const chain: Array<"assigned" | "in_progress" | "completed"> =
    kind === "assigned" ? ["assigned"] : kind === "in_progress" ? ["in_progress"] : ["in_progress", "completed"];

  let previousStatus = current;
  for (const step of chain) {
    if (previousStatus === step) continue; // idempotent per step
    await withTransaction(async (tx) => {
      const locked = await tx.query<{ id: string; organization_id: string; branch_id: string; status: string }>(
        `select id, organization_id, branch_id, status from public.bookings where id = $1 for update`,
        [bookingId],
      );
      const row = locked.rows[0];
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Booking not found for job-derived transition.");
      if (row.status === step) return; // concurrently advanced — idempotent

      // State guard (mirrors 0011): only the documented edge is applied.
      const validFrom: Record<string, string[]> = {
        assigned: ["confirmed"],
        in_progress: ["assigned"],
        completed: ["in_progress"],
      };
      if (!validFrom[step].includes(row.status)) {
        throw new AppError(ErrorCode.CONFLICT, `Booking cannot transition from ${row.status} to ${step}.`);
      }

      await tx.query(`update public.bookings set status = $2, updated_at = now() where id = $1`, [bookingId, step]);
      await writeBookingEvent(
        {
          organizationId: row.organization_id,
          branchId: row.branch_id,
          bookingId,
          eventType: DERIVED_EVENTS[step],
          metadata: { source: "worker_contract", previous_status: row.status },
          actorType: "system",
        },
        tx,
      );
      await auditBooking(tx, {
        action: `booking.${DERIVED_EVENTS[step]}`,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId,
        actor: { actorType: "system" },
        metadata: { worker_contract: true, previous_status: row.status, new_status: step },
      });
    });
    previousStatus = step;
  }
}
