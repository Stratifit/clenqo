/**
 * Slot holds — the single capacity-blocking reservation mechanism (S1/S1b;
 * Change 3, task 8.x; resolves MEDIUM-9).
 *
 * Lifecycle: created → held → consumed | released | expired.
 *   - Creation happens ONLY after an authoritative availability check (the
 *     engine of `availability.ts`) — a hold never reserves unoffered time.
 *   - TTL from branch config (S1b, default 15 min), enforced by read-time
 *     validity checks (`isValidHold` ignores rows past `expires_at`) plus a
 *     periodic sweep transitioning stale rows to `expired` (task 8.1 —
 *     simplest reliable mechanism, no distributed queue).
 *   - One ACTIVE hold per session (partial unique index
 *     `uq_slot_holds_one_active_per_session`).
 *   - Idempotent creation: the same `idempotency_key` returns the existing
 *     hold (unique index `uq_slot_holds_idempotency`).
 *   - Consumption is atomic inside the caller's confirmation transaction
 *     (S16 stage 5 — booking change): `consumeHoldInTx` flips held→consumed
 *     guarded by `status = 'held' AND expires_at > now()`; a consumed hold
 *     can never be consumed twice.
 *
 * Audit events `slot_held` / `slot_released` / `slot_consumed` /
 * `slot_expired` are written transactionally (fail-closed).
 */
import "server-only";
import {
  requireOrganizationAccess,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  createSlotHoldSchema,
  consumeSlotHoldSchema,
  releaseSlotHoldSchema,
  type ConsumeSlotHoldInput,
  type CreateSlotHoldInput,
  type ReleaseSlotHoldInput,
} from "./schemas/scheduling";
import type { DurationProvider } from "./durationProvider";
import { getAvailability } from "./availability";
import type { SchedulingConfig } from "./service";


export interface SlotHold {
  id: string;
  branch_id: string;
  service_id: string;
  start_time: string;
  end_time: string;
  session_id: string;
  status: "held" | "consumed" | "released" | "expired";
  expires_at: string;
  created_at: string;
}

function parseOrThrow<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      parsed.error?.issues.map((i) => i.message).join("; ") ?? "Invalid input.",
    );
  }
  return parsed.data!;
}

async function loadConfigRow(branchId: string): Promise<SchedulingConfig> {
  const res = await query<SchedulingConfig>(
    `select branch_id, minimum_notice_minutes, maximum_advance_days,
            slot_grid_minutes, operational_buffer_minutes, travel_buffer_minutes,
            concurrency_cap, customer_horizon_days, hold_ttl_minutes
     from public.branch_scheduling_configuration where branch_id = $1`,
    [branchId],
  );
  if (!res.rows[0]) {
    throw new AppError(ErrorCode.NOT_FOUND, "Branch scheduling configuration missing.");
  }
  return res.rows[0];
}

/** Ensure the acting user may operate on this branch (org + branch scope). */
async function requireHoldBranchAccess(ctx: AuthContext, branchId: string): Promise<string> {
  const res = await query<{ organization_id: string }>(
    `select organization_id from public.branches where id = $1`,
    [branchId],
  );
  if (!res.rows[0]) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  requireOrganizationAccess(ctx, res.rows[0].organization_id);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return res.rows[0].organization_id;
}

/**
 * Create a slot hold (task 8.1). Idempotent per `idempotency_key`: a repeat
 * call with the same key returns the EXISTING hold regardless of its state.
 * Enforces one ACTIVE hold per session; enforces the branch TTL (S1b).
 * The slot is re-verified against the availability engine inside the same
 * transaction — a hold is never created for an unavailable slot.
 *
 * Authorization: the requesting actor must hold branch scope (customer-
 * facing unauthenticated holds ride the future booking flow's session
 * context; S16 — this change ships the scheduling-owned primitive).
 */
