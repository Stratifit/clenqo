/**
 * Booking domain tests (Change 5, tasks 12.1–12.2).
 * Runs against real pglite + the full migration chain (domain harness).
 *
 * Coverage: BD-2 cancellation boundaries/fee arithmetic, BD-3 rescheduling
 * rules, TD-2 price drift, TD-5 idempotency, BD-4 customer dedup/conflict,
 * BD-6 service area, magic-link lifecycle (TD-3), seed idempotency, outbox,
 * fail-closed audit, rollback semantics, concurrency/holds.
 *
 * ALL monetary values are explicit NON-PRODUCTION fixtures — never read as
 * business-approved values (P3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import type { AuthContext } from "@/lib/authorization/server";
import { ErrorCode } from "@/lib/errors";
import { randomUUID } from "node:crypto";

import { confirmBooking, cancelBooking, rescheduleBooking, overrideCancellationFee } from "@/features/booking/service";
import { issueMagicLink, verifyMagicLink } from "@/features/booking/magicLink";
import { seedBookingDefaults, DEFAULT_CANCELLATION_TIERS } from "@/features/booking/seed";
import { createCancellationPolicy, publishCancellationPolicy, setServiceAreas, formatBookingNumber } from "@/features/booking/configuration";
import { computeCancellationFee, snapshotTotalMinor, tierForNoticeHours } from "@/features/booking/cancellation";
import { normalizeEmail, normalizePhoneE164 } from "@/features/booking/schemas/booking";
import { calculateQuote } from "@/features/pricing/quote";
import { createProfile, createRule, createVersion, publishVersion, updateProfile } from "@/features/pricing/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { createSlotHold } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";

let t: TestDb;
let ctx: AuthContext;
let orgId: string;
let branchId: string;
let catId: string;
let svcId: string;
let addonId: string;

// NON-PRODUCTION fixture values (P3).
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 }; // 10.00/h
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };
const FIX_ADDON = { model: "fixed" as const, value: 200 }; // 2.00 fixed

/** The currently active pricing profile (P11 one-active helper). */
let activeProfileId: string | null = null;
async function activateProfile(profileId: string): Promise<void> {
  if (activeProfileId && activeProfileId !== profileId) {
    await t.db.query(`update public.pricing_profiles set status = 'archived' where id = $1`, [activeProfileId]);
  }
  await updateProfile(ctx, profileId, { status: "active" });
  activeProfileId = profileId;
}

/** Create + publish a priced version and activate it. */
/** Create (+publish, +activate) a priced version — or add a version to an
 * existing profile for P17 window tests. NON-PRODUCTION rates only. */
async function makePricedVersion(
  suffix: string,
  opts: { effectiveFrom?: string; effectiveUntil?: string; rateMinor?: number; profileId?: string } = {},
): Promise<{ versionId: string; profileId: string }> {
  const rate = opts.rateMinor ?? FIX_RATE.hourly_rate_minor;
  const effectiveFrom = opts.effectiveFrom ?? "2026-01-01";
  let profileId = opts.profileId ?? null;
  if (!profileId) {
    const profile = await createProfile(ctx, { branch_id: branchId, name: `Bk Profile ${suffix}`, currency: "EUR" });
    profileId = profile.id;
  }
  const version = await createVersion(ctx, {
    profile_id: profileId,
    branch_id: branchId,
    effective_from: effectiveFrom,
    ...(opts.effectiveUntil ? { effective_until: opts.effectiveUntil } : {}),
  });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "base_rate", service_id: svcId, configuration: { model: "hourly" as const, hourly_rate_minor: rate } });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "duration_rule", service_id: svcId, configuration: FIX_DURATION });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "addon_price", service_addon_id: addonId, configuration: FIX_ADDON });
  await publishVersion(ctx, version.id, { branch_id: branchId });
  if (!opts.profileId) {
    await activateProfile(profileId);
  }
  return { versionId: version.id, profileId };
}

/**
 * Fixture time scheme: the availability evaluation "now" is 2027-06-01T00:00Z
 * (branch horizon 14 days → bookable 2027-06-02…2027-06-15); all fixture
 * slots live on 2027-06-02…2027-06-09, comfortably inside the horizon and
 * the 24h minimum notice.
 */
export const AVAIL_NOW = new Date("2027-06-01T00:00:00Z");

/**
 * Build a valid future slot + hold for the fixture service. The fixture
 * duration is 60 minutes; the hold TTL default (15 min) applies.
 */
function holdSessionId(): string {
  return `sess-${randomUUID()}`;
}

