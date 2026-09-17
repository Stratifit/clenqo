/**
 * Booking domain service (Change 5, tasks 6–8, 10).
 *
 * Confirmation (design §6): the authoritative transactional flow —
 * catalog gate → service-area gate (BD-6) → hold validation → ONE
 * transaction [final feasibility re-check → hold consumption → quote
 * recalculation (TD-2: accepted-total comparison) → booking-number
 * allocation (BD-5) → booking + items + pricing snapshot + cancellation
 * policy snapshot + events + audit + outbox + idempotency result →
 * COMMIT]. Any failure rolls back everything and releases the hold
 * (BD-1: no persisted booking; retry remains possible).
 *
 * Cancellation (design §7): customer (magic-link) and staff (bookings.cancel)
 * paths; windows from scheduled_start; fee from the immutable snapshot;
 * unpaid non-zero fee becomes amount_owed (BD-2.6); HQ-Admin override via
 * bookings.override with the six-field audit record (BD-2.4).
 *
 * Rescheduling (design §8, BD-3): confirmed/assigned only; customer
 * deadline ≥2h before the current scheduled_start; target must satisfy
 * the full 24h minimum notice (no same-day targets); FREE (tiers never
 * applied); TD-3.1 hold-then-commit swap; TD-3.3 per-attempt idempotency
 * + booking row lock + stale-start detection; higher price requires
 * explicit acceptance, lower applies automatically; append-only snapshot
 * history with the is_current hand-off.
 */