export async function createSlotHold(
  ctx: AuthContext,
  raw: CreateSlotHoldInput,
  durationProvider: DurationProvider,
  /** Determinism input for tests; production callers omit (server clock). */
  now: Date = new Date(),
): Promise<SlotHold> {
  const input = parseOrThrow(createSlotHoldSchema, raw);
  const organizationId = await requireHoldBranchAccess(ctx, input.branch_id);
  const cfg = await loadConfigRow(input.branch_id);

  const startMs = new Date(input.start_time).getTime();
  const endMs = new Date(input.end_time).getTime();

  return withTransaction(async (tx) => {
    // Idempotency first: same key → same hold (task 8.3).
    const existing = await tx.query<SlotHold>(
      `select id, branch_id, service_id, start_time::text, end_time::text,
              session_id, status, expires_at::text, created_at::text
       from public.slot_holds where idempotency_key = $1`,
      [input.idempotency_key],
    );
    if (existing.rows[0]) {
      const e = existing.rows[0];
      if (e.branch_id !== input.branch_id || e.service_id !== input.service_id) {
        throw new AppError(ErrorCode.CONFLICT, "Idempotency key already used for a different slot.");
      }
      if (new Date(e.start_time).getTime() !== startMs || new Date(e.end_time).getTime() !== endMs) {
        throw new AppError(ErrorCode.CONFLICT, "Idempotency key already used for a different interval.");
      }
      if (e.status === "held" && new Date(e.expires_at).getTime() <= Date.now()) {
        // Read-time expiry: a stale active hold is expired on touch.
        const swept = await tx.query<SlotHold>(
          `update public.slot_holds set status = 'expired', updated_at = now()
           where id = $1 and status = 'held' and expires_at <= now()
           returning id, branch_id, service_id, start_time::text, end_time::text,
                     session_id, status, expires_at::text, created_at::text`,
          [e.id],
        );
        if (swept.rows[0]) {
          await writeAuditEvent(
            {
              action: "slot.expired",
              organizationId,
              branchId: input.branch_id,
              actorUserId: ctx.actor.userId,
              resourceType: "slot_holds",
              resourceId: e.id,
              metadata: { reason: "read_time_touch" },
            },
            tx,
          );
        }
        throw new AppError(ErrorCode.CONFLICT, "Slot hold has expired; request a new hold.");
      }
      return e;
    }

    // One ACTIVE hold per session — reject early with a stable error (the
    // partial unique index remains the last-line guard).
    const active = await tx.query<{ id: string }>(
      `select id from public.slot_holds where session_id = $1 and status = 'held'`,
      [input.session_id],
    );
    if (active.rows[0]) {
      throw new AppError(ErrorCode.CONFLICT, "Session already holds a slot.");
    }

    // Authoritative availability re-computation for this exact start (S16
    // stage 3): a hold is created only after a real availability check.
    const slots = await getAvailability(
      { branchId: input.branch_id, serviceId: input.service_id, variantId: input.variant_id, now },
      durationProvider,
    );
    const slot = slots.find((s) => s.start === input.start_time && s.end === input.end_time);
    if (!slot || !slot.available) {
      throw new AppError(ErrorCode.CONFLICT, "Requested slot is not available.");
    }

    // TTL is anchored to the DATABASE clock (S1b): expires_at and created_at
    // come from the same now(), so the ck_slot_holds_expiry invariant can
    // never fail on app/db clock skew.
    try {
      const res = await tx.query<SlotHold>(
        `insert into public.slot_holds
           (organization_id, branch_id, service_id, start_time, end_time,
            session_id, idempotency_key, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8::int))
         returning id, branch_id, service_id, start_time::text, end_time::text,
                   session_id, status, expires_at::text, created_at::text`,
        [
          organizationId,
          input.branch_id,
          input.service_id,
          new Date(startMs).toISOString(),
          new Date(endMs).toISOString(),
          input.session_id,
          input.idempotency_key,
          cfg.hold_ttl_minutes,
        ],
      );
      await writeAuditEvent(
        {
          action: "slot.held",
          organizationId,
          branchId: input.branch_id,
          actorUserId: ctx.actor.userId,
          resourceType: "slot_holds",
          resourceId: res.rows[0].id,
          metadata: {
            session_id: input.session_id,
            ttl_minutes: cfg.hold_ttl_minutes,
          },
        },
        tx,
      );
      return res.rows[0];
    } catch (err) {
      // The partial unique index fired between the check and the insert
      // (interleaved session request) — stable conflict (task 8.3).
      if (
        typeof err === "object" && err !== null && "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        throw new AppError(ErrorCode.CONFLICT, "Session already holds a slot.");
      }
      throw err;
    }
  });
}

