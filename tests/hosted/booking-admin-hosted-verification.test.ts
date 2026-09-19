/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 9 (create-booking-admin-ui)
 *
 * SKIPPED by default: runs only with  HOSTED_VERIFY=1 npx vitest run
 * tests/hosted/booking-admin-hosted-verification.test.ts — never part of
 * `npm test`. Requires `.env.local` pointing at the TARGET staging project
 * (ksdxzkghyvvdizwclhbu) with the migration chain 0001–0014 applied.
 *
 * Change 9 ships NO migration, NO new permission, and NO RLS change — this
 * suite therefore verifies the STAFF SURFACE against real hosted state:
 *  - schema regression: booking_events event CHECK / columns unchanged, no
 *    Change 9 policies or columns added, chain still ends at 0014;
 *  - the new staff timeline read (permission + org + branch scope, ascending,
 *    capped, READ-ONLY — event count before/after identical);
 *  - customer editing on real Postgres (Change 9 fixed a pre-existing
 *    parameter-numbering defect in `updateCustomer` — this is the first
 *    hosted exercise of that statement) + foreign-org denial;
 *  - staff cancellation through the domain (BD-2 server tiers + audit);
 *  - creation idempotency (server convergence on key reuse);
 *  - RLS probes as the real `authenticated` role: bookings/customer/
 *    booking_events isolation for staff/branch manager/cleaner/outsider,
 *    and the policy inventory for the touched tables is unchanged.
 *
 * ALL fixture values are explicit NON-PRODUCTION fixtures (P3). The suite
 * creates its own hv9-suffixed entities and deletes everything afterwards.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import type { AuthContext } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { seedBookingDefaults } from "@/features/booking/seed";
import { setServiceAreas } from "@/features/booking/configuration";
import { calculateQuote } from "@/features/pricing/quote";
import {
  createProfile,
  createRule,
  createVersion,
  publishVersion,
  updateProfile,
} from "@/features/pricing/service";
import { createSlotHold } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import {
  confirmBooking,
  cancelBooking,
  getBookingTimeline,
  loadBookingForActor,
  STAFF_TIMELINE_CAP,
} from "@/features/booking/service";
import { updateCustomer } from "@/features/booking/customers";
import { ErrorCode } from "@/lib/errors";

function loadEnvLocal(): void {
  const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^[\"']|[\"']$/g, "");
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL_RAW = process.env.SUPABASE_DB_URL ?? "";
const PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
})();

const HOSTED = process.env.HOSTED_VERIFY === "1";
const RUN = randomBytes(3).toString("hex");
const PREFIX = "hv9-";

let pool: Pool | null = null;

async function sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  if (!pool) throw new Error("pool not initialized");
  const res = await pool.query(text, (params ?? []) as never[]);
  return res.rows as T[];
}

const adminAuth: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const testUsers: { id: string; email: string }[] = [];
async function createHostedUser(name: string): Promise<{ id: string; email: string }> {
  const email = `${PREFIX}${name}-${RUN}@verify.example.com`;
  const password = randomBytes(18).toString("base64url") + "!Aa1";
  const { data, error } = await adminAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const user = { id: data.user.id, email };
  testUsers.push(user);
  return user;
}