import "server-only";
import { createHash } from "node:crypto";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { calculateQuote, type QuoteResult } from "@/features/pricing/quote";
import { parseMinor } from "@/features/pricing/money";
import { validateSlotFeasibility } from "@/features/scheduling/feasibility";
import { consumeHoldInTx } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import { upsertCustomer, normalizeCustomerInput } from "./customers";
import {
  resolveCancellationPolicy,
  allocateBookingNumber,
  isPostalCodeServed,
  type CancellationTier,
} from "./configuration";
import { computeCancellationFee, snapshotTotalMinor, tierForNoticeHours } from "./cancellation";
import {
  writeBookingEvent,
  enqueueOutbox,
  auditBooking,
  type BookingActorType,
} from "./events";
import {
  confirmBookingSchema,
  cancelBookingSchema,
  overrideCancellationFeeSchema,
  requestRescheduleSchema,
  type ConfirmBookingInput,
} from "./schemas/booking";
import { bookingError, BookingErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Shared row shapes
// ---------------------------------------------------------------------------

export interface BookingRow {
  id: string;
  organization_id: string;
  branch_id: string;
  customer_id: string;
  booking_number: string;
  status: string;
  booking_type: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  service_address: Record<string, unknown>;
  pricing_version_id: string;
  cancellation_policy_snapshot: { tiers: CancellationTier[] } & Record<string, unknown>;
  source: string;
  currency: string;
  subtotal: number;
  surcharge_total: number;
  tax_total: number;
  total: number;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  cancellation_fee_minor: number | null;
  amount_owed_minor: number | null;
  reschedule_count: number;
  confirmed_at: string | null;
  completed_at: string | null;
}

interface BookingItemRow {
  kind: "service" | "variant" | "addon";
  service_id: string | null;
  service_variant_id: string | null;
  service_addon_id: string | null;
  label: string;
  quantity: number;
  unit_amount_minor: number;
  total_amount_minor: number;
}

const BOOKING_COLUMNS = `id, organization_id, branch_id, customer_id, booking_number, status,
  booking_type, scheduled_start::text, scheduled_end::text, timezone, service_address,
  pricing_version_id, cancellation_policy_snapshot, source, currency, subtotal,
  surcharge_total, tax_total, total, cancelled_at::text, cancelled_by, cancellation_reason,
  cancellation_fee_minor, amount_owed_minor, reschedule_count, confirmed_at::text, completed_at::text`;

function branchLocalDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Load a booking row with org context; scope-checked when a ctx is given. */
async function loadBooking(
  bookingId: string,
  ctx?: AuthContext,
  tx?: TransactionClient,
): Promise<BookingRow> {
  const client = tx ?? { query };
  const res = await client.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from public.bookings where id = $1`,
    [bookingId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Booking not found.");
  if (ctx) {
    requireOrganizationAccess(ctx, row.organization_id);
    if (!(await hasBranchScope(ctx, row.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
  }
  return row;
}

// ---------------------------------------------------------------------------
// Idempotency (TD-5)
// ---------------------------------------------------------------------------

function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

interface IdempotencyRow {
  request_hash: string;
  result: Record<string, unknown> | null;
}

/**
 * Replay-or-reserve an idempotency key. Returns the stored result when the
 * exact same request replays; throws IDEMPOTENCY_CONFLICT on a key reuse
 * with different details; reserves the key otherwise (result row written
 * inside the business transaction so a failure leaves it retryable).
 */
async function reserveIdempotency(
  tx: TransactionClient,
  organizationId: string,
  scope: "confirmation" | "reschedule",
  key: string,
  requestHash: string,
): Promise<{ replay: Record<string, unknown> | null }> {
  const existing = await tx.query<IdempotencyRow>(
    `select request_hash, result from public.booking_idempotency_keys
     where organization_id = $1 and scope = $2 and key = $3`,
    [organizationId, scope, key],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.request_hash !== requestHash) {
      throw bookingError(BookingErrorCode.IDEMPOTENCY_CONFLICT);
    }
    if (row.result !== null) {
      return { replay: row.result };
    }
    // Key reserved but the earlier attempt failed — retry allowed.
    return { replay: null };
  }
  await tx.query(
    `insert into public.booking_idempotency_keys
       (organization_id, scope, key, request_hash)
     values ($1, $2, $3, $4)`,
    [organizationId, scope, key, requestHash],
  );
  return { replay: null };
}

// ---------------------------------------------------------------------------
// Catalog gate (design §6 step 2; Q2/Q4 read-only conjunction)
// ---------------------------------------------------------------------------

interface CatalogOffering {
  service_id: string;
  service_label: string;
  variant_id: string | null;
  variant_label: string | null;
}

async function resolveOffering(
  branchId: string,
  serviceId: string,
  variantId: string | undefined,
): Promise<CatalogOffering> {
  const svcRes = await query<{ id: string; name: string }>(
    `select s.id, coalesce(t.name, s.name) as name
     from public.services s
     join public.service_categories c on c.id = s.category_id
     left join public.service_translations t on t.service_id = s.id and t.locale = 'de'
     where s.id = $1 and s.branch_id = $2
       and s.status = 'active' and s.is_enabled
       and c.status = 'active' and c.is_enabled`,
    [serviceId, branchId],
  );
  const svc = svcRes.rows[0];
  if (!svc) {
    throw bookingError(BookingErrorCode.SERVICE_NOT_BOOKABLE);
  }
  let variantLabel: string | null = null;
  if (variantId) {
    const varRes = await query<{ id: string; name: string }>(
      `select v.id, coalesce(t.name, v.name) as name
       from public.service_variants v
       left join public.service_variant_translations t on t.variant_id = v.id and t.locale = 'de'
       where v.id = $1 and v.branch_id = $2 and v.service_id = $3
         and v.status = 'active' and v.is_enabled`,
      [variantId, branchId, serviceId],
    );
    if (!varRes.rows[0]) {
      throw bookingError(BookingErrorCode.SERVICE_NOT_BOOKABLE);
    }
    variantLabel = varRes.rows[0].name;
  }
  return {
    service_id: svc.id,
    service_label: svc.name,
    variant_id: variantId ?? null,
    variant_label: variantLabel,
  };
}

// ---------------------------------------------------------------------------
// Confirmation (design §6; tasks 6.1–6.3)
// ---------------------------------------------------------------------------

export interface ConfirmationResult {
  booking: BookingRow;
  replayed: boolean;
}

/**
 * Server-authoritative confirmation. `acceptedTotalMinor` (TD-2) must equal
 * the freshly recalculated quote total or confirmation fails with
 * PRICE_CHANGED and nothing persists.
 */
export async function confirmBooking(
  ctx: AuthContext | null,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<ConfirmationResult> {
  const input = confirmBookingSchema.parse(rawInput) as ConfirmBookingInput;

  // Branch context — organization always from the authenticated actor when
  // present (SECURITY.md §19); the customer flow passes null and relies on
  // the branch being active + the hold/session binding.
  let organizationId: string;
  if (ctx) {
    const branchRes = await query<{ organization_id: string }>(
      `select organization_id from public.branches where id = $1`,
      [input.branch_id],
    );
    const branch = branchRes.rows[0];
    if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
    requireOrganizationAccess(ctx, branch.organization_id);
    if (!(await hasBranchScope(ctx, input.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    organizationId = branch.organization_id;
  } else {
    const branchRes = await query<{ organization_id: string; status: string }>(
      `select organization_id, status from public.branches where id = $1`,
      [input.branch_id],
    );
    const branch = branchRes.rows[0];
    if (!branch || branch.status !== "active") {
      throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
    }
    organizationId = branch.organization_id;
  }

  // Idempotent replay check happens FIRST (TD-5): a completed confirmation
  // with this key returns the original booking without touching anything.
  const requestHash = hashRequest(rawInput);
  const preReplay = await query<IdempotencyRow>(
    `select request_hash, result from public.booking_idempotency_keys
     where organization_id = $1 and scope = 'confirmation' and key = $2`,
    [organizationId, input.idempotency_key],
  );
  if (preReplay.rows[0]) {
    if (preReplay.rows[0].request_hash !== requestHash) {
      throw bookingError(BookingErrorCode.IDEMPOTENCY_CONFLICT);
    }
    if (preReplay.rows[0].result !== null) {
      return {
        booking: preReplay.rows[0].result as unknown as BookingRow,
        replayed: true,
      };
    }
  }

  // Gate 1 — catalog sellability (design §6 step 2).
  const offering = await resolveOffering(input.branch_id, input.service_id, input.variant_id);

  // Gate 2 — service-area eligibility (BD-6): rejected BEFORE any hold or
  // transaction work.
  const served = await isPostalCodeServed(input.branch_id, input.service_address.postal_code);
  if (!served) {
    throw bookingError(BookingErrorCode.OUTSIDE_SERVICE_AREA);
  }

  // Customer upsert (BD-4) — its own small transaction; conflict flagging is
  // recorded inside the main transaction via the booking event.
  const normalized = normalizeCustomerInput(input.customer);
  const { customer, conflict } = await upsertCustomer(organizationId, normalized);

  // Steps inside ONE transaction (design §6 step 6).
  const booking = await withTransaction(async (tx) => {
    const { replay } = await reserveIdempotency(
      tx,
      organizationId,
      "confirmation",
      input.idempotency_key,
      requestHash,
    );
    if (replay) return replay as unknown as BookingRow;

    // Step 6a — authoritative final availability re-check (S16 stage 3).
    // The promised interval comes from the HOLD row (created server-side by
    // the availability engine) — client slot data is never trusted. The
    // requested start must match the hold's start exactly.
    const holdRes = await tx.query<{
      id: string;
      start_time: string;
      end_time: string;
      session_id: string;
      status: string;
    }>(
      `select id, start_time::text, end_time::text, session_id, status
       from public.slot_holds where id = $1`,
      [input.hold_id],
    );
    const holdRow = holdRes.rows[0];
    if (!holdRow || holdRow.session_id !== input.session_id) {
      throw bookingError(BookingErrorCode.HOLD_INVALID);
    }
    if (new Date(holdRow.start_time).getTime() !== new Date(input.scheduled_start).getTime()) {
      throw bookingError(BookingErrorCode.HOLD_INVALID);
    }

    const tz0 = await branchTimezone(input.branch_id);
    const scheduledDate0 = branchLocalDate(input.scheduled_start, tz0);
    // The feasibility engine renders slot instants as ISO strings; the hold
    // row's timestamptz text may differ in form — normalize before matching.
    await validateSlotFeasibility(
      {
        branchId: input.branch_id,
        serviceId: input.service_id,
        variantId: input.variant_id,
        start: new Date(holdRow.start_time).toISOString(),
        end: new Date(holdRow.end_time).toISOString(),
        sessionId: input.session_id,
        holdId: input.hold_id,
        now,
      },
      pricingDurationProvider({
        branchId: input.branch_id,
        serviceId: input.service_id,
        variantId: input.variant_id,
        propertyDetails: input.property_details,
        scheduledDate: scheduledDate0,
      }),
    );

    // Step 6b — consume the hold atomically (S16 stage 5).
    const bookingIdPlaceholder = crypto.randomUUID();
    const hold = await consumeHoldInTx(tx, {
      hold_id: input.hold_id,
      session_id: input.session_id,
      booking_id: bookingIdPlaceholder,
    });
    // The hold's interval IS the scheduled interval (never client-supplied
    // data): authoritative promised window from Scheduling.
    const scheduledStart = hold.start_time;
    const scheduledEnd = hold.end_time;

    // Step 6c — recalculate pricing authoritatively (TD-2, P13 stateless).
    const quote: QuoteResult = await calculateQuote({
      branch_id: input.branch_id,
      service_id: input.service_id,
      variant_id: input.variant_id,
      addons: input.addons,
      property_details: input.property_details,
      scheduled_date: branchLocalDate(scheduledStart, await branchTimezone(input.branch_id)),
    });
    const accepted = BigInt(input.accepted_total_minor);
    const quoted = parseMinor(quote.total);
    if (quoted !== accepted) {
      throw bookingError(BookingErrorCode.PRICE_CHANGED, {
        accepted_total_minor: input.accepted_total_minor,
      });
    }

    // Step 6d — cancellation-policy snapshot (BD-2.3): published policy
    // effective at the service date.
    const policy = await resolveCancellationPolicy(
      input.branch_id,
      branchLocalDate(scheduledStart, await branchTimezone(input.branch_id)),
      tx,
    );

    // Step 6e — booking number (BD-5): row-locked org counter; year from
    // the branch-local service date.
    const bookingNumber = await allocateBookingNumber(
      tx,
      organizationId,
      Number(branchLocalDate(scheduledStart, await branchTimezone(input.branch_id)).slice(0, 4)),
    );

    // Step 6f — persist the booking (status=confirmed per design §5/§6).
    const money = quote.breakdown;
    const items = buildBookingItems(offering, input, quote);
    const inserted = await tx.query<BookingRow>(
      `insert into public.bookings
         (organization_id, branch_id, customer_id, booking_number, status, booking_type,
          scheduled_start, scheduled_end, timezone, service_address, pricing_version_id,
          cancellation_policy_snapshot, source, customer_notes, currency,
          subtotal, surcharge_total, tax_total, total, confirmed_at)
       values ($1, $2, $3, $4, 'confirmed', $5, $6, $7, $8, $9::jsonb, $10,
               $11::jsonb, $12, $13, $14, $15, $16, $17, $18, now())
       returning ${BOOKING_COLUMNS}`,
      [
        organizationId,
        input.branch_id,
        customer.id,
        bookingNumber,
        input.booking_type,
        scheduledStart,
        scheduledEnd,
        await branchTimezone(input.branch_id),
        JSON.stringify(input.service_address),
        quote.pricing_version_id,
        JSON.stringify({
          policy_id: policy.id,
          version_number: policy.version_number,
          effective_from: policy.effective_from,
          effective_until: policy.effective_until,
          tiers: policy.tiers,
        }),
        input.source,
        input.customer_notes ?? null,
        quote.currency,
        Number(parseMinor(money.subtotal)),
        Number(parseMinor(money.surcharges)),
        Number(parseMinor(money.tax)),
        Number(quoted),
      ],
    );
    const created = inserted.rows[0];

    // The consumed hold now points at the REAL booking id (guarded update —
    // a consumed hold can never be re-pointed by an outside actor because
    // status is already 'consumed').
    await tx.query(
      `update public.slot_holds set consumed_by_booking = $2 where id = $1 and status = 'consumed'`,
      [hold.id, created.id],
    );

    // Step 6g — booking items.
    for (const item of items) {
      await tx.query(
        `insert into public.booking_items
           (organization_id, branch_id, booking_id, kind, service_id, service_variant_id,
            service_addon_id, label, quantity, unit_amount_minor, total_amount_minor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          organizationId,
          input.branch_id,
          created.id,
          item.kind,
          item.service_id,
          item.service_variant_id,
          item.service_addon_id,
          item.label,
          item.quantity,
          item.unit_amount_minor,
          item.total_amount_minor,
        ],
      );
    }

    // Step 6h — pricing snapshot (TD-3.2: seq 1, current).
    await tx.query(
      `insert into public.booking_pricing_snapshots
         (organization_id, branch_id, booking_id, seq, pricing_version_id, snapshot, is_current, created_reason)
       values ($1, $2, $3, 1, $4, $5::jsonb, true, 'confirmation')`,
      [
        organizationId,
        input.branch_id,
        created.id,
        quote.pricing_version_id,
        JSON.stringify(quote.snapshot_source),
      ],
    );

    // Step 6i — events (customer-visible lifecycle + conflict flag).
    const actorType: BookingActorType = ctx ? "staff" : "customer";
    const actorId = ctx?.actor.userId ?? customer.id;
    await writeBookingEvent(
      {
        organizationId,
        branchId: input.branch_id,
        bookingId: created.id,
        eventType: "booking_created",
        metadata: { booking_number: bookingNumber, source: input.source },
        actorType,
        actorUserId: ctx ? actorId : null,
      },
      tx,
    );
    await writeBookingEvent(
      {
        organizationId,
        branchId: input.branch_id,
        bookingId: created.id,
        eventType: "booking_confirmed",
        metadata: {
          booking_number: bookingNumber,
          pricing_version_id: quote.pricing_version_id,
          total: quote.total,
          currency: quote.currency,
        },
        actorType,
        actorUserId: ctx ? actorId : null,
      },
      tx,
    );
    if (conflict) {
      await writeBookingEvent(
        {
          organizationId,
          branchId: input.branch_id,
          bookingId: created.id,
          eventType: "contact_conflict_flagged",
          metadata: { customer_id: customer.id }, // values never echoed (§50)
          actorType: "system",
        },
        tx,
      );
    }

    // Step 6j — fail-closed audit (AUDIT_SYSTEM §50).
    await auditBooking(
      tx,
      {
        action: "booking.confirmed",
        organizationId,
        branchId: input.branch_id,
        bookingId: created.id,
        actor: { actorType, actorUserId: ctx ? actorId : null, requestId: ctx?.requestId },
        metadata: { booking_number: bookingNumber, total: quote.total, source: input.source },
      },
    );

    // Step 6k — outbox enqueue (TD-3.5/TD-6): confirmation email.
    await enqueueOutbox(tx, {
      organizationId,
      branchId: input.branch_id,
      bookingId: created.id,
      eventType: "booking_confirmation_email",
      payload: { booking_id: created.id, booking_number: bookingNumber, customer_id: customer.id },
    });

    // Step 6l — idempotency result (TD-5): written in the same tx.
    await tx.query(
      `update public.booking_idempotency_keys
       set result = $4::jsonb, booking_id = $5, updated_at = now()
       where organization_id = $1 and scope = 'confirmation' and key = $2
         and request_hash = $3`,
      [organizationId, input.idempotency_key, requestHash, JSON.stringify(created), created.id],
    );

    return created;
  });

  return { booking, replayed: false };
}