/** A hold blocks capacity only while `held` AND not past TTL (S1, task 8.2). */
export function isValidHold(hold: { status: string; expires_at: string }): boolean {
  return hold.status === "held" && new Date(hold.expires_at).getTime() > Date.now();
}

/**
 * Release a hold (checkout abandoned by choice / confirmation failure).
 * Only the owning session may release; released holds never block again.
 */
export async function releaseSlotHold(ctx: AuthContext, raw: ReleaseSlotHoldInput): Promise<void> {
  const input = parseOrThrow(releaseSlotHoldSchema, raw);
  return withTransaction(async (tx) => {
    const res = await tx.query<SlotHold & { organization_id: string }>(
      `update public.slot_holds set status = 'released', updated_at = now()
       where id = $1 and session_id = $2 and status = 'held'
       returning id, branch_id, organization_id`,
      [input.hold_id, input.session_id],
    );
    const hold = res.rows[0];
    if (!hold) throw new AppError(ErrorCode.NOT_FOUND, "No active hold for this session.");
    await requireHoldBranchAccess(ctx, hold.branch_id);
    await writeAuditEvent(
      {
        action: "slot.released",
        organizationId: hold.organization_id,
        branchId: hold.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "slot_holds",
        resourceId: hold.id,
        metadata: { session_id: input.session_id },
      },
      tx,
    );
  });
}

/**
 * Consume a hold inside the CALLER's confirmation transaction (S16 stage 5 —
 * the booking change drives the transaction; this primitive is stage 3–4
 * support). Guarded update: `held` + unexpired only; consumed holds are
 * terminal and can never be consumed twice (task 8.3).
 */
export async function consumeHoldInTx(
  tx: TransactionClient,
  input: ConsumeSlotHoldInput,
): Promise<SlotHold> {
  parseOrThrow(consumeSlotHoldSchema, input);
  const res = await tx.query<SlotHold & { organization_id: string }>(
    `update public.slot_holds
     set status = 'consumed', consumed_by_booking = $3, updated_at = now()
     where id = $1 and session_id = $2 and status = 'held' and expires_at > now()
     returning id, branch_id, service_id, start_time::text, end_time::text,
               session_id, status, expires_at::text, created_at::text, organization_id`,
    [input.hold_id, input.session_id, input.booking_id],
  );
  const hold = res.rows[0];
  if (!hold) {
    throw new AppError(ErrorCode.CONFLICT, "Hold is not active or has expired.");
  }
  await writeAuditEvent(
    {
      action: "slot.consumed",
      organizationId: hold.organization_id,
      branchId: hold.branch_id,
      resourceType: "slot_holds",
      resourceId: hold.id,
      metadata: { session_id: input.session_id, booking_id: input.booking_id },
    },
    tx,
  );
  return hold;
}

/**
 * Periodic sweep (task 8.1): transition stale `held` rows to `expired`.
 * Read-time checks already unblock capacity; the sweep keeps state truthful
 * for reporting and makes `slot_expired` auditable. Returns rows expired.
 */
export async function sweepExpiredHolds(ctx: AuthContext, branchId?: string): Promise<number> {
  const scope = branchId ? [branchId] : [];
  const branchFilter = branchId ? "and branch_id = $1" : "";
  const rows = await query<{ id: string; branch_id: string; organization_id: string }>(
    `update public.slot_holds set status = 'expired', updated_at = now()
     where status = 'held' and expires_at <= now() ${branchFilter}
     returning id, branch_id, organization_id`,
    scope,
  );
  for (const r of rows.rows) {
    // Sweeping is a system action; the sweep caller supplies an authorized
    // context (HQ). Fail-closed: audit failures abort the sweep iteration.
    await writeAuditEvent({
      action: "slot.expired",
      organizationId: r.organization_id,
      branchId: r.branch_id,
      actorUserId: ctx.actor.userId,
      actorType: "system",
      resourceType: "slot_holds",
      resourceId: r.id,
      metadata: { reason: "sweep" },
    });
  }
  return rows.rowCount;
}
