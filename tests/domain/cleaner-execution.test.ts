/**
 * Cleaner execution domain tests (Change 7, tasks 11.1–11.3; design §5–§6).
 * Runs against real pglite + the full migration chain 0001→0013 (domain
 * harness). Coverage: cleaner context resolution (fail-closed, §4),
 * transition matrix incl. direct assigned→checked_in (BD-C2),
 * en_route optionality, checklist snapshot + immutability (BD-C3),
 * completion gates incl. incident severities + manager override (BD-C9),
 * completion → booking contract (no direct booking writes), idempotency
 * and concurrency serialization.
 *
 * ALL fixture values are NON-PRODUCTION (P3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import type { AuthContext } from "@/lib/authorization/server";
import { randomUUID } from "node:crypto";

import { createEmployee, setEmployeeBranches, setEmployeeAvailability } from "@/features/worker/employees";
import { ensureJobForBooking, completeJob } from "@/features/worker/jobs";
import { assignCleaner } from "@/features/worker/assignments";
import { resolveCleanerContext, cleanerEnRoute, cleanerCheckIn, cleanerStartWork, cleanerCheckOut, completeCleanerJob, completeChecklistItem, reportCleanerIncident, getJobChecklist } from "@/features/worker/execution";
import { WorkerErrorCode } from "@/features/worker/errors";
import { confirmBooking } from "@/features/booking/service";
import { createSlotHold } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import { calculateQuote } from "@/features/pricing/quote";
import { createProfile, createRule, createVersion, publishVersion, updateProfile } from "@/features/pricing/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { parseMinor } from "@/features/pricing/money";
import { seedBookingDefaults } from "@/features/booking/seed";
import { setServiceAreas } from "@/features/booking/configuration";

let t: TestDb;
let ctx: AuthContext;
let orgId: string;
let branchId: string;
let svcId: string;

// NON-PRODUCTION fixture values (P3).
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 };
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };
const AVAIL_NOW = new Date("2027-06-01T00:00:00Z");

function phoneForEmail(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % 900000000;
  return `+4916${String(10000000 + h).slice(0, 9)}`;
}

async function confirmAt(startIso: string): Promise<string> {
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
  const email = `cx-${randomUUID().slice(0, 8)}@test.example`;
  const result = await confirmBooking(
    ctx,
    {
      branch_id: branchId,
      service_id: svcId,
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: sessionId,
      customer: { first_name: "CleanerEx", last_name: "Fixture", email, phone: phoneForEmail(email) },
      service_address: { street: "Side", house_number: "7", postal_code: "10115", city: "Berlin", country: "de" },
      source: "dashboard",
      accepted_total_minor: Number(parseMinor(quote.total)),
      idempotency_key: `conf-${randomUUID()}`,
    },
    new Date("2027-06-01T02:00:00Z"),
  );
  return result.booking.id;
}

/** Employee linked to a real auth uid (cleaner resolution chain target). */
async function makeLinkedCleaner(userId: string, opts: { suffix?: string } = {}): Promise<string> {
  const suffix = opts.suffix ?? randomUUID().slice(0, 8);
  const emp = await createEmployee(ctx, {
    first_name: "Cleaner",
    last_name: suffix,
    email: `clx-${suffix}@test.example`,
    phone: "+491610000000",
    employment_type: "part_time",
    user_id: userId,
  });
  await setEmployeeBranches(ctx, { employee_id: emp.id, branch_ids: [branchId] });
  await setEmployeeAvailability(ctx, {
    employee_id: emp.id,
    windows: (Array.from({ length: 7 }, (_, wd) => ({
      weekday: wd,
      start_time: "00:00",
      end_time: "23:59",
      effective_from: "2026-01-01",
    })) as never),
  });
  return emp.id;
}