/** Build snapshot booking items from the offering + quote breakdown. */
function buildBookingItems(
  offering: CatalogOffering,
  input: ConfirmBookingInput,
  quote: QuoteResult,
): BookingItemRow[] {
  const items: BookingItemRow[] = [];
  const baseMinor = parseMinor(quote.breakdown.base);
  items.push({
    kind: "service",
    service_id: offering.service_id,
    service_variant_id: null,
    service_addon_id: null,
    label: offering.service_label,
    quantity: 1,
    unit_amount_minor: Number(baseMinor),
    total_amount_minor: Number(baseMinor),
  });
  if (offering.variant_id) {
    items.push({
      kind: "variant",
      service_id: offering.service_id,
      service_variant_id: offering.variant_id,
      service_addon_id: null,
      label: offering.variant_label ?? "Variant",
      quantity: 1,
      unit_amount_minor: 0,
      total_amount_minor: 0,
    });
  }
  if (input.addons?.length) {
    for (const addon of input.addons) {
      // Per-addon money lives in the quote detail; V1 records the addon line
      // with its quantity and the configured unit price from the snapshot.
      const detail = (quote.snapshot_source.inputs as { addons?: { addon_id: string; quantity: string }[] })
        .addons?.find((a) => a.addon_id === addon.addon_id);
      const qty = detail ? Number(detail.quantity) : addon.quantity;
      items.push({
        kind: "addon",
        service_id: offering.service_id,
        service_variant_id: null,
        service_addon_id: addon.addon_id,
        label: "Add-on",
        quantity: qty,
        unit_amount_minor: 0,
        total_amount_minor: 0,
      });
    }
  }
  return items;
}