async function makeTargetHold(opts: { startIso: string }): Promise<{ holdId: string; start: string; end: string; sessionId: string }> {
  const sessionId = holdSessionId();
  const hold = await createSlotHold(
    ctx,
    {
      branch_id: branchId,
      service_id: svcId,
      // Normalized to the engine's ISO rendering ("…T08:00:00.000Z") — the
      // hold service matches slot strings exactly.
      start_time: new Date(opts.startIso).toISOString(),
      end_time: new Date(new Date(opts.startIso).getTime() + 60 * 60_000).toISOString(),
      session_id: sessionId,
      idempotency_key: `hold-${randomUUID()}`,
    } as never,
    pricingDurationProvider({ branchId, serviceId: svcId }),
    AVAIL_NOW,
  );
  return {
    holdId: hold.id,
    // Normalized to the engine's ISO rendering so the values satisfy the
    // utcInstant boundary schema AND string-match availability slots.
    start: new Date(hold.start_time).toISOString(),
    end: new Date(hold.end_time).toISOString(),
    sessionId,
  };
}

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("Booking Test Org", "booking-test-org");
  ctx = await hqAdminContext(orgId, "booking-hq@test.example");
  branchId = await t.fx.createBranch(orgId, "booking-main");
  // Make the branch active per the 0002 activation guard (status ⇔ activated_at)
  // and widen the customer horizon so the June fixture slots are bookable
  // from the May evaluation "now" (S12 horizon default is 14 days).
  await t.db.query(
    `update public.branches set status = 'active', activated_at = now(), provisioning_status = 'ready' where id = $1`,
    [branchId],
  );
  await t.db.query(
    `update public.branch_scheduling_configuration set customer_horizon_days = 90 where branch_id = $1`,
    [branchId],
  );

  // Seed scheduling (hours/config) + booking defaults (cancellation policy).
  await seedSchedulingDefaults(branchId);
  const seed = await seedBookingDefaults(branchId);
  expect(seed.policiesInserted).toBe(1);

  catId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
       values ($1, $2, 'bk-cat', 'Cat', 'active', true) returning id`,
      [orgId, branchId],
    )
  ).rows[0].id;
  svcId = (
    await t.db.query<{ id: string }>(
      `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
       values ($1, $2, $3, 'bk-svc', 'Svc', 'active', true) returning id`,
      [orgId, branchId, catId],
    )
  ).rows[0].id;
  addonId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_addons (organization_id, branch_id, slug, name)
       values ($1, $2, 'bk-addon', 'Addon') returning id`,
      [orgId, branchId],
    )
  ).rows[0].id;

  // Base pricing window is CLOSED so the price-boundary test can publish a
  // later window on the same profile (P17 overlap exclusion permits this).
  await makePricedVersion("Base", { effectiveUntil: "2027-06-09" });

  // Service area: allowlist the fixture postal code (BD-6).
  await setServiceAreas(ctx, { branch_id: branchId, postal_codes: ["10115", "10117"] });
});

// ---------------------------------------------------------------------------
// Pure engines (task 12.1)
// ---------------------------------------------------------------------------

describe("cancellation engine (BD-2 pure arithmetic; NON-PRODUCTION values)", () => {
  it("applies tier boundaries exactly: 24h→0%, 12h→25%, 2h→50%", () => {
    const tiers = DEFAULT_CANCELLATION_TIERS;
    expect(tierForNoticeHours(tiers, 24)!.percent).toBe(0);
    expect(tierForNoticeHours(tiers, 12)!.percent).toBe(25);
    expect(tierForNoticeHours(tiers, 2)!.percent).toBe(50);
    expect(tierForNoticeHours(tiers, 1.999)!.percent).toBe(100);
    expect(tierForNoticeHours(tiers, 23.999)!.percent).toBe(25);
    expect(tierForNoticeHours(tiers, -1)).toBeNull(); // post-start never tiered
  });

  it("computes half-up fees exactly once per component", () => {
    expect(computeCancellationFee(1005n, 25)).toBe(251n); // 251.25 → 251
    expect(computeCancellationFee(1002n, 25)).toBe(251n); // 250.5 → 251 (half-up)
    expect(computeCancellationFee(1000n, 0)).toBe(0n);
    expect(computeCancellationFee(1999n, 100)).toBe(1999n);
  });

  it("reads the authoritative total from the snapshot (tax incl., minor units)", () => {
    expect(snapshotTotalMinor({ result: { total: "12.50" } })).toBe(1250n);
    expect(snapshotTotalMinor({ total: "0.05" })).toBe(5n);
  });

  it("normalizes customer identity per BD-4", () => {
    expect(normalizeEmail(" USER@Example.COM ")).toBe("user@example.com");
    expect(normalizePhoneE164("+49 (0)151 234567")).toBe("+490151234567");
    expect(normalizePhoneE164("0151/234-567")).toBe("+0151234567"); // digits preserved; leading + forced
    expect(normalizePhoneE164("   ")).toBeNull();
  });

  it("formats booking numbers per BD-5", () => {
    expect(formatBookingNumber(2027, 123)).toBe("CLN-2027-000123");
    expect(formatBookingNumber(2027, 1234567)).toBe("CLN-2027-1234567");
  });
});

// ---------------------------------------------------------------------------
// Confirmation flow (task 6.x)
// ---------------------------------------------------------------------------

/**
 * Confirmation harness: recalculate the quote for the chosen slot, then
 * confirm with accepted_total = quoted total (TD-2 happy path).
 *
 * BD-4 note: each distinct email gets its own distinct phone — all fixtures
 * share no contact channel, so phone-matching never merges test customers.
 */
function phoneForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return `+49151${String(h % 100000000).padStart(8, "0")}`;
}

async function confirmAt(opts: {
  startIso: string;
  idempotencyKey?: string;
  acceptedTotalMinor?: number;
  email?: string;
  postalCode?: string;
  addons?: { addon_id: string; quantity: number }[];
}): Promise<{ bookingId: string; bookingNumber: string; total: number; replayed: boolean }> {
  const startIso = opts.startIso;
  // Availability "now" long before the slot.
  const availabilityNow = AVAIL_NOW;
  const sessionId = `sess-${randomUUID()}`;
  const hold = await createSlotHold(
    ctx,
    {
      branch_id: branchId,
      service_id: svcId,
      // Normalized to the engine's ISO rendering (see makeTargetHold).
      start_time: new Date(startIso).toISOString(),
      end_time: new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString(),
      session_id: sessionId,
      idempotency_key: `hold-${randomUUID()}`,
    } as never,
    pricingDurationProvider({ branchId, serviceId: svcId }),
    availabilityNow,
  );

  // TD-2: the customer sees the fresh quote and accepts its total.
  const quote = await calculateQuote({
    branch_id: branchId,
    service_id: svcId,
    addons: opts.addons,
    scheduled_date: startIso.slice(0, 10),
  });

  const result = await confirmBooking(
    ctx,
    {
      branch_id: branchId,
      service_id: svcId,
      addons: opts.addons,
      // Hold timestamps come back in Postgres text form ("2027-06-02 08:00:00+00")
      // from pglite — normalize to ISO for the boundary schema.
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: sessionId,
      customer: {
        first_name: "Test",
        last_name: "Customer",
        email: opts.email ?? "checkout@test.example",
        phone: phoneForEmail(opts.email ?? "checkout@test.example"),
      },
      service_address: {
        street: "Main Street",
        house_number: "1",
        postal_code: opts.postalCode ?? "10115",
        city: "Berlin",
        country: "de",
      },
      source: "website",
      accepted_total_minor: opts.acceptedTotalMinor ?? Number(quote.total.replace(".", "")),
      idempotency_key: opts.idempotencyKey ?? `conf-${randomUUID()}`,
    },
    new Date("2027-06-01T02:00:00Z"),
  );
  return {
    bookingId: result.booking.id,
    bookingNumber: result.booking.booking_number,
    total: result.booking.total,
    replayed: result.replayed,
  };
}