/** Full setup: auth user → linked employee → booking → job → active assignment. */
async function makeScenario(_status: "assigned" = "assigned"): Promise<{ userId: string; employeeId: string; jobId: string; bookingId: string }> {
  const userId = await t.fx.createUser(`clx-${randomUUID().slice(0, 8)}@test.example`);
  await t.fx.createMembership(userId, orgId, "cleaner");
  const employeeId = await makeLinkedCleaner(userId);
  const bookingId = await confirmAt("2027-06-10T08:00:00Z");
  const job = await ensureJobForBooking(bookingId);
  await assignCleaner(ctx, { job_id: job.id, employee_id: employeeId });
  return { userId, employeeId, jobId: job.id, bookingId };
}

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("Cleaner Ex Org", "cleaner-ex-org");
  ctx = await hqAdminContext(orgId, "cleaner-ex-hq@test.example");
  branchId = await t.fx.createBranch(orgId, "cleaner-ex-main");
  await t.db.query(
    `update public.branches set status = 'active', activated_at = now(), provisioning_status = 'ready' where id = $1`,
    [branchId],
  );
  await seedSchedulingDefaults(branchId);
  await seedBookingDefaults(branchId);
  await t.db.query(
    `update public.branch_scheduling_configuration set slot_grid_minutes = 60, minimum_notice_minutes = 0, concurrency_cap = 50 where branch_id = $1`,
    [branchId],
  );

  const catId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
       values ($1, $2, 'cx-cat', 'Cat', 'active', true) returning id`,
      [orgId, branchId],
    )
  ).rows[0].id;
  svcId = (
    await t.db.query<{ id: string }>(
      `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
       values ($1, $2, $3, 'cx-svc', 'Svc', 'active', true) returning id`,
      [orgId, branchId, catId],
    )
  ).rows[0].id;

  const profile = await createProfile(ctx, { branch_id: branchId, name: "CX Profile", currency: "EUR" });
  const version = await createVersion(ctx, { profile_id: profile.id, branch_id: branchId, effective_from: "2026-01-01" });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "base_rate", service_id: svcId, configuration: FIX_RATE });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "duration_rule", service_id: svcId, configuration: FIX_DURATION });
  await publishVersion(ctx, version.id, { branch_id: branchId });
  await updateProfile(ctx, profile.id, { status: "active" });
  await setServiceAreas(ctx, { branch_id: branchId, postal_codes: ["10115"] });
});

describe("cleaner context resolution (§4, fail-closed)", () => {
  it("denies a user with no linked employee", async () => {
    const userId = await t.fx.createUser(`nolink-${randomUUID().slice(0, 6)}@test.example`);
    await expect(resolveCleanerContext(userId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.NO_ACTIVE_ASSIGNMENT },
    });
  });

  it("denies a deactivated employee", async () => {
    const userId = await t.fx.createUser(`inact-${randomUUID().slice(0, 6)}@test.example`);
    await t.fx.createMembership(userId, orgId, "cleaner");
    const emp = await createEmployee(ctx, {
      first_name: "Inactive",
      last_name: "Cleaner",
      email: `inact-${randomUUID().slice(0, 6)}@test.example`,
      employment_type: "flexible",
      user_id: userId,
    });
    await setEmployeeBranches(ctx, { employee_id: emp.id, branch_ids: [branchId] });
    await t.db.query(`update public.employees set status = 'inactive' where id = $1`, [emp.id]);
    await expect(resolveCleanerContext(userId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.EMPLOYEE_INACTIVE },
    });
  });

  it("resolves an active linked employee with branch authorizations", async () => {
    const userId = await t.fx.createUser(`ok-${randomUUID().slice(0, 6)}@test.example`);
    await t.fx.createMembership(userId, orgId, "cleaner");
    const employeeId = await makeLinkedCleaner(userId);
    const cleaner = await resolveCleanerContext(userId);
    expect(cleaner.employeeId).toBe(employeeId);
    expect(cleaner.branchIds).toContain(branchId);
  });
});

describe("execution transitions (BD-C2)", () => {
  it("runs assigned → en_route → checked_in → in_progress → checkOut with server timestamps", async () => {
    const s = await makeScenario();
    let job = await cleanerEnRoute(s.userId, s.jobId);
    expect(job.status).toBe("en_route");
    expect(job.en_route_at).not.toBeNull();

    job = await cleanerCheckIn(s.userId, s.jobId);
    expect(job.status).toBe("checked_in");
    expect(job.checked_in_at).not.toBeNull();
    expect(job.actual_start).not.toBeNull();

    job = await cleanerStartWork(s.userId, s.jobId);
    expect(job.status).toBe("in_progress");

    job = await cleanerCheckOut(s.userId, s.jobId);
    expect(job.checked_out_at).not.toBeNull();
    expect(job.actual_end).not.toBeNull();
    expect(job.status).toBe("in_progress"); // checkout does not complete

    // Events for the full path.
    const ev = await t.db.query<{ event_type: string }>(
      `select event_type from public.job_events where job_id = $1 order by created_at`,
      [s.jobId],
    );
    const types = ev.rows.map((r) => r.event_type);
    expect(types).toContain("en_route");
    expect(types).toContain("check_in");
    expect(types).toContain("job_started");
    expect(types).toContain("check_out");
  });

  it("permits direct assigned → checked_in without en_route (BD-C2)", async () => {
    const s = await makeScenario();
    const job = await cleanerCheckIn(s.userId, s.jobId);
    expect(job.status).toBe("checked_in");
    expect(job.en_route_at).toBeNull();
    expect(job.checked_in_at).not.toBeNull();
  });

  it("rejects startWork from assigned (transition guard)", async () => {
    const s = await makeScenario();
    await expect(cleanerStartWork(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.TRANSITION_INVALID },
    });
  });

  it("is idempotent: repeat check-in is a no-op without duplicate events", async () => {
    const s = await makeScenario();
    await cleanerCheckIn(s.userId, s.jobId);
    const again = await cleanerCheckIn(s.userId, s.jobId);
    expect(again.status).toBe("checked_in");
    const ev = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.job_events where job_id = $1 and event_type = 'check_in'`,
      [s.jobId],
    );
    expect(Number(ev.rows[0].n)).toBe(1);
  });

  it("denies a cleaner without the active assignment (stale echo safety)", async () => {
    const s = await makeScenario();
    const stranger = await t.fx.createUser(`str-${randomUUID().slice(0, 6)}@test.example`);
    await t.fx.createMembership(stranger, orgId, "cleaner");
    await makeLinkedCleaner(stranger, { suffix: `str-${randomUUID().slice(0, 6)}` });
    await expect(cleanerCheckIn(stranger, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.NOT_ASSIGNED_CLEANER },
    });
  });
});