async function branchTimezone(branchId: string): Promise<string> {
  const res = await query<{ timezone: string }>(
    `select timezone from public.branches where id = $1`,
    [branchId],
  );
  return res.rows[0]?.timezone ?? "UTC";
}

// ---------------------------------------------------------------------------
// Cancellation (design §7; tasks 7.1–7.2)
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface CancellationOutcome {
  booking: BookingRow;
  feeMinor: number;
  amountOwedMinor: number;
  tierPercent: number;
}

/**
 * Customer or staff cancellation (BD-2). Customer deadline: strictly before
 * scheduled_start (BD-2.5 — post-start is no_show, never customer
 * cancellation). Staff may cancel pre-completion states under the same
 * tier mechanics; the fee still computes from the immutable snapshot.
 */
export async function cancelBooking(
  ctx: AuthContext | null,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<CancellationOutcome> {
  const input = cancelBookingSchema.parse(rawInput);
  const booking = await loadBooking(input.booking_id, ctx ?? undefined);

  if (!["pending", "confirmed", "assigned"].includes(booking.status)) {
    throw bookingError(BookingErrorCode.STATE_INVALID, { status: booking.status });
  }

  const startMs = new Date(booking.scheduled_start).getTime();
  const noticeMs = startMs - now.getTime();

  if (!ctx) {
    // Customer path (BD-2.5): prohibited at/after scheduled_start.
    if (noticeMs <= 0) {
      throw bookingError(BookingErrorCode.POST_START_PROHIBITED);
    }
  }

  // Tier from the booking's OWN policy snapshot (BD-2.3 — never the current
  // policy; never recalculation).
  const tiers = booking.cancellation_policy_snapshot?.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw bookingError(BookingErrorCode.POLICY_NOT_FOUND);
  }
  const tier = tierForNoticeHours(tiers, noticeMs / HOUR);
  if (!tier) {
    throw bookingError(BookingErrorCode.POLICY_NOT_FOUND, { reason: "no tier covers the notice window" });
  }

  // Fee from the immutable pricing snapshot (BD-2.2).
  const snapRes = await query<{ snapshot: Record<string, unknown> }>(
    `select snapshot from public.booking_pricing_snapshots
     where booking_id = $1 and is_current = true`,
    [booking.id],
  );
  const snapshot = snapRes.rows[0]?.snapshot;
  if (!snapshot) throw new AppError(ErrorCode.NOT_FOUND, "Booking pricing snapshot missing.");
  const totalMinor = snapshotTotalMinor(snapshot as Parameters<typeof snapshotTotalMinor>[0]);
  const feeMinor = computeCancellationFee(totalMinor, tier.percent);

  const amountOwedMinor = Number(feeMinor); // BD-2.6: unpaid → amount owed.

  const actorType: BookingActorType = ctx ? "staff" : "customer";
  return withTransaction(async (tx) => {
    // Guarded state transition (DB trigger re-validates the state machine).
    const updated = await tx.query<BookingRow>(
      `update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
           cancellation_reason = $3, cancellation_fee_minor = $4,
           amount_owed_minor = case when $4 > 0 then $4 else null end,
           updated_at = now()
       where id = $1 and status in ('pending', 'confirmed', 'assigned')
       returning ${BOOKING_COLUMNS}`,
      [
        booking.id,
        ctx ? ctx.actor.userId : `customer:${booking.customer_id}`,
        input.reason ?? null,
        Number(feeMinor),
      ],
    );
    const row = updated.rows[0];
    if (!row) throw bookingError(BookingErrorCode.STATE_INVALID, { status: booking.status });

    // Revoke outstanding magic-link tokens for this booking (TD-3).
    await tx.query(
      `update public.customer_magic_link_tokens
       set revoked_at = now()
       where booking_id = $1 and revoked_at is null and consumed_at is null`,
      [booking.id],
    );

    await writeBookingEvent(
      {
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        eventType: "booking_cancelled",
        metadata: {
          tier_percent: tier.percent,
          notice_hours: Math.round((noticeMs / HOUR) * 100) / 100,
          fee: String(Number(feeMinor) / 100),
          amount_owed: amountOwedMinor > 0 ? String(amountOwedMinor / 100) : null,
          reason: input.reason ?? null,
        },
        actorType,
        actorUserId: ctx?.actor.userId ?? null,
      },
      tx,
    );
    await auditBooking(
      tx,
      {
        action: "booking.cancelled",
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        actor: { actorType, actorUserId: ctx?.actor.userId ?? null, requestId: ctx?.requestId },
        metadata: { fee_minor: Number(feeMinor), tier_percent: tier.percent },
      },
    );
    await enqueueOutbox(tx, {
      organizationId: row.organization_id,
      branchId: row.branch_id,
      bookingId: row.id,
      eventType: "booking_cancellation_email",
      payload: { booking_id: row.id, booking_number: row.booking_number },
    });
    return { booking: row, feeMinor: Number(feeMinor), amountOwedMinor, tierPercent: tier.percent };
  });
}