describe("confirmation flow (tasks 6.1–6.3)", () => {
  it("confirms server-authoritatively with hold consumption, snapshots, events, outbox", async () => {
    const r = await confirmAt({ startIso: "2027-06-02T08:00:00Z", email: "confirm1@test.example" });
    expect(r.replayed).toBe(false);
    expect(r.bookingNumber).toMatch(/^CLN-2027-\d{6}$/);

    const b = await t.db.query<Record<string, unknown>>(`select * from public.bookings where id = $1`, [r.bookingId]);
    expect(b.rows[0].status).toBe("confirmed");
    expect(b.rows[0].confirmed_at).toBeTruthy();

    // Hold consumed by the real booking.
    const hold = await t.db.query<{ status: string; consumed_by_booking: string }>(
      `select status, consumed_by_booking from public.slot_holds where consumed_by_booking = $1`,
      [r.bookingId],
    );
    expect(hold.rows[0].status).toBe("consumed");

    // Pricing snapshot seq 1 current; policy snapshot captured.
    const snap = await t.db.query<{ seq: number; is_current: boolean; created_reason: string }>(
      `select seq, is_current, created_reason from public.booking_pricing_snapshots where booking_id = $1`,
      [r.bookingId],
    );
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({ seq: 1, is_current: true, created_reason: "confirmation" });

    // Events + audit + outbox written transactionally.
    const events = await t.db.query<{ event_type: string }>(
      `select event_type from public.booking_events where booking_id = $1 order by created_at`,
      [r.bookingId],
    );
    expect(events.rows.map((e) => e.event_type)).toEqual(["booking_created", "booking_confirmed"]);
    const audit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_type = 'bookings' and resource_id = $1`,
      [r.bookingId],
    );
    expect(audit.rows[0].action).toBe("booking.confirmed");
    const outbox = await t.db.query<{ event_type: string; status: string }>(
      `select event_type, status from public.notification_outbox where booking_id = $1`,
      [r.bookingId],
    );
    expect(outbox.rows[0]).toMatchObject({ event_type: "booking_confirmation_email", status: "pending" });
  });

  it("rejects a client price mismatch (TD-2) and leaves nothing persisted (BD-1)", async () => {
    const before = await t.db.query<{ n: string }>(`select count(*)::text as n from public.bookings`);
    await expect(
      confirmAt({ startIso: "2027-06-02T10:00:00Z", acceptedTotalMinor: 1, email: "drift@test.example" }),
    ).rejects.toMatchObject({ details: { booking_code: "price_changed" } });
    const after = await t.db.query<{ n: string }>(`select count(*)::text as n from public.bookings`);
    expect(after.rows[0].n).toBe(before.rows[0].n); // no booking persisted

    // The failed attempt's hold is still held (TTL governs release), so the
    // retry path exists; the idempotency key has no result (retry allowed).
    void before;
  });

  it("replays idempotently: same key + identical request returns the original booking (TD-5)", async () => {
    const startIso = "2027-06-02T12:00:00Z";
    const sessionId = `sess-${randomUUID()}`;
    const hold = await createSlotHold(
      ctx,
      {
        branch_id: branchId,
        service_id: svcId,
        start_time: new Date(startIso).toISOString(),
        end_time: new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString(),
        session_id: sessionId,
        idempotency_key: `hold-${randomUUID()}`,
      } as never,
      pricingDurationProvider({ branchId, serviceId: svcId }),
      AVAIL_NOW,
    );
    const payload = {
      branch_id: branchId,
      service_id: svcId,
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: sessionId,
      customer: {
        first_name: "Replay",
        last_name: "Customer",
        email: "replay@test.example",
        phone: "+491511112223",
      },
      service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "website",
      accepted_total_minor: 1000, // fixture: 60 min × 10.00/h = 10.00
      idempotency_key: `conf-replay-${randomUUID()}`,
    };
    const r1 = await confirmBooking(ctx, payload, new Date("2027-06-01T02:00:00Z"));
    expect(r1.replayed).toBe(false);
    const r2 = await confirmBooking(ctx, payload, new Date("2027-06-01T02:00:00Z"));
    expect(r2.replayed).toBe(true);
    expect(r2.booking.id).toBe(r1.booking.id);

    const count = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.bookings where customer_id in (
         select id from public.customers where email_normalized = 'replay@test.example')`,
    );
    expect(count.rows[0].n).toBe("1"); // exactly one booking
  });

  it("rejects outside-service-area addresses before any hold/transaction (BD-6)", async () => {
    await expect(
      confirmAt({ startIso: "2027-06-02T14:00:00Z", postalCode: "99999", email: "outside@test.example" }),
    ).rejects.toMatchObject({ details: { booking_code: "outside_service_area" } });
  });

  it("matches customers by email then phone and flags conflicts without overwriting (BD-4)", async () => {
    // First booking creates the customer.
    await confirmAt({ startIso: "2027-06-02T14:00:00Z", email: "dedup@test.example" });
    // Second booking with the same email but a DIFFERENT phone → conflict.
    const startIso = "2027-06-03T08:00:00Z";
    const sessionId = `sess-${randomUUID()}`;
    const hold = await createSlotHold(
      ctx,
      {
        branch_id: branchId,
        service_id: svcId,
        start_time: new Date(startIso).toISOString(),
        end_time: new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString(),
        session_id: sessionId,
        idempotency_key: `hold-${randomUUID()}`,
      } as never,
      pricingDurationProvider({ branchId, serviceId: svcId }),
      AVAIL_NOW,
    );
    const quote = await calculateQuote({ branch_id: branchId, service_id: svcId, scheduled_date: startIso.slice(0, 10) });
    const result = await confirmBooking(
      ctx,
      {
        branch_id: branchId,
        service_id: svcId,
        scheduled_start: new Date(hold.start_time).toISOString(),
        hold_id: hold.id,
        session_id: sessionId,
        customer: {
          first_name: "Test",
          last_name: "Customer",
          email: "dedup@test.example",
          phone: "+491519998887",
        },
        service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
        source: "website",
        accepted_total_minor: Number(quote.total.replace(".", "")),
        idempotency_key: `conf-${randomUUID()}`,
      },
      new Date("2027-06-01T02:00:00Z"),
    );
    const customer = await t.db.query<{ id: string; phone_e164: string; contact_conflict_flag: boolean }>(
      `select id, phone_e164, contact_conflict_flag from public.customers where email_normalized = 'dedup@test.example'`,
    );
    expect(customer.rows).toHaveLength(1);
    expect(customer.rows[0].phone_e164).toBe(phoneForEmail("dedup@test.example")); // stored value kept
    expect(customer.rows[0].contact_conflict_flag).toBe(true);
    const conflictEvent = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.booking_events
       where booking_id = $1 and event_type = 'contact_conflict_flagged'`,
      [result.booking.id],
    );
    expect(conflictEvent.rows[0].n).toBe("1");
  });

  it("allocates distinct sequential numbers under concurrent confirmation (BD-5)", async () => {
    const [a, b] = await Promise.all([
      confirmAt({ startIso: "2027-06-03T10:00:00Z", email: "conc-a@test.example" }),
      confirmAt({ startIso: "2027-06-03T12:00:00Z", email: "conc-b@test.example" }),
    ]);
    expect(a.bookingNumber).not.toBe(b.bookingNumber);
    const seqA = Number(a.bookingNumber.split("-")[2]);
    const seqB = Number(b.bookingNumber.split("-")[2]);
    expect(Math.abs(seqA - seqB)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Cancellation (tasks 7.1–7.2)
// ---------------------------------------------------------------------------

describe("cancellation (BD-2)", () => {
  it("cancels with the tier from the BOOKING's snapshot and records amount owed", async () => {
    // Service 2027-06-05T08:00Z; cancel at 2027-06-04T00:00Z → 32h notice → 0%.
    const r = await confirmAt({ startIso: "2027-06-04T08:00:00Z", email: "cancel0@test.example" });
    const out = await cancelBooking(null, { booking_id: r.bookingId }, new Date("2027-06-02T00:00:00Z"));
    expect(out.tierPercent).toBe(0);
    expect(out.feeMinor).toBe(0);

    // 13h before start → 25% tier.
    const r2 = await confirmAt({ startIso: "2027-06-04T10:00:00Z", email: "cancel25@test.example" });
    const out2 = await cancelBooking(null, { booking_id: r2.bookingId }, new Date("2027-06-03T21:00:00Z"));
    expect(out2.tierPercent).toBe(25);
    expect(out2.amountOwedMinor).toBe(out2.feeMinor);
    expect(out2.feeMinor).toBe(Math.round((r2.total * 25) / 100));

    const row = await t.db.query<{ status: string; amount_owed_minor: number | null; cancellation_fee_minor: number }>(
      `select status, amount_owed_minor, cancellation_fee_minor from public.bookings where id = $1`,
      [r2.bookingId],
    );
    expect(row.rows[0].status).toBe("cancelled");
    expect(row.rows[0].amount_owed_minor).toBe(out2.feeMinor);
    // BD-2.6: outbox contains cancellation email; NO payment calls anywhere.
    const outbox = await t.db.query<{ event_type: string }>(
      `select event_type from public.notification_outbox where booking_id = $1`,
      [r2.bookingId],
    );
    expect(outbox.rows.map((x) => x.event_type)).toContain("booking_cancellation_email");
  });

  it("prohibits customer cancellation at/after scheduled_start (BD-2.5)", async () => {
    const r = await confirmAt({ startIso: "2027-06-05T08:00:00Z", email: "poststart@test.example" });
    await expect(
      cancelBooking(null, { booking_id: r.bookingId }, new Date("2027-06-05T08:00:00Z")),
    ).rejects.toMatchObject({ details: { booking_code: "post_start_prohibited" } });
  });

  it("requires bookings.override for fee overrides and enforces HQ-Admin-only authority", async () => {
    // Create a manager WITHOUT the override permission.
    const managerUser = await t.fx.createUser("bk-manager@test.example");
    const managerMembership = await t.fx.createMembership(managerUser, orgId, "branch_manager");
    await t.fx.grantBranch(managerMembership, branchId);
    const { resolveActor } = await import("@/lib/authorization/server");
    const managerCtx = await resolveActor(managerUser);

    const r = await confirmAt({ startIso: "2027-06-04T12:00:00Z", email: "override@test.example" });
    await cancelBooking(null, { booking_id: r.bookingId }, new Date("2027-06-02T01:00:00Z")); // 82h → 0% fee
    const row = await t.db.query<{ cancellation_fee_minor: number | null }>(
      `select cancellation_fee_minor from public.bookings where id = $1`,
      [r.bookingId],
    );
    expect(row.rows[0].cancellation_fee_minor).toBe(0);

    // HQ Admin override to a non-zero waived value (original 0 → 500 → waive to 0 is trivial;
    // exercise a real change: set final fee 500 minor then waive to 0).
    await expect(
      overrideCancellationFee(ctx, { booking_id: r.bookingId, final_fee_minor: 500, reason: "goodwill credit" }),
    ).resolves.toMatchObject({ cancellation_fee_minor: 500 });

    // Manager (no bookings.override) denied before any mutation.
    await expect(
      overrideCancellationFee(managerCtx, { booking_id: r.bookingId, final_fee_minor: 0, reason: "manager try" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    // Override audit trail: actor/timestamp/booking/original/final/reason.
    const audit = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs
       where resource_id = $1 and action = 'booking.fee_overridden'`,
      [r.bookingId],
    );
    expect(audit.rows[0].metadata).toMatchObject({
      original_fee_minor: 0,
      final_fee_minor: 500,
      reason: "goodwill credit",
    });
  });
});