describe("checklist (BD-C3)", () => {
  it("snapshots a published template at check-in; template changes do not alter it", async () => {
    // Publish a template for the fixture service.
    await t.db.query(
      `insert into public.checklist_templates (organization_id, branch_id, service_id, version, status, name, items)
       values ($1, $2, $3, 1, 'published', 'V1 Template', $4::jsonb)`,
      [
        orgId,
        branchId,
        svcId,
        JSON.stringify([
          { key: "kitchen", label: "Kitchen surfaces", mandatory: true, sort_order: 1 },
          { key: "bath", label: "Bathroom", mandatory: true, sort_order: 2 },
          { key: "extras", label: "Extra polish", mandatory: false, sort_order: 3 },
        ]),
      ],
    );

    const s = await makeScenario();
    await cleanerCheckIn(s.userId, s.jobId);

    const { snapshot, items } = await getJobChecklist(s.jobId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.template_version).toBe(1);
    expect(items).toHaveLength(3);

    // New template version published → existing snapshot unchanged.
    await t.db.query(
      `insert into public.checklist_templates (organization_id, branch_id, service_id, version, status, name, items)
       values ($1, $2, $3, 2, 'published', 'V2 Template', $4::jsonb)`,
      [orgId, branchId, svcId, JSON.stringify([{ key: "only", label: "Only item", mandatory: true, sort_order: 1 }])],
    );
    const again = await getJobChecklist(s.jobId);
    expect(again.items).toHaveLength(3); // immutable snapshot

    // Item completion records provenance (BD-C3).
    const kitchen = again.items.find((i) => i.item_key === "kitchen")!;
    const done = await completeChecklistItem(s.userId, { job_id: s.jobId, item_id: kitchen.id, notes: "cleaned" });
    expect(done.status).toBe("completed");
    expect(done.completed_at).not.toBeNull();
    expect(done.completed_by).toBe(s.userId);
    expect(done.notes).toBe("cleaned");

    // Idempotent repeat.
    const repeat = await completeChecklistItem(s.userId, { job_id: s.jobId, item_id: kitchen.id });
    expect(repeat.completed_at).toBe(done.completed_at);
  });
});