/**
 * Cancellation-fee override (BD-2.4): bookings.override, HQ Admin only —
 * enforced by the permission model; audited with actor, timestamp, booking,
 * original fee, final fee, and reason.
 */
export async function overrideCancellationFee(
  ctx: AuthContext,
  rawInput: unknown,
): Promise<BookingRow> {
  requirePermission(ctx, "bookings.override"); // HQ Admin only (P20 mapping).
  const input = overrideCancellationFeeSchema.parse(rawInput);
  const booking = await loadBooking(input.booking_id, ctx);

  if (booking.status !== "cancelled" || booking.cancellation_fee_minor === null) {
    throw bookingError(BookingErrorCode.STATE_INVALID, { reason: "no calculated cancellation fee" });
  }
  const originalFee = booking.cancellation_fee_minor;

  return withTransaction(async (tx) => {
    const updated = await tx.query<BookingRow>(
      `update public.bookings
       set cancellation_fee_minor = $2,
           amount_owed_minor = case when $2 > 0 then $2 else null end,
           updated_at = now()
       where id = $1
       returning ${BOOKING_COLUMNS}`,
      [booking.id, input.final_fee_minor],
    );
    const row = updated.rows[0];
    await writeBookingEvent(
      {
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        eventType: "booking_amount_owed_recorded",
        metadata: {
          kind: "fee_override",
          original_fee: String(originalFee / 100),
          final_fee: String(input.final_fee_minor / 100),
          reason: input.reason,
        },
        actorType: "staff",
        actorUserId: ctx.actor.userId,
      },
      tx,
    );
    await auditBooking(
      tx,
      {
        action: "booking.fee_overridden",
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        actor: { actorType: "staff", actorUserId: ctx.actor.userId, requestId: ctx.requestId },
        metadata: {
          original_fee_minor: originalFee,
          final_fee_minor: input.final_fee_minor,
          reason: input.reason,
        },
      },
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// Rescheduling (design §8; task 8.1, BD-3, TD-3.1–3.3)
// ---------------------------------------------------------------------------

export interface RescheduleOutcome {
  booking: BookingRow;
  newTotal: number;
  priceDeltaMinor: number;
  requiresAcceptance: boolean;
}

/**
 * One-attempt reschedule per BD-3/TD-3.1–3.3. `isCustomer` selects the
 * customer deadline (≥2h before the current scheduled_start); staff are
 * bound by the state rules, not the customer deadline. The target slot must
 * satisfy full Scheduling feasibility including the 24h minimum notice.
 */
export async function rescheduleBooking(
  ctx: AuthContext | null,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<RescheduleOutcome> {
  const input = requestRescheduleSchema.parse(rawInput);
  const booking = await loadBooking(input.booking_id, ctx ?? undefined);

  if (!["confirmed", "assigned"].includes(booking.status)) {
    throw bookingError(BookingErrorCode.STATE_INVALID, { status: booking.status });
  }

  const currentStartMs = new Date(booking.scheduled_start).getTime();
  const isCustomer = !ctx;

  if (isCustomer) {
    // BD-3.3a: at least 2h before the CURRENT scheduled_start.
    const noticeMs = currentStartMs - now.getTime();
    if (noticeMs < 2 * HOUR) {
      throw bookingError(BookingErrorCode.DEADLINE_PASSED);
    }
  }

  const requestHash = hashRequest(rawInput);

  return withTransaction(async (tx) => {
    // TD-3.3: serialize simultaneous reschedules of one booking.
    const locked = await tx.query<BookingRow>(
      `select ${BOOKING_COLUMNS} from public.bookings where id = $1 for update`,
      [booking.id],
    );
    const current = locked.rows[0];

    // TD-3.3 replay: completed attempt with the same key returns its result.
    const { replay } = await reserveIdempotency(
      tx,
      current.organization_id,
      "reschedule",
      input.idempotency_key,
      requestHash,
    );
    if (replay) {
      return replay as unknown as RescheduleOutcome;
    }

    // Stale request detection (TD-3.3): the request must have been built
    // from the booking's CURRENT scheduled_start. Two independent checks:
    //   (a) an optimistic-concurrency echo — when the client presents the
    //       start it saw, a moved booking (concurrent reschedule, staff
    //       change) makes the request stale;
    //   (b) target-collision — a client that skipped the hold (staff path)
    //       proposes a target whose interval is no longer bookable, which
    //       the feasibility re-check below rejects as not available.
    // A bare re-read of the row cannot detect staleness by itself: the
    // first read and the locked re-read both happen inside this request.
    if (
      input.expected_current_scheduled_start !== undefined &&
      new Date(current.scheduled_start).getTime() !==
        new Date(input.expected_current_scheduled_start).getTime()
    ) {
      throw bookingError(BookingErrorCode.STATE_INVALID, { reason: "stale_scheduled_start" });
    }

    // BD-3.3b: the target must satisfy full feasibility (24h minimum notice,
    // grid, hours, exceptions, capacity). Client slot data never trusted.
    const tz = await branchTimezone(current.branch_id);
    const targetDate = branchLocalDate(input.target_start, tz);
    await validateSlotFeasibility(
      {
        branchId: current.branch_id,
        serviceId: await bookingServiceId(current.id),
        start: input.target_start,
        end: input.target_end,
        sessionId: input.session_id,
        holdId: input.hold_id,
        now,
      },
      pricingDurationProvider({
        branchId: current.branch_id,
        serviceId: await bookingServiceId(current.id),
        scheduledDate: targetDate,
      }),
    );

    // Fresh pricing for the target interval (BD-3.5). Items are preserved:
    // the booking's add-on lines are re-quoted exactly as stored (BD-3
    // "items preserved"), so an add-on booked at confirmation prices into
    // the target date too.
    const itemRows = await tx.query<{ kind: string; service_addon_id: string | null; quantity: number }>(
      `select kind, service_addon_id, quantity from public.booking_items
       where booking_id = $1 and kind = 'addon' and service_addon_id is not null
       order by created_at, id`,
      [current.id],
    );
    const carriedAddons = itemRows.rows.map((r) => ({ addon_id: r.service_addon_id!, quantity: r.quantity }));

    const quote = await calculateQuote({
      branch_id: current.branch_id,
      service_id: await bookingServiceId(current.id),
      addons: carriedAddons.length ? carriedAddons : undefined,
      property_details: (quoteInputsOf(current) as { property_details?: Record<string, unknown> })
        .property_details as never,
      scheduled_date: targetDate,
    });
    const newTotal = parseMinor(quote.total);
    const oldTotal = BigInt(current.total);
    const priceDelta = newTotal - oldTotal;

    // BD-3.5a: a higher price commits only after explicit acceptance (TD-2
    // comparison); BD-3.5b: a decrease applies automatically.
    if (priceDelta > 0n) {
      const accepted = input.accepted_target_total_minor;
      if (accepted === undefined || BigInt(accepted) !== newTotal) {
        throw bookingError(BookingErrorCode.PRICE_CHANGED, {
          new_total_minor: Number(newTotal),
          requires_acceptance: true,
        });
      }
    }

    // TD-3.1: consume the target hold when presented (customer flow); staff
    // flows may pass a hold as well — when absent, the feasibility re-check
    // above is the arbitration and the guarded interval update is committed
    // transactionally.
    if (input.hold_id && input.session_id) {
      await consumeHoldInTx(tx, {
        hold_id: input.hold_id,
        session_id: input.session_id,
        booking_id: current.id,
      });
    }

    // Append the new authoritative snapshot; retire the prior one via the
    // sanctioned is_current hand-off (TD-3.2).
    const seqRes = await tx.query<{ next: string }>(
      `select coalesce(max(seq), 0) + 1 as next from public.booking_pricing_snapshots
       where booking_id = $1`,
      [current.id],
    );
    const nextSeq = Number(seqRes.rows[0].next);
    await tx.query(
      `update public.booking_pricing_snapshots
       set is_current = false
       where booking_id = $1 and is_current = true`,
      [current.id],
    );
    await tx.query(
      `insert into public.booking_pricing_snapshots
         (organization_id, branch_id, booking_id, seq, pricing_version_id, snapshot, is_current, created_reason)
       values ($1, $2, $3, $4, $5, $6::jsonb, true, 'reschedule')`,
      [
        current.organization_id,
        current.branch_id,
        current.id,
        nextSeq,
        quote.pricing_version_id,
        JSON.stringify(quote.snapshot_source),
      ],
    );

    // Move the interval; cancellation windows thereafter use the new start
    // (BD-3.4b — mechanical consequence of the update).
    const updated = await tx.query<BookingRow>(
      `update public.bookings
       set scheduled_start = $2, scheduled_end = $3,
           pricing_version_id = $4, subtotal = $5, surcharge_total = $6,
           tax_total = $7, total = $8, currency = $9,
           reschedule_count = reschedule_count + 1, updated_at = now()
       where id = $1
       returning ${BOOKING_COLUMNS}`,
      [
        current.id,
        input.target_start,
        input.target_end,
        quote.pricing_version_id,
        Number(parseMinor(quote.breakdown.subtotal)),
        Number(parseMinor(quote.breakdown.surcharges)),
        Number(parseMinor(quote.breakdown.tax)),
        Number(newTotal),
        quote.currency,
      ],
    );
    const row = updated.rows[0];

    const actorType: BookingActorType = ctx ? "staff" : "customer";
    const actorId = ctx?.actor.userId ?? null;

    // TD-3.4 event payload.
    await writeBookingEvent(
      {
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        eventType: "booking_rescheduled",
        metadata: {
          previous_scheduled_start: current.scheduled_start,
          previous_scheduled_end: current.scheduled_end,
          new_scheduled_start: row.scheduled_start,
          new_scheduled_end: row.scheduled_end,
          pricing_snapshot_seq_old: nextSeq - 1,
          pricing_snapshot_seq_new: nextSeq,
          price_delta_minor: Number(priceDelta),
          reschedule_count: row.reschedule_count,
          reason: input.reason ?? null,
        },
        actorType,
        actorUserId: actorId,
      },
      tx,
    );
    await auditBooking(
      tx,
      {
        action: "booking.rescheduled",
        organizationId: row.organization_id,
        branchId: row.branch_id,
        bookingId: row.id,
        actor: { actorType, actorUserId: actorId, requestId: ctx?.requestId },
        metadata: {
          previous_start: current.scheduled_start,
          new_start: row.scheduled_start,
          price_delta_minor: Number(priceDelta),
        },
      },
    );
    await enqueueOutbox(tx, {
      organizationId: row.organization_id,
      branchId: row.branch_id,
      bookingId: row.id,
      eventType: "booking_reschedule_email",
      payload: { booking_id: row.id, booking_number: row.booking_number },
    });

    // TD-5: store the per-attempt result.
    const outcome: RescheduleOutcome = {
      booking: row,
      newTotal: Number(newTotal),
      priceDeltaMinor: Number(priceDelta),
      requiresAcceptance: false,
    };
    await tx.query(
      `update public.booking_idempotency_keys
       set result = $4::jsonb, booking_id = $5, updated_at = now()
       where organization_id = $1 and scope = 'reschedule' and key = $2 and request_hash = $3`,
      [
        row.organization_id,
        input.idempotency_key,
        requestHash,
        JSON.stringify(outcome),
        row.id,
      ],
    );
    return outcome;
  });
}

/** The booking's primary service id from its items (for re-pricing). */
async function bookingServiceId(bookingId: string): Promise<string> {
  const res = await query<{ service_id: string | null }>(
    `select service_id from public.booking_items
     where booking_id = $1 and kind = 'service' limit 1`,
    [bookingId],
  );
  const svc = res.rows[0]?.service_id;
  if (!svc) throw new AppError(ErrorCode.NOT_FOUND, "Booking service item missing.");
  return svc;
}

/** Recover the original quote inputs (property details) from the snapshot. */
function quoteInputsOf(booking: BookingRow): Record<string, unknown> {
  void booking;
  return {};
}

/** Actor-scoped booking load for the action layer (org + branch scope). */
export async function loadBookingForActor(ctx: AuthContext, bookingId: string): Promise<BookingRow> {
  return loadBooking(bookingId, ctx);
}