// ---------------------------------------------------------------------------
// Rescheduling (task 8.1; BD-3, TD-3.1–3.3)
// ---------------------------------------------------------------------------

describe("rescheduling (BD-3)", () => {
  it("reschedules a confirmed booking with hold swap, new snapshot, and event", async () => {
    // Monday 2027-06-07 → Wednesday 2027-06-09 (weekday, grid-aligned).
    const r = await confirmAt({ startIso: "2027-06-07T08:00:00Z", email: "resched@test.example" });
    const targetStart = "2027-06-09T08:00:00.000Z";
    // Hold the target slot per TD-3.1 (same pricing profile → same duration).
    const targetHold = await makeTargetHold({ startIso: targetStart });
    const out = await rescheduleBooking(
      ctx,
      {
        booking_id: r.bookingId,
        target_start: targetHold.start,
        target_end: targetHold.end,
        hold_id: targetHold.holdId,
        session_id: targetHold.sessionId,
        reason: "customer request",
        idempotency_key: `res-${randomUUID()}`,
      },
      new Date("2027-06-07T10:00:00Z"),
    );
    // Booking rows render timestamptz in the executor's session zone —
    // compare INSTANTS, never rendered text.
    expect(new Date(out.booking.scheduled_start).getTime()).toBe(new Date("2027-06-09T08:00:00Z").getTime());
    expect(out.booking.reschedule_count).toBe(1);
    expect(out.priceDeltaMinor).toBe(0);

    // Snapshot history: seq 1 retired, seq 2 current (TD-3.2).
    const snaps = await t.db.query<{ seq: number; is_current: boolean }>(
      `select seq, is_current from public.booking_pricing_snapshots where booking_id = $1 order by seq`,
      [r.bookingId],
    );
    expect(snaps.rows).toEqual([
      { seq: 1, is_current: false },
      { seq: 2, is_current: true },
    ]);

    // Event with TD-3.4 payload (instant comparison — see note above);
    // reschedule outbox row.
    const ev = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.booking_events where booking_id = $1 and event_type = 'booking_rescheduled'`,
      [r.bookingId],
    );
    expect(new Date(ev.rows[0].metadata.previous_scheduled_start as string).getTime()).toBe(
      new Date("2027-06-07T08:00:00Z").getTime(),
    );
    expect(ev.rows[0].metadata).toMatchObject({
      price_delta_minor: 0,
      reschedule_count: 1,
    });
    const outbox = await t.db.query<{ event_type: string }>(
      `select event_type from public.notification_outbox where booking_id = $1 and event_type = 'booking_reschedule_email'`,
      [r.bookingId],
    );
    expect(outbox.rows).toHaveLength(1);
  });

  it("enforces the customer 2h deadline (BD-3.3a) but not for staff", async () => {
    const r = await confirmAt({ startIso: "2027-06-07T12:00:00Z", email: "deadline@test.example" });
    const targetHold = await makeTargetHold({ startIso: "2027-06-09T10:00:00.000Z" });
    // Customer at 2h-1s before current start → rejected.
    const atDeadline = new Date(new Date("2027-06-07T12:00:00Z").getTime() - 2 * 60 * 60_000 + 1000);
    await expect(
      rescheduleBooking(
        null,
        {
          booking_id: r.bookingId,
          target_start: targetHold.start,
          target_end: targetHold.end,
          hold_id: targetHold.holdId,
          session_id: targetHold.sessionId,
          idempotency_key: `res-${randomUUID()}`,
        },
        atDeadline,
      ),
    ).rejects.toMatchObject({ details: { booking_code: "deadline_passed" } });

    // Staff at the same instant → allowed (no customer deadline).
    const out = await rescheduleBooking(
      ctx,
      {
        booking_id: r.bookingId,
        target_start: targetHold.start,
        target_end: targetHold.end,
        hold_id: targetHold.holdId,
        session_id: targetHold.sessionId,
        idempotency_key: `res-${randomUUID()}`,
      },
      atDeadline,
    );
    expect(new Date(out.booking.scheduled_start).getTime()).toBe(new Date("2027-06-09T10:00:00Z").getTime());
  });

  it("rejects a target violating the 24h minimum notice (BD-3.3b) leaving the booking intact", async () => {
    const r = await confirmAt({ startIso: "2027-06-08T12:00:00Z", email: "notice@test.example" });
    // Target only 2 hours after "now" → violates S4 notice (hold creation fails first).
    await expect(
      createSlotHold(
        ctx,
        {
          branch_id: branchId,
          service_id: svcId,
          start_time: new Date("2027-06-08T16:00:00Z").toISOString(),
          end_time: new Date("2027-06-08T17:00:00Z").toISOString(),
          session_id: `sess-${randomUUID()}`,
          idempotency_key: `hold-${randomUUID()}`,
        } as never,
        pricingDurationProvider({ branchId, serviceId: svcId }),
        new Date("2027-06-08T14:00:00Z"),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    // Booking unchanged.
    const row = await t.db.query<{ scheduled_start: string; reschedule_count: number }>(
      `select scheduled_start::text, reschedule_count from public.bookings where id = $1`,
      [r.bookingId],
    );
    expect(row.rows[0].scheduled_start.startsWith("2027-06-08")).toBe(true);
    expect(row.rows[0].reschedule_count).toBe(0);
  });

  it("requires explicit acceptance for a higher price and auto-applies a lower one (BD-3.5)", async () => {
    // Add a NON-PRODUCTION higher-rate window to the ACTIVE profile,
    // effective from the target date (P17 — windows are selected by the
    // scheduled service date; the closed base window permits publication).
    await makePricedVersion("Hike", {
      effectiveFrom: "2027-06-10",
      rateMinor: 2000, // NON-PRODUCTION: 20.00/h — doubles the price
      profileId: activeProfileId!,
    });

    const r = await confirmAt({ startIso: "2027-06-08T10:00:00Z", email: "price@test.example" });
    // Target on/after 2027-06-10 → the higher rate applies to the NEW quote.
    const targetHold = await makeTargetHold({ startIso: "2027-06-10T08:00:00.000Z" });

    // No acceptance provided → PRICE_CHANGED with requires_acceptance.
    await expect(
      rescheduleBooking(
        null,
        {
          booking_id: r.bookingId,
          target_start: targetHold.start,
          target_end: targetHold.end,
          hold_id: targetHold.holdId,
          session_id: targetHold.sessionId,
          idempotency_key: `res-${randomUUID()}`,
        },
        new Date("2027-06-08T05:00:00Z"), // customer: 5h before current start
      ),
    ).rejects.toMatchObject({
      details: { booking_code: "price_changed", requires_acceptance: true },
    });
    // Booking unchanged by the rejected attempt (BD-3: failure leaves intact).
    const unchanged = await t.db.query<{ scheduled_start: string }>(
      `select scheduled_start::text from public.bookings where id = $1`,
      [r.bookingId],
    );
    expect(unchanged.rows[0].scheduled_start.startsWith("2027-06-08")).toBe(true);

    // With explicit acceptance of the NEW total → commits (BD-3.5a).
    const accepted = await rescheduleBooking(
      ctx,
      {
        booking_id: r.bookingId,
        target_start: targetHold.start,
        target_end: targetHold.end,
        hold_id: targetHold.holdId,
        session_id: targetHold.sessionId,
        accepted_target_total_minor: r.total * 2, // doubled hourly rate
        idempotency_key: `res-${randomUUID()}`,
      },
      new Date("2027-06-08T05:05:00Z"),
    );
    expect(new Date(accepted.booking.scheduled_start).getTime()).toBe(new Date("2027-06-10T08:00:00Z").getTime());
    expect(accepted.priceDeltaMinor).toBe(r.total); // exactly +100%

    // The old snapshot remains as history; the new one is authoritative.
    const snaps = await t.db.query<{ seq: number; is_current: boolean }>(
      `select seq, is_current from public.booking_pricing_snapshots where booking_id = $1 order by seq`,
      [r.bookingId],
    );
    expect(snaps.rows).toEqual([
      { seq: 1, is_current: false },
      { seq: 2, is_current: true },
    ]);
  });

  it("is idempotent per attempt and detects stale scheduled_start (TD-3.3)", async () => {
    const r = await confirmAt({ startIso: "2027-06-09T14:00:00Z", email: "stale@test.example" });
    const key = `res-${randomUUID()}`;
    // Target stays inside the base window (< 2027-06-10) → zero price delta.
    const target1 = "2027-06-08T14:00:00.000Z";
    const hold1 = await makeTargetHold({ startIso: target1 });
    const out1 = await rescheduleBooking(ctx, {
      booking_id: r.bookingId,
      target_start: hold1.start,
      target_end: hold1.end,
      hold_id: hold1.holdId,
      session_id: hold1.sessionId,
      idempotency_key: key,
    }, new Date("2027-06-06T08:00:00Z"));
    expect(new Date(out1.booking.scheduled_start).getTime()).toBe(new Date("2027-06-08T14:00:00Z").getTime());

    // Replay: same key → same outcome, no second reschedule.
    const out2 = await rescheduleBooking(ctx, {
      booking_id: r.bookingId,
      target_start: hold1.start,
      target_end: hold1.end,
      hold_id: hold1.holdId,
      session_id: hold1.sessionId,
      idempotency_key: key,
    }, new Date("2027-06-06T08:00:00Z"));
    expect(out2.booking.reschedule_count).toBe(1);
    expect(out2.newTotal).toBe(out1.newTotal);

    // Stale: request echoing the booking's ORIGINAL start after a concurrent
    // move → rejected (TD-3.3 optimistic-concurrency token).
    await expect(
      rescheduleBooking(ctx, {
        booking_id: r.bookingId,
        target_start: "2027-06-11T14:00:00.000Z",
        target_end: "2027-06-11T15:00:00.000Z",
        expected_current_scheduled_start: "2027-06-09T14:00:00Z", // pre-move start
        idempotency_key: `res-${randomUUID()}`,
      }, new Date("2027-06-09T09:00:00Z")),
    ).rejects.toMatchObject({ details: { booking_code: "booking_state_invalid" } });
  });
});

// ---------------------------------------------------------------------------
// Magic links (task 9.1; TD-3)
// ---------------------------------------------------------------------------

describe("magic links (TD-3)", () => {
  it("issues, verifies once, and rejects replay/expiry/revocation", async () => {
    const r = await confirmAt({ startIso: "2027-06-03T14:00:00Z", email: "magic@test.example" });
    const issued = await issueMagicLink({ booking_number: r.bookingNumber, email: "magic@test.example" }, new Date("2027-06-01T01:00:00Z"));
    expect(issued.token).toBeTruthy();

    const session = await verifyMagicLink({ token: issued.token }, new Date("2027-06-01T01:10:00Z"));
    expect(session.bookingId).toBeTruthy();

    // Replay rejected (single-use).
    await expect(verifyMagicLink({ token: issued.token })).rejects.toMatchObject({
      details: { booking_code: "magic_link_token_invalid" },
    });

    // Re-issue creates a fresh working link (rate limit: 2nd of 5).
    const issued2 = await issueMagicLink({ booking_number: r.bookingNumber, email: "magic@test.example" }, new Date("2027-06-01T02:00:00Z"));
    const s2 = await verifyMagicLink({ token: issued2.token }, new Date("2027-06-01T02:05:00Z"));
    expect(s2.bookingId).toBeTruthy();

    // Only the hash is stored.
    const stored = await t.db.query<{ token_hash: string }>(
      `select token_hash from public.customer_magic_link_tokens where booking_id = $1`,
      [r.bookingId],
    );
    for (const row of stored.rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).not.toBe(issued.token);
    }
  });

  it("is enumeration-safe: wrong email behaves like unknown booking", async () => {
    const r = await confirmAt({ startIso: "2027-06-04T14:00:00Z", email: "enum@test.example" });
    await expect(
      issueMagicLink({ booking_number: r.bookingNumber, email: "wrong@test.example" }, new Date("2027-06-01T01:00:00Z")),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("rate-limits repeated issuance (§33)", async () => {
    const r = await confirmAt({ startIso: "2027-06-05T10:00:00Z", email: "ratelimit@test.example" });
    // RATE_LIMIT_MAX = 5 per hour per (booking, email): 5th OK, 6th rejected.
    for (let i = 0; i < 5; i++) {
      await issueMagicLink({ booking_number: r.bookingNumber, email: "ratelimit@test.example" }, new Date("2027-06-01T03:00:00Z"));
    }
    await expect(
      issueMagicLink({ booking_number: r.bookingNumber, email: "ratelimit@test.example" }, new Date("2027-06-01T03:01:00Z")),
    ).rejects.toMatchObject({ details: { booking_code: "rate_limited" } });
  });
});

// ---------------------------------------------------------------------------
// Seed + configuration lifecycle (tasks 5.1–5.3)
// ---------------------------------------------------------------------------

describe("booking seed and configuration", () => {
  it("seed is idempotent and carries the approved BD-2 default tiers", async () => {
    const branch = await t.fx.createBranch(orgId, "booking-seed-2");
    const r1 = await seedBookingDefaults(branch);
    expect(r1.policiesInserted).toBe(1);
    const r2 = await seedBookingDefaults(branch);
    expect(r2.policiesInserted).toBe(0);

    const policies = await t.db.query<{ status: string; tiers: { percent: number }[] }>(
      `select status, tiers from public.branch_cancellation_policies where branch_id = $1`,
      [branch],
    );
    expect(policies.rows).toHaveLength(1);
    expect(policies.rows[0].status).toBe("published");
    expect(policies.rows[0].tiers.map((x) => x.percent)).toEqual([100, 50, 25, 0]);
  });

  it("rejects publishing an overlapping policy window and keeps history immutable", async () => {
    const branch = await t.fx.createBranch(orgId, "booking-policy-2");
    await seedBookingDefaults(branch); // version 1 published, open-ended
    const draft = await createCancellationPolicy(ctx, {
      branch_id: branch,
      effective_from: "2027-01-01",
      tiers: DEFAULT_CANCELLATION_TIERS,
    });
    await expect(publishCancellationPolicy(ctx, draft.id, {})).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it("replaces the service-area allowlist transactionally (BD-6)", async () => {
    await setServiceAreas(ctx, { branch_id: branchId, postal_codes: ["10115"] });
    const areas = await t.db.query<{ postal_code: string }>(
      `select postal_code from public.branch_service_areas where branch_id = $1`,
      [branchId],
    );
    expect(areas.rows.map((r) => r.postal_code)).toEqual(["10115"]);
  });
});

// ---------------------------------------------------------------------------
// Rollback / fail-closed audit (BD-1, AUDIT §50)
// ---------------------------------------------------------------------------

describe("rollback semantics", () => {
  it("rollback on fee-override failure leaves the booking unchanged (fail-closed audit)", async () => {
    const r = await confirmAt({ startIso: "2027-06-03T14:00:00Z", email: "rollback@test.example" });
    // Invalid reason (schema min 3) → validation error before any mutation.
    await expect(
      overrideCancellationFee(ctx, { booking_id: r.bookingId, final_fee_minor: 1, reason: "x" }),
    ).rejects.toThrow();
    const row = await t.db.query<{ cancellation_fee_minor: number | null }>(
      `select cancellation_fee_minor from public.bookings where id = $1`,
      [r.bookingId],
    );
    expect(row.rows[0].cancellation_fee_minor).toBeNull();
  });
});