describe("completion gates (BD-C9)", () => {
  it("blocks without check-in, then without mandatory items, then completes; low incident does not block", async () => {
    await t.db.query(
      `insert into public.checklist_templates (organization_id, branch_id, service_id, version, status, name, items)
       values ($1, $2, $3, 10, 'published', 'Gate Template', $4::jsonb)`,
      [
        orgId,
        branchId,
        svcId,
        JSON.stringify([
          { key: "floor", label: "Floors", mandatory: true, sort_order: 1 },
          { key: "dust", label: "Dusting", mandatory: false, sort_order: 2 },
        ]),
      ],
    );

    const s = await makeScenario();
    const bookingBefore = await t.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [s.bookingId]);

    // Gate 1: no check-in.
    await expect(completeCleanerJob(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.COMPLETION_BLOCKED },
    });
    // No partial state.
    const st1 = await t.db.query<{ status: string }>(`select status from public.jobs where id = $1`, [s.jobId]);
    expect(st1.rows[0].status).toBe("assigned");

    // Low/medium incidents never block (BD-C9).
    await reportCleanerIncident(s.userId, { job_id: s.jobId, incident_type: "access_problem", severity: "low" });

    await cleanerCheckIn(s.userId, s.jobId);
    await cleanerStartWork(s.userId, s.jobId);

    // Gate 2: pending mandatory item.
    await expect(completeCleanerJob(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.COMPLETION_BLOCKED },
    });

    const { items } = await getJobChecklist(s.jobId);
    for (const item of items.filter((i) => i.mandatory)) {
      await completeChecklistItem(s.userId, { job_id: s.jobId, item_id: item.id });
    }

    const completed = await completeCleanerJob(s.userId, s.jobId);
    expect(completed.status).toBe("completed");
    expect(completed.actual_end).not.toBeNull();

    // Booking completed ONLY through the contract (state advanced, no direct write).
    const booking = await t.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [s.bookingId]);
    expect(booking.rows[0].status).toBe("completed");
    const bookingEvents = await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `select event_type, metadata from public.booking_events where booking_id = $1 order by created_at`,
      [s.bookingId],
    );
    expect(bookingEvents.rows.map((r) => r.event_type)).toContain("booking_completed");
    expect(bookingBefore.rows[0].status).toBe("assigned");
  });

  it("blocks on an open critical incident; manager override (staff completeJob) bypasses gates audited", async () => {
    const s = await makeScenario();
    await cleanerCheckIn(s.userId, s.jobId);
    await cleanerStartWork(s.userId, s.jobId);
    await reportCleanerIncident(s.userId, { job_id: s.jobId, incident_type: "property_damage", severity: "critical" });

    await expect(completeCleanerJob(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.COMPLETION_BLOCKED },
    });

    // Manager override: existing Change 6 staff path (jobs.manage at the
    // action layer) — audited, idempotent, booking-completing.
    const job = await completeJob({ userId: ctx.actor.userId }, s.jobId);
    expect(job.status).toBe("completed");
    const booking = await t.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [s.bookingId]);
    expect(booking.rows[0].status).toBe("completed");

    const audit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_id = $1 and action like 'job.completed%'`,
      [s.jobId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("cleaner completion is idempotent (second attempt is an acknowledged no-op)", async () => {
    const s = await makeScenario();
    await cleanerCheckIn(s.userId, s.jobId);
    await cleanerStartWork(s.userId, s.jobId);
    // The service-scoped 'Gate Template' (published above) carries a
    // mandatory item — satisfy it exactly as the cleaner UI would.
    const { items } = await getJobChecklist(s.jobId);
    for (const item of items.filter((i) => i.mandatory)) {
      await completeChecklistItem(s.userId, { job_id: s.jobId, item_id: item.id });
    }
    const first = await completeCleanerJob(s.userId, s.jobId);
    const second = await completeCleanerJob(s.userId, s.jobId);
    expect(second.completed_at).toBe(first.completed_at);
    const ev = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.job_events where job_id = $1 and event_type = 'job_completed'`,
      [s.jobId],
    );
    expect(Number(ev.rows[0].n)).toBe(1);
  });
});

describe("concurrency & serialization (§5)", () => {
  it("serializes conflicting concurrent transitions — exactly one wins per step", async () => {
    const s = await makeScenario();
    // Two concurrent check-ins: both succeed (idempotent), exactly one event.
    await Promise.all([cleanerCheckIn(s.userId, s.jobId), cleanerCheckIn(s.userId, s.jobId)]);
    const ev = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.job_events where job_id = $1 and event_type = 'check_in'`,
      [s.jobId],
    );
    expect(Number(ev.rows[0].n)).toBe(1);
    // And a conflicting en_route from checked_in is rejected.
    await expect(cleanerEnRoute(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.TRANSITION_INVALID },
    });
  });

  it("mid-execution reassignment denial: released assignment cannot execute", async () => {
    const s = await makeScenario();
    await t.db.query(
      `update public.job_assignments set assignment_status = 'cancelled' where job_id = $1`,
      [s.jobId],
    );
    await expect(cleanerCheckIn(s.userId, s.jobId)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.NOT_ASSIGNED_CLEANER },
    });
  });
});
