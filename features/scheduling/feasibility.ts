/**
 * Booking-boundary validation primitive (S16 stage 3; Change 3, task 9.x).
 *
 * `validateSlotFeasibility` answers exactly ONE question (S15): can the
 * requested work be performed in the requested interval from branch, service,
 * capacity, and conflict constraints? It performs NO pricing, NO booking-state
 * logic, and NO worker selection — the booking change owns stage 5's
 * transaction (consume hold → create booking → commit); assignment selects
 * the worker later among candidates Scheduling established as feasible.
 *
 * Contract for the Booking-phase change (task 9.2, design §6): confirmation
 * SHALL (1) validate request, (2) read effective offering, (3) run THIS
 * authoritative re-computation, (4) create/validate the hold, (5) in ONE
 * transaction: final re-check (holds + committed bookings + capacity) →
 * `consumeHoldInTx` → booking + items + pricing snapshot + booking event +
 * job → audit events → commit, (6) post-commit side effects. The DB-level
 * guards (partial unique one-hold-per-session, status CHECKs) plus the
 * guarded `consumeHoldInTx` update are the double-booking protection of
 * record; the hosted suite (task 13.1) proves the race on real PostgreSQL.
 */
import "server-only";
import { query } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { getAvailability } from "./availability";
import { isValidHold } from "./holds";
import type { DurationProvider } from "./durationProvider";

export interface FeasibilityRequest {
  branchId: string;
  serviceId: string;
  variantId?: string;
  /** Requested absolute UTC start (ISO 8601). */
  start: string;
  /** Absolute UTC end of the PROMISED window (start + duration). */
  end: string;
  /** Session id when a hold is being validated/consumed. */
  sessionId?: string;
  holdId?: string;
  /** Determinism input; production callers omit for server clock. */
  now?: Date;
}

export interface FeasibilityResult {
  feasible: true;
  /** The authoritative promised window (echoed for the booking change). */
  start: string;
  end: string;
}

/**
 * Authoritative feasibility re-computation (task 9.1). Client-supplied slot
 * data is never trusted — the server recomputes from state (spec: "Client
 * data never trusted"). A valid, unexpired hold for this session+slot
 * satisfies the occupancy re-check for stage 4→5 hand-off.
 */
export async function validateSlotFeasibility(
  request: FeasibilityRequest,
  durationProvider: DurationProvider,
): Promise<FeasibilityResult> {
  const now = request.now ?? new Date();

  const slots = await getAvailability(
    {
      branchId: request.branchId,
      serviceId: request.serviceId,
      variantId: request.variantId,
      now,
    },
    durationProvider,
  );
  const match = slots.find((s) => s.start === request.start && s.end === request.end);
  if (!match) {
    throw new AppError(ErrorCode.CONFLICT, "Requested slot is not available.");
  }
  if (!match.available) {
    // The slot may be blocked by THIS session's own hold — a valid hold
    // satisfies the feasibility re-check for the stage-4→5 hand-off (S16);
    // another session's hold still blocks.
    if (request.holdId && request.sessionId) {
      const own = await query<{
        status: string; expires_at: string; session_id: string;
        start_time: string; end_time: string;
      }>(
        `select status, expires_at::text, session_id, start_time::text, end_time::text
         from public.slot_holds where id = $1`,
        [request.holdId],
      );
      const h = own.rows[0];
      // Compare instants, not text — the executor may render timestamptz in
      // PostgreSQL text form ("2027-06-02 09:00:00+00"), not ISO.
      const ownsSlot =
        h &&
        h.session_id === request.sessionId &&
        new Date(h.start_time).getTime() === new Date(request.start).getTime() &&
        new Date(h.end_time).getTime() === new Date(request.end).getTime();
      if (ownsSlot && h!.status === "held" && new Date(h!.expires_at).getTime() > now.getTime()) {
        return { feasible: true, start: request.start, end: request.end };
      }
    }
    throw new AppError(ErrorCode.CONFLICT, "Requested slot is not available.");
  }

  // When a hold is presented it must be valid (held + unexpired) and belong
  // to this session and this exact slot — otherwise the request is stale.
  if (request.holdId && request.sessionId) {
    const res = await query<{ status: string; expires_at: string; session_id: string; start_time: string; end_time: string }>(
      `select status, expires_at::text, session_id, start_time::text, end_time::text
       from public.slot_holds where id = $1`,
      [request.holdId],
    );
    const hold = res.rows[0];
    const sameSlot =
      hold &&
      new Date(hold.start_time).getTime() === new Date(request.start).getTime() &&
      new Date(hold.end_time).getTime() === new Date(request.end).getTime();
    if (
      !hold ||
      hold.session_id !== request.sessionId ||
      !sameSlot ||
      !isValidHold(hold)
    ) {
      throw new AppError(ErrorCode.CONFLICT, "Hold is not valid for this slot.");
    }
  }

  return { feasible: true, start: request.start, end: request.end };
}