/** Real `authenticated` RLS probe inside a rolled-back tx. */
async function withRlsUser<T>(userId: string, fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool!.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(
      `set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}'`,
    );
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

const TEARDOWN_ORG_TABLES = [
  "notification_outbox",
  "booking_idempotency_keys",
  "customer_magic_link_tokens",
  "booking_pricing_snapshots",
  "booking_events",
  "booking_items",
  "bookings",
  "booking_number_sequences",
  "branch_cancellation_policies",
  "branch_service_areas",
  "customer_addresses",
  "customers",
  "slot_holds",
  "service_scheduling_rules",
  "branch_schedule_exceptions",
  "branch_operating_hours",
  "branch_scheduling_configuration",
  "incidents",
  "job_events",
  "job_assignments",
  "jobs",
  "job_number_sequences",
  "employee_availability_exceptions",
  "employee_availability",
  "employee_skills",
  "employee_branches",
  "employee_number_sequences",
  "employees",
  "pricing_versions",
  "pricing_rules",
  "pricing_profiles",
  "service_addon_compatibility",
  "service_slug_aliases",
  "service_addons",
  "services",
  "service_categories",
  "audit_logs",
];

async function cleanup(): Promise<void> {
  if (DB_URL_RAW) {
    const mHost = new URL(DB_URL_RAW).hostname;
    const maint = new Pool({
      connectionString: DB_URL_RAW,
      max: 1,
      ssl: mHost.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const orgs = (
        await maint.query("select id from public.organizations where slug like 'hv9-org-%'")
      ).rows as { id: string }[];
      for (const org of orgs) {
        const stmt = TEARDOWN_ORG_TABLES.map((t) => `delete from public.${t} where organization_id = '${org.id}'`).join("; ");
        await maint.query(`set session_replication_role = replica; ${stmt};
           delete from public.membership_branches where membership_id in (select m.id from public.memberships m where m.organization_id = '${org.id}');
           delete from public.branches where organization_id = '${org.id}';
           delete from public.memberships where organization_id = '${org.id}';
           delete from public.organizations where id = '${org.id}';
           set session_replication_role = origin;`);
      }
    } finally {
      await maint.end();
    }
  }
  for (const user of testUsers) {
    try {
      await adminAuth.auth.admin.deleteUser(user.id);
    } catch {
      /* best effort */
    }
  }
}

async function assertZeroLeftovers(): Promise<void> {
  const checks: [string, number][] = [];
  const orgs = await sql<{ n: string }>(
    `select count(*)::text as n from public.organizations where slug like 'hv9-org-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv9-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of TEARDOWN_ORG_TABLES) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations where slug like 'hv9-org-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const tail = await sql<{ mb: string; mem: string }>(
    `select
       (select count(*)::text as n from public.membership_branches where membership_id in
          (select m.id from public.memberships m where m.organization_id in
             (select id from public.organizations where slug like 'hv9-org-%'))) as mb,
       (select count(*)::text as n from public.memberships where organization_id in
          (select id from public.organizations where slug like 'hv9-org-%')) as mem`,
  );
  checks.push(["membership_branches(tail)", Number(tail[0].mb)]);
  checks.push(["memberships(tail)", Number(tail[0].mem)]);
  const leftovers = checks.filter(([, n]) => n !== 0);
  expect(leftovers).toEqual([]);
}

const S: {
  orgA?: string;
  branch1?: string;
  branch2?: string;
  svc1?: string;
  svc2?: string;
  booking1?: string;
  booking2?: string;
  customerId?: string;
  customer2Id?: string;
  hq?: AuthContext;
  users: Record<string, { id: string; email: string }>;
} = { users: {} };

// NON-PRODUCTION fixture values (P3).
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1200 };
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };
const NOW = new Date("2027-07-01T02:00:00Z");
const SLOT_1 = "2027-07-06T08:00:00.000Z"; // Tuesday (branches closed Sat/Sun)
const SLOT_2 = "2027-07-07T09:00:00.000Z"; // Wednesday

async function makePricedService(branchId: string, slugPrefix: string): Promise<string> {
  const cat = (
    await sql<{ id: string }>(
      `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
       values ($1, $2, $3, 'Cat', 'active', true) returning id`,
      [S.orgA, branchId, `${PREFIX}${slugPrefix}-cat`],
    )
  )[0].id;
  const svc = (
    await sql<{ id: string }>(
      `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
       values ($1, $2, $3, $4, 'Svc', 'active', true) returning id`,
      [S.orgA, branchId, cat, `${PREFIX}${slugPrefix}-svc`],
    )
  )[0].id;
  const ctx = await resolveActor(S.users.hq!.id);
  const profile = await createProfile(ctx, { branch_id: branchId, name: `HV9 Profile ${slugPrefix}`, currency: "EUR" });
  const version = await createVersion(ctx, { profile_id: profile.id, branch_id: branchId, effective_from: "2026-01-01" });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "base_rate", service_id: svc, configuration: FIX_RATE });
  await createRule(ctx, { version_id: version.id, branch_id: branchId, rule_type: "duration_rule", service_id: svc, configuration: FIX_DURATION });
  await publishVersion(ctx, version.id, { branch_id: branchId });
  await updateProfile(ctx, profile.id, { status: "active" });
  return svc;
}

async function confirmAt(branchId: string, serviceId: string, email: string, slot: string): Promise<string> {
  const ctx = await resolveActor(S.users.hq!.id);
  const sessionId = `sess-${randomUUID()}`;
  const hold = await createSlotHold(
    ctx,
    {
      branch_id: branchId,
      service_id: serviceId,
      start_time: new Date(slot).toISOString(),
      end_time: new Date(new Date(slot).getTime() + 60 * 60_000).toISOString(),
      session_id: sessionId,
      idempotency_key: `hold-${randomUUID()}`,
    } as never,
    pricingDurationProvider({ branchId, serviceId }),
    NOW,
  );
  const quote = await calculateQuote({ branch_id: branchId, service_id: serviceId, scheduled_date: slot.slice(0, 10) });
  const result = await confirmBooking(
    ctx,
    {
      branch_id: branchId,
      service_id: serviceId,
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: sessionId,
      customer: { first_name: "Change", last_name: "Nine", email, phone: "+499011234567" },
      service_address: { street: "Hosted Street", house_number: "9", postal_code: "10115", city: "Berlin", country: "de" },
      source: "dashboard" as const,
      accepted_total_minor: Number(quote.total.replace(".", "")),
      idempotency_key: `conf-${randomUUID()}`,
    },
    NOW,
  );
  return result.booking.id;
}

describe.skipIf(!HOSTED)("hosted verification: create-booking-admin-ui", () => {
  beforeAll(async () => {
    expect(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL missing").toBeTruthy();
    expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY missing").toBeTruthy();
    expect(DB_URL_RAW, "SUPABASE_DB_URL missing").toBeTruthy();
    expect(PROJECT_REF).toBe("ksdxzkghyvvdizwclhbu");
    const host = new URL(DB_URL_RAW).hostname;
    pool = new Pool({
      connectionString: DB_URL_RAW,
      max: 5,
      ssl: host.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query("select 1");
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanup();
      await assertZeroLeftovers();
      console.log("hv9 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  });

  // -- 00) SCHEMA REGRESSION (no Change 9 migration) ------------------------

  it("00 SCHEMA: no Change 9 migration — booking_events shape, event CHECK and policy inventory unchanged", async () => {
    // No Change 9 migration: nothing numbered 0015+ was added to the chain.
    const migrations = await sql<{ version: string }>(
      `select version from supabase_migrations.schema_migrations`,
    ).catch(() => [] as { version: string }[]);
    const beyond = migrations.filter((m) => /^(001[5-9]|00[2-9]\d)/.test(m.version));
    expect(beyond).toEqual([]);

    // booking_events columns are exactly the Change 5/6 shape (no Change 9 additions).
    const cols = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'booking_events' order by column_name`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      expect.arrayContaining(["id", "booking_id", "event_type", "metadata", "created_at"]),
    );
    expect(cols.map((c) => c.column_name)).not.toContain("staff_visibility");

    // Policies on the three staff-surface tables are unchanged by Change 9.
    const policies = await sql<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and tablename in ('bookings','customers','booking_events')
        order by tablename, policyname`,
    );
    const names = policies.map((p) => `${p.tablename}.${p.policyname}`);
    expect(names).toContain("bookings.bookings_select");
    expect(names).toContain("customers.customers_select");
    expect(names).toContain("booking_events.booking_events_select");
    // Select-only on booking_events (append-only domain writes, unchanged).
    const evPolicies = policies.filter((p) => p.tablename === "booking_events");
    for (const p of evPolicies) expect(p.cmd).toBe("SELECT");
  });

  // -- 01) FIXTURES ----------------------------------------------------------

  it("01 FIXTURES: hosted org, real Auth users, two provisioned branches, priced catalog, two confirmed bookings", async () => {
    const orgId = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV9 Org ${RUN}', 'hv9-org-${RUN}') returning id`,
      )
    )[0].id;
    S.orgA = orgId;

    S.users.hq = await createHostedUser("hq");
    await sql(
      `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'hq_admin')`,
      [orgId, S.users.hq.id],
    );
    S.users.staff = await createHostedUser("staff");
    await sql(
      `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'hq_staff')`,
      [orgId, S.users.staff.id],
    );
    S.users.mgr = await createHostedUser("mgr");
    S.users.cleaner = await createHostedUser("cleaner");
    S.users.outsider = await createHostedUser("outsider");

    const { branch } = await createAndProvision(await resolveActor(S.users.hq.id), {
      name: `HV9 Berlin ${RUN}`,
      slug: `${PREFIX}${RUN}-berlin`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch1 = branch.id;

    const { branch: branch2 } = await createAndProvision(await resolveActor(S.users.hq.id), {
      name: `HV9 Leipzig ${RUN}`,
      slug: `${PREFIX}${RUN}-leipzig`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch2 = branch2.id;

    await seedSchedulingDefaults(S.branch1);
    await seedSchedulingDefaults(S.branch2);
    await seedBookingDefaults(S.branch1);
    await seedBookingDefaults(S.branch2);
    await setServiceAreas(await resolveActor(S.users.hq.id), { branch_id: S.branch1, postal_codes: ["10115", "10117"] });
    await setServiceAreas(await resolveActor(S.users.hq.id), { branch_id: S.branch2, postal_codes: ["10115", "10117"] });

    S.svc1 = await makePricedService(S.branch1, "b1");
    S.svc2 = await makePricedService(S.branch2, "b2");

    // Branch manager scoped to branch1; cleaner membership without branches.
    const mgrMembership = (
      await sql<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'branch_manager') returning id`,
        [orgId, S.users.mgr.id],
      )
    )[0].id;
    await sql(`insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`, [mgrMembership, S.branch1]);
    await sql(
      `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'cleaner')`,
      [orgId, S.users.cleaner.id],
    );

    S.booking1 = await confirmAt(S.branch1, S.svc1, `hv9-cust1-${RUN}@verify.example.com`, SLOT_1);
    S.booking2 = await confirmAt(S.branch2, S.svc2, `hv9-cust2-${RUN}@verify.example.com`, SLOT_2);

    S.customerId = (
      await sql<{ customer_id: string }>(`select customer_id from public.bookings where id = $1`, [S.booking1])
    )[0].customer_id;
    S.customer2Id = (
      await sql<{ customer_id: string }>(`select customer_id from public.bookings where id = $1`, [S.booking2])
    )[0].customer_id;
    S.hq = await resolveActor(S.users.hq.id);

    expect(S.booking1).toBeTruthy();
    expect(S.booking2).toBeTruthy();
  }, 120_000);

  // -- 02) STAFF TIMELINE (the one new read contract) -------------------------

  it("02 TIMELINE: staff read is permission/org/branch-gated, ascending, capped, and strictly read-only", async () => {
    const events = await getBookingTimeline(S.hq!, S.booking1!);
    expect(events.length).toBeGreaterThanOrEqual(2); // created + confirmed
    const times = events.map((e) => new Date(e.created_at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    // READ-ONLY guarantee: identical event rows before/after the read.
    const before = await sql<{ n: string }>(`select count(*)::text as n from public.booking_events where booking_id = $1`, [S.booking1!]);
    await getBookingTimeline(S.hq!, S.booking1!);
    const after = await sql<{ n: string }>(`select count(*)::text as n from public.booking_events where booking_id = $1`, [S.booking1!]);
    expect(after[0].n).toBe(before[0].n);

    // Branch scope: the branch manager of branch1 reads branch1's booking…
    const mgrCtx = await resolveActor(S.users.mgr.id);
    const mgrEvents = await getBookingTimeline(mgrCtx, S.booking1!);
    expect(mgrEvents.length).toBeGreaterThanOrEqual(2);

    // …but is fail-closed for the other branch's booking.
    await expect(getBookingTimeline(mgrCtx, S.booking2!)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    // Cleaner lacks bookings.view → denied through the same loader chain.
    const cleanerCtx = await resolveActor(S.users.cleaner.id);
    await expect(loadBookingForActor(cleanerCtx, S.booking1!)).rejects.toThrow();

    // Outsider (no membership): fail-closed at actor resolution (no active
    // membership) — before any domain load could even run.
    await expect(
      resolveActor(S.users.outsider.id).then((c) => loadBookingForActor(c, S.booking1!)),
    ).rejects.toThrow();
  });

  it("02b TIMELINE CAP: the hard cap constant is applied (latest N, ascending)", async () => {
    expect(STAFF_TIMELINE_CAP).toBe(200);
    // A fresh booking has a small history; the cap must not truncate it.
    const events = await getBookingTimeline(S.hq!, S.booking2!);
    expect(events.length).toBeLessThanOrEqual(STAFF_TIMELINE_CAP);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  // -- 03) CUSTOMER EDIT on real Postgres (parameter-numbering regression) ----

  it("03 CUSTOMERS: staff edit works on hosted Postgres; foreign-org customer denied", async () => {
    // The Change 9 fix: updateCustomer binds values then the WHERE id
    // parameter — verified here against real PostgreSQL.
    const renamed = await updateCustomer(S.hq!, S.customerId!, { first_name: "Hosted", notes: "hv9 edit" });
    expect(renamed.first_name).toBe("Hosted");

    // Read-back shows the flag exposed read-only (BD-B4 display-only).
    expect(typeof renamed.contact_conflict_flag).toBe("boolean");

    // Foreign-org customer denied (org access fail-closed).
    const otherOrg = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV9 Other ${RUN}', 'hv9-org-other-${RUN}') returning id`,
      )
    )[0].id;
    await sql(`insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'hq_admin')`, [
      otherOrg,
      S.users.outsider.id,
    ]);
    const otherCtx = await resolveActor(S.users.outsider.id);
    await expect(updateCustomer(otherCtx, S.customerId!, { first_name: "Evil" })).rejects.toThrow();
  });

  // -- 04) STAFF CANCELLATION through the domain ------------------------------

  it("04 CANCEL: staff cancellation applies server tiers, records the outcome, writes audit", async () => {
    const outcome = await cancelBooking(S.hq!, { booking_id: S.booking2!, reason: "hv9 staff cancel" });
    expect(outcome.booking.status).toBe("cancelled");
    expect(typeof outcome.feeMinor).toBe("number");
    expect(typeof outcome.amountOwedMinor).toBe("number");
    expect(typeof outcome.tierPercent).toBe("number");

    const ev = await sql<{ event_type: string }>(
      `select event_type from public.booking_events where booking_id = $1 and event_type = 'booking_cancelled'`,
      [S.booking2!],
    );
    expect(ev.length).toBe(1);

    const audit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where action = 'booking.cancelled' and organization_id = $1`,
      [S.orgA!],
    );
    expect(Number(audit[0].n)).toBeGreaterThanOrEqual(1);
  });

  // -- 05) CREATION IDEMPOTENCY on hosted --------------------------------------

  it("05 IDEMPOTENCY: confirmBooking converges on idempotency-key reuse (wizard retry)", async () => {
    const sessionId = `sess-${randomUUID()}`;
    const idem = `conf-retry-${randomUUID()}`;
    const ctx = await resolveActor(S.users.hq.id);
    const hold = await createSlotHold(
      ctx,
      {
        branch_id: S.branch1!,
        service_id: S.svc1!,
        start_time: SLOT_2,
        end_time: new Date(new Date(SLOT_2).getTime() + 60 * 60_000).toISOString(),
        session_id: sessionId,
        idempotency_key: `hold-${randomUUID()}`,
      } as never,
      pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc1! }),
      NOW,
    );
    const quote = await calculateQuote({ branch_id: S.branch1!, service_id: S.svc1!, scheduled_date: SLOT_2.slice(0, 10) });
    const payload = {
      branch_id: S.branch1!,
      service_id: S.svc1!,
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: sessionId,
      customer: { first_name: "Retry", last_name: "Hosted", email: `hv9-retry-${RUN}@verify.example.com` },
      service_address: { street: "Hosted Street", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "dashboard" as const,
      accepted_total_minor: Number(quote.total.replace(".", "")),
      idempotency_key: idem,
    };
    const r1 = await confirmBooking(ctx, payload, NOW);
    const r2 = await confirmBooking(ctx, payload, NOW);
    expect(r1.replayed).toBe(false);
    expect(r2.replayed).toBe(true);
    expect(r2.booking.id).toBe(r1.booking.id);
  });

  // -- 06) RLS PROBES as the real authenticated role ---------------------------

  it("06 RLS: staff see own-org bookings/events; cleaner and outsider see none; policies unchanged", async () => {
    // HQ staff: own-org bookings and their events visible.
    const staffRows = await withRlsUser(S.users.staff.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.bookings where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(staffRows.rows[0].n)).toBeGreaterThanOrEqual(2);

    const staffEvents = await withRlsUser(S.users.staff.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.booking_events where booking_id = $1`, [S.booking1!]),
    );
    expect(Number(staffEvents.rows[0].n)).toBeGreaterThanOrEqual(2);

    // Branch manager RLS: membership_branches scope — branch1 rows only.
    const mgrBranch1 = await withRlsUser(S.users.mgr.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.bookings where branch_id = $1`, [S.branch1!]),
    );
    expect(Number(mgrBranch1.rows[0].n)).toBeGreaterThanOrEqual(1);
    const mgrBranch2 = await withRlsUser(S.users.mgr.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.bookings where branch_id = $1`, [S.branch2!]),
    );
    expect(Number(mgrBranch2.rows[0].n)).toBe(0);

    // Cleaner: no branch scope and not hq staff → no booking rows/events.
    const cleanerRows = await withRlsUser(S.users.cleaner.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.bookings where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(cleanerRows.rows[0].n)).toBe(0);
    const cleanerEvents = await withRlsUser(S.users.cleaner.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.booking_events where booking_id = $1`, [S.booking1!]),
    );
    expect(Number(cleanerEvents.rows[0].n)).toBe(0);

    // Outsider: zero visibility.
    const outsiderRows = await withRlsUser(S.users.outsider.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.bookings where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(outsiderRows.rows[0].n)).toBe(0);

    // Customers: staff can read own-org; outsider none.
    const staffCust = await withRlsUser(S.users.staff.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.customers where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(staffCust.rows[0].n)).toBeGreaterThanOrEqual(2);
    const outsiderCust = await withRlsUser(S.users.outsider.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.customers where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(outsiderCust.rows[0].n)).toBe(0);
  });
});
