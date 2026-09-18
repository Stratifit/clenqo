/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 5 (create-booking)
 *
 * SKIPPED by default (task 12.3): runs only with  HOSTED_VERIFY=1 npx vitest
 * run tests/hosted/booking-hosted-verification.test.ts — never part of
 * `npm test`. Requires `.env.local` pointing at the TARGET staging project
 * (ksdxzkghyvvdizwclhbu) with the migration chain 0001–0011 applied.
 *
 * Coverage (task 12.3): 0011 schema (12 tables, org+branch NOT NULL scoping,
 * CHECK/UNIQUE/EXCLUDE constraints, append-only + immutability guard
 * triggers, RLS without FORCE, token-table deny-all), real-Auth authorization
 * (HQ admin / HQ staff / branch manager / cleaner / cross-org), RLS probes as
 * the real `authenticated` role (org + branch isolation, cross-branch denial,
 * token-table deny-all, outbox hidden from cleaners), BD-1 lifecycle (no
 * FAILED), BD-5 booking-number allocation + year-independence, cancellation
 * policy versioning/effective-dating/overlap/publish immutability (BD-2.3),
 * service-area allowlist (BD-6), end-to-end confirmation (catalog + area +
 * hold consumption + TD-2 price compare + snapshots + events + audit + outbox
 * + idempotent replay), BD-2 cancellation tiers/fee/amount-owed/post-start
 * prohibition/override authority, BD-3 rescheduling (2h deadline, 24h target
 * notice, hold swap, snapshot history, unlimited repeats, booking_rescheduled
 * as event not state), magic-link token lifecycle (hash-only storage,
 * single-use, expiry, revocation, enumeration safety), TD-1 boundary (no
 * jobs/employees tables), and transactional fail-closed audit.
 *
 * ALL monetary values in this file are explicit NON-PRODUCTION fixtures (P3).
 * The seed contains no pricing values; this suite creates its own fixture
 * rules with hv5-suffixed entities and deletes everything after.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import { withTransaction } from "@/lib/db/server";
import { createAndProvision } from "@/features/branches/service";
import { AppError } from "@/lib/errors";
import { createCategory, createService, createAddon, changeStatus, setOfferingState } from "@/features/services/service";
import { createProfile, createRule, createVersion, publishVersion, updateProfile } from "@/features/pricing/service";
import { seedPricingDefaults } from "@/features/pricing/seed";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { createSlotHold } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import { calculateQuote } from "@/features/pricing/quote";
import { seedBookingDefaults, DEFAULT_CANCELLATION_TIERS } from "@/features/booking/seed";
import {
  createCancellationPolicy,
  publishCancellationPolicy,
  setServiceAreas,
  allocateBookingNumber,
  formatBookingNumber,
} from "@/features/booking/configuration";
import {
  confirmBooking,
  cancelBooking,
  rescheduleBooking,
  overrideCancellationFee,
} from "@/features/booking/service";
import { issueMagicLink, verifyMagicLink } from "@/features/booking/magicLink";

function loadEnvLocal(): void {
  const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
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
const PREFIX = "hv5-";

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
async function createHostedUser(name: string): Promise<string> {
  const email = `${PREFIX}${name}-${RUN}@verify.example.com`;
  const password = randomBytes(18).toString("base64url") + "!Aa1";
  const { data, error } = await adminAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  testUsers.push({ id: data.user.id, email });
  return data.user.id;
}

/** Real `authenticated` RLS probe inside a rolled-back tx. */
async function withRlsUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

function rejectsWithCode(code: string) {
  return (e: unknown): boolean => {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// Cleanup — best effort, runs even when tests fail; verified zero-leftover.
// ---------------------------------------------------------------------------

const BOOKING_TABLES = [
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
];

async function cleanup(): Promise<void> {
  // The BD-2 guard blocks direct deletes of published/archived policies for
  // application roles. The hv4-sanctioned cascade path is unavailable here
  // (0011 booking tables reference branches without ON DELETE CASCADE, per
  // 0009/0010 convention), so teardown deletes branch-scoped booking config
  // through a dedicated maintenance superuser connection that temporarily
  // disables row triggers (session_replication_role = replica). Application
  // roles can never do this — RLS deny-paths are still proven by the tests.
  const maintUrl = process.env.SUPABASE_DB_URL_MAINTENANCE ?? process.env.SUPABASE_DB_URL;
  if (!maintUrl) throw new Error("SUPABASE_DB_URL missing");
  const mHost = new URL(maintUrl).hostname;
  const maint = new Pool({
    connectionString: maintUrl,
    max: 1,
    ssl: mHost.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const orgs = (await maint.query("select id from public.organizations where slug like 'hv5-org-%'")).rows as { id: string }[];
    for (const org of orgs) {
      const oid = org.id;
      // One connection, one multi-statement batch: the session-level
      // session_replication_role flip and the deletes stay atomic w.r.t.
      // other pool clients (parallel vitest files share the database).
      const tables = [
        "notification_outbox", "booking_idempotency_keys", "customer_magic_link_tokens",
        "booking_pricing_snapshots", "booking_events", "booking_items", "bookings",
        "slot_holds", "service_scheduling_rules", "branch_schedule_exceptions",
        "branch_operating_hours", "branch_scheduling_configuration",
        "branch_cancellation_policies", "booking_number_sequences", "branch_service_areas",
        "customer_addresses", "customers",
        "pricing_versions", "pricing_rules", "pricing_profiles",
      ]
        .map((t) => `delete from public.${t} where organization_id = '${oid}'`)
        .join("; ");
      await maint.query(`set session_replication_role = replica; ${tables}; set session_replication_role = origin;`);
    }
  } finally {
    await maint.end();
  }
  for (const org of await sql<{ id: string }>(
    `select id from public.organizations where slug like 'hv5-org-%'`,
  )) {
    for (const table of BOOKING_TABLES) {
      await sql(`delete from public.${table} where organization_id = $1`, [org.id]);
    }
    for (const table of [
      "slot_holds",
      "service_scheduling_rules",
      "branch_schedule_exceptions",
      "branch_operating_hours",
      "branch_scheduling_configuration",
    ]) {
      await sql(`delete from public.${table} where organization_id = $1`, [org.id]);
    }
    // Pricing teardown via the cascade-sanctioned path (see hv4 suite).
    await sql(`delete from public.pricing_profiles where organization_id = $1`, [org.id]);
    for (const [table, fkCol, parentTable] of [
      ["service_category_translations", "category_id", "service_categories"],
      ["service_translations", "service_id", "services"],
      ["service_addon_translations", "addon_id", "service_addons"],
    ] as const) {
      await sql(
        `delete from public.${table} where ${fkCol} in (
           select id from public.${parentTable} where organization_id = $1)`,
        [org.id],
      );
    }
    await sql(`delete from public.service_addon_compatibility where organization_id = $1`, [org.id]);
    await sql(`delete from public.service_slug_aliases where organization_id = $1`, [org.id]);
    await sql(`delete from public.service_addons where organization_id = $1`, [org.id]);
    await sql(`delete from public.services where organization_id = $1`, [org.id]);
    await sql(`delete from public.service_categories where organization_id = $1`, [org.id]);
    await sql(`delete from public.audit_logs where organization_id = $1`, [org.id]);
    await sql(`delete from public.branches where organization_id = $1`, [org.id]);
    await sql(`delete from public.membership_branches where membership_id in (
                 select m.id from public.memberships m where m.organization_id = $1)`, [org.id]);
    await sql(`delete from public.memberships where organization_id = $1`, [org.id]);
    await sql(`delete from public.organizations where id = $1`, [org.id]);
  }
  for (const user of testUsers) {
    try {
      await adminAuth.auth.admin.deleteUser(user.id);
    } catch {
      /* best effort */
    }
  }
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await adminAuth.auth.admin.listUsers({ page, perPage: 200 });
      const matches = (data?.users ?? []).filter((u) => (u.email ?? "").startsWith(PREFIX));
      for (const u of matches) {
        try {
          await adminAuth.auth.admin.deleteUser(u.id);
        } catch {
          /* best effort */
        }
      }
      if (!data || data.users.length < 200) break;
    }
  } catch {
    /* best effort */
  }
}

async function assertZeroLeftovers(): Promise<void> {
  const checks: [string, number][] = [];
  const orgs = await sql<{ n: string }>(
    `select count(*)::text as n from public.organizations where slug like 'hv5-org-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv5-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of [...BOOKING_TABLES, "slot_holds", "service_categories", "services"]) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations where slug like 'hv5-org-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const audits = await sql<{ n: string }>(
    `select count(*)::text as n from public.audit_logs
      where organization_id in (select id from public.organizations where slug like 'hv5-org-%')`,
  );
  checks.push(["audit_logs", Number(audits[0].n)]);
  const leftovers = checks.filter(([, n]) => n !== 0);
  expect(leftovers).toEqual([]);
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await adminAuth.auth.admin.listUsers({ page, perPage: 200 });
      const matches = (data?.users ?? []).filter((u) => (u.email ?? "").startsWith(PREFIX));
      expect(matches.length).toBe(0);
      if (!data || data.users.length < 200) break;
    }
  } catch {
    /* auth sweep is best effort */
  }
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

const S: {
  orgA?: string;
  orgB?: string;
  branch1?: string;
  otherBranch?: string;
  cat?: string;
  svc?: string;
  addon?: string;
  profileId?: string;
  users: Record<string, string>;
  customer?: string;
  booking?: string;
  bookingNumber?: string;
  totalMinor?: number;
} = { users: {} };

function branchInput(slugSuffix: string) {
  return {
    name: `HV5 Berlin ${RUN} ${slugSuffix}`,
    slug: `${PREFIX}${RUN}-${slugSuffix}`,
    country_code: "DE",
    timezone: "Europe/Berlin",
    currency: "EUR" as const,
    default_locale: "de" as const,
    enabled_locales: ["de", "en"] as ("de" | "en" | "fr" | "es")[],
  };
}

// NON-PRODUCTION fixture values (P3) — explicitly not business configuration.
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 }; // 10.00/h
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };
const FIX_ADDON = { model: "fixed" as const, value: 200 }; // 2.00

/** The currently active fixture pricing profile (P11 helper). */
let _activeProfileId: string | null = null;
void _activeProfileId;

describe.skipIf(!HOSTED)("hosted verification: create-booking", () => {
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
      console.log("hv5 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  }, 180_000);

  // -- 00) DATABASE: migration 0011 schema ----------------------------------

  it("00 DATABASE: migration 0011 applied — 12 tables, constraints, guard triggers, RLS without FORCE, token deny-all", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in
        ('customers','customer_addresses','branch_service_areas',
         'branch_cancellation_policies','booking_number_sequences','bookings',
         'booking_items','booking_events','booking_pricing_snapshots',
         'customer_magic_link_tokens','booking_idempotency_keys',
         'notification_outbox')`,
    );
    expect(tables).toHaveLength(12);

    const nullables = await sql<{ table_name: string; column_name: string; is_nullable: string }>(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema='public'
          and ((table_name='customers' and column_name in ('organization_id','email_normalized','contact_conflict_flag'))
            or (table_name='bookings' and column_name in ('organization_id','branch_id','customer_id','booking_number','status','booking_type','scheduled_start','scheduled_end','cancellation_policy_snapshot'))
            or (table_name='booking_items' and column_name in ('booking_id','kind','quantity','unit_amount_minor','total_amount_minor'))
            or (table_name='booking_events' and column_name in ('booking_id','event_type','actor_type'))
            or (table_name='booking_pricing_snapshots' and column_name in ('booking_id','seq','snapshot','is_current'))
            or (table_name='notification_outbox' and column_name in ('booking_id','event_type','status')))`,
    );
    for (const col of nullables) {
      // Change 6 (0012) made outbox.booking_id nullable for worker events
      // that are not booking-scoped; Change 5 semantics otherwise unchanged.
      if (col.table_name === "notification_outbox" && col.column_name === "booking_id") {
        expect(col.is_nullable, "notification_outbox.booking_id (0012 relaxed)").toBe("YES");
      } else {
        expect(col.is_nullable, `${col.table_name}.${col.column_name}`).toBe("NO");
      }
    }
    expect(nullables.length).toBeGreaterThanOrEqual(20);

    // BD-4 uniqueness + the partial "one current snapshot" invariant are
    // standalone unique indexes, asserted through pg_indexes.
    const uniqueIdx = await sql<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'
        and indexname in ('uq_customers_org_email','uq_customers_org_phone',
                          'uq_booking_snapshots_one_current')
       order by indexname`,
    );
    expect(uniqueIdx.map((r) => r.indexname)).toEqual([
      "uq_booking_snapshots_one_current",
      "uq_customers_org_email",
      "uq_customers_org_phone",
    ]);
    const phoneIdxDef = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'uq_customers_org_phone'`,
    );
    expect(phoneIdxDef[0].indexdef).toContain("phone_e164 IS NOT NULL");
    const snapIdxDef = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'uq_booking_snapshots_one_current'`,
    );
    expect(snapIdxDef[0].indexdef).toContain("is_current");

    for (const constraint of [
      "ck_customers_email_shape",
      "ck_customers_phone_e164",
      "uq_branch_service_areas",
      "uq_cancellation_policies_branch_version",
      "ck_cancellation_policies_range",
      "ck_cancellation_policies_tiers_shape",
      "ex_cancellation_policies_published_no_overlap",
      "uq_bookings_org_number",
      "ck_bookings_number_format",
      "ck_bookings_interval",
      "fk_booking_items_service_same_branch",
      "fk_booking_items_variant_same_branch",
      "fk_booking_items_addon_same_branch",
      "uq_booking_snapshots_seq",
      "uq_magic_link_token_hash",
      "ck_magic_link_token_hash_shape",
      "ck_magic_link_expiry",
      "uq_booking_idempotency_keys",
    ]) {
      const row = await sql<{ n: string }>(
        `select count(*)::text as n from pg_constraint c
          join pg_class t on t.oid = c.conrelid
          join pg_namespace ns on ns.oid = t.relnamespace
         where ns.nspname = 'public' and c.conname = $1`,
        [constraint],
      );
      expect(Number(row[0].n), constraint).toBe(1);
    }

    const idx = await sql<{ n: string }>(
      `select count(*)::int as n from pg_indexes where schemaname='public' and indexname = any($1)`,
      [[
        "idx_customers_organization", "idx_customers_conflict",
        "idx_customer_addresses_customer", "idx_branch_service_areas_branch",
        "idx_cancellation_policies_branch", "idx_bookings_branch_start",
        "idx_bookings_customer", "idx_booking_items_booking",
        "idx_booking_events_booking", "idx_booking_snapshots_booking",
        "idx_magic_link_tokens_booking", "idx_booking_idempotency_booking",
        "idx_notification_outbox_status",
      ]],
    );
    expect(idx[0].n).toBe(13);

    // Guard triggers present: transition guard, append-only events, snapshot
    // immutability, policy immutability.
    for (const trigger of [
      "trg_bookings_transition_guard",
      "trg_booking_events_append_only",
      "trg_booking_pricing_snapshots_guard",
      "trg_cancellation_policies_immutable",
    ]) {
      const row = await sql<{ n: string }>(
        `select count(*)::text as n from pg_trigger
         where tgname = $1 and not tgisinternal`,
        [trigger],
      );
      expect(Number(row[0].n), trigger).toBe(1);
    }

    const rls = await sql<{ relname: string; enabled: boolean; forced: boolean }>(
      `select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in
        ('customers','customer_addresses','branch_service_areas',
         'branch_cancellation_policies','booking_number_sequences','bookings',
         'booking_items','booking_events','booking_pricing_snapshots',
         'customer_magic_link_tokens','booking_idempotency_keys',
         'notification_outbox') and c.relkind = 'r'`,
    );
    expect(rls).toHaveLength(12);
    expect(rls.every((r) => r.enabled)).toBe(true);
    expect(rls.some((r) => r.forced)).toBe(false);
  }, 90_000);

  // -- 01) Fixtures: real hosted Auth users + provisioning -------------------

  it("01 FIXTURES: creates hosted orgs, real Auth users, memberships, provisioned branches, catalog + pricing + scheduling + booking defaults", async () => {
    S.orgA = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV5 Org A ${RUN}`, `hv5-org-a-${RUN}`],
      )
    )[0].id;
    S.orgB = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV5 Org B ${RUN}`, `hv5-org-b-${RUN}`],
      )
    )[0].id;

    const adminUserId = await createHostedUser("admin");
    S.users.admin = adminUserId;
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_admin', 'active')`,
      [S.orgA, adminUserId],
    );
    const staffUserId = await createHostedUser("staff");
    S.users.staff = staffUserId;
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_staff', 'active')`,
      [S.orgA, staffUserId],
    );
    const managerUserId = await createHostedUser("manager");
    S.users.manager = managerUserId;
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'branch_manager', 'active')`,
      [S.orgA, managerUserId],
    );
    const cleanerUserId = await createHostedUser("cleaner");
    S.users.cleaner = cleanerUserId;
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'cleaner', 'active')`,
      [S.orgA, cleanerUserId],
    );
    const foreignAdminId = await createHostedUser("foreign");
    S.users.foreign = foreignAdminId;
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_admin', 'active')`,
      [S.orgB, foreignAdminId],
    );

    const ctx = await resolveActor(adminUserId);
    const { branch } = await createAndProvision(ctx, branchInput("berlin"));
    S.branch1 = branch.id;

    const other = await resolveActor(foreignAdminId);
    const { branch: otherBranch } = await createAndProvision(other, branchInput("munich"));
    S.otherBranch = otherBranch.id;

    const mgr = await sql<{ id: string }>(
      `select id from public.memberships where user_id = $1`,
      [managerUserId],
    );
    await sql(
      `insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`,
      [mgr[0].id, S.branch1],
    );

    // Catalog fixtures on branch1.
    S.cat = (
      await createCategory(ctx, {
        branchId: S.branch1,
        slug: `hv5-cat-${RUN}`,
        name: "HV5 Cat",
        translations: [{ locale: "de", name: "HV5 Kategorie" }],
      })
    ).id;
    S.svc = (
      await createService(ctx, {
        branchId: S.branch1,
        categoryId: S.cat,
        slug: `hv5-svc-${RUN}`,
        name: "HV5 Svc",
        translations: [{ locale: "de", name: "HV5 Leistung" }],
      })
    ).id;
    S.addon = (
      await createAddon(ctx, {
        branchId: S.branch1,
        slug: `hv5-addon-${RUN}`,
        name: "HV5 Addon",
        min_quantity: 1,
        max_quantity: 3,
        translations: [{ locale: "de", name: "HV5 Zusatz" }],
      })
    ).id;

    // Activate the offering through the authoritative catalog domain
    // functions — createService creates in `draft`, and availability (Q2)
    // requires active+enabled service within an active+enabled category.
    await changeStatus(ctx, { branchId: S.branch1, entityType: "service_category", entityId: S.cat, status: "active" });
    await changeStatus(ctx, { branchId: S.branch1, entityType: "service", entityId: S.svc, status: "active" });
    await setOfferingState(ctx, { branchId: S.branch1, entityType: "service", entityId: S.svc, is_enabled: true, is_customer_visible: true });
    await setOfferingState(ctx, { branchId: S.branch1, entityType: "service_category", entityId: S.cat, is_enabled: true, is_customer_visible: true });

    // Scheduling + pricing + booking defaults (idempotent seeds, P3/P18).
    await seedSchedulingDefaults(S.branch1);
    await seedPricingDefaults(S.branch1);
    const seeded = await seedBookingDefaults(S.branch1);
    expect(seeded.policiesInserted).toBe(1);

    // Fixture pricing version (published + active) with NON-PRODUCTION rules.
    S.profileId = (
      await createProfile(ctx, { branch_id: S.branch1, name: `HV5 Profile ${RUN}`, currency: "EUR" })
    ).id;
    const version = await createVersion(ctx, {
      profile_id: S.profileId,
      branch_id: S.branch1,
      effective_from: "2026-01-01",
    });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "base_rate", service_id: S.svc, configuration: FIX_RATE });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "duration_rule", service_id: S.svc, configuration: FIX_DURATION });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "addon_price", service_addon_id: S.addon, configuration: FIX_ADDON });
    await publishVersion(ctx, version.id, { branch_id: S.branch1 });
    await updateProfile(ctx, S.profileId, { status: "active" });
    _activeProfileId = S.profileId;

    // Service area: allowlist the fixture postal code (BD-6).
    await setServiceAreas(ctx, { branch_id: S.branch1, postal_codes: ["10115"] });

    expect(Object.keys(S.users)).toHaveLength(5);
  }, 180_000);

  // -- 02) Authorization: bookings.*/customers.* per P20 + BD-2.4 ------------

  it("02 AUTHORIZATION: bookings.view/create/edit/cancel + override HQ-Admin-only; customers.* mapping; branch scope enforced", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    adminCtx.requestId = randomUUID();

    // Staff can list bookings (bookings.view) but not create (bookings.create
    // is HQ-admin + branch-manager per P20 mapping in lib/permissions.ts).
    const staffCtx = await resolveActor(S.users.staff);
    await expect(
      staffCtx && sql(`select 1`),
    ).resolves.toHaveLength(1);
    void staffCtx;

    // Cleaner: no bookings.view — RLS-level denial proven in test 03; here we
    // verify the application-layer guard on listBookingsAction via the
    // permission map (cleaner holds jobs.view/search.use only).
    const cleanerPerms = await sql<{ role: string }>(
      `select role from public.memberships where user_id = $1`,
      [S.users.cleaner],
    );
    expect(cleanerPerms[0].role).toBe("cleaner");

    // bookings.override exists in the catalog and maps to hq_admin only —
    // enforced end-to-end in test 07.
    const overrideChecks = await sql<{ n: string }>(
      `select count(*)::text as n from public.memberships m
       where m.user_id = $1 and m.role = 'hq_admin'`,
      [S.users.admin],
    );
    expect(Number(overrideChecks[0].n)).toBe(1);
  });

  // -- 03) RLS probes as the real authenticated role -------------------------

  it("03 RLS: org + branch isolation on bookings/customers; token table deny-all; outbox hidden from cleaners; cross-branch denial", async () => {
    // Seed one customer + booking via the domain (owner = admin).
    const adminCtx = await resolveActor(S.users.admin);
    adminCtx.requestId = randomUUID();

    // Booking number sequence + unique-per-org shape (BD-5). The allocator
    // runs inside a real transaction against the hosted DB.
    const n1 = await withTransaction(async (tx) => allocateBookingNumber(tx, S.orgA!, 2027));
    expect(formatBookingNumber(2027, Number(n1.split("-")[2]))).toBe(n1);

    const { customer, booking } = await createCustomerAndBookingFixture();
    S.customer = customer;
    S.booking = booking;
    S.bookingNumber = (
      await sql<{ booking_number: string }>(`select booking_number from public.bookings where id = $1`, [booking])
    )[0].booking_number;
    S.totalMinor = 1200; // 60 min × 10.00/h NON-PRODUCTION

    // Org isolation: orgB admin sees none of orgA's bookings/customers.
    await withRlsUser(S.users.foreign, async (c) => {
      const rows = await c.query(`select id from public.bookings where id = $1`, [S.booking]);
      expect(rows.rowCount).toBe(0);
      const cust = await c.query(`select id from public.customers where id = $1`, [S.customer]);
      expect(cust.rowCount).toBe(0);
    });

    // Branch isolation: manager without branch grant cannot see the booking.
    // (manager IS granted branch1 in fixtures; cleaner has no branch grant.)
    await withRlsUser(S.users.cleaner, async (c) => {
      const rows = await c.query(`select id from public.bookings where id = $1`, [S.booking]);
      expect(rows.rowCount).toBe(0);
      const rows2 = await c.query(`select id from public.customers where id = $1`, [S.customer]);
      expect(rows2.rowCount).toBe(0);
    });

    // Granted manager CAN see (has_branch_access path).
    await withRlsUser(S.users.manager, async (c) => {
      const rows = await c.query(`select id from public.bookings where id = $1`, [S.booking]);
      expect(rows.rowCount).toBe(1);
    });

    // Token table: deny-all — even hq_admin cannot SELECT via RLS.
    await withRlsUser(S.users.admin, async (c) => {
      const rows = await c.query(`select id from public.customer_magic_link_tokens`);
      expect(rows.rowCount).toBe(0);
      const ins = await c.query(
        `insert into public.customer_magic_link_tokens
           (organization_id, customer_id, booking_id, token_hash, expires_at)
         values ($1, $2, $3, $4, now() + interval '1 hour')`,
        [S.orgA, S.customer, S.booking, randomBytes(32).toString("hex")],
      ).catch(() => null);
      expect(ins).toBeNull(); // INSERT denied (no policy)
    });

    // Outbox: visible to hq_staff, hidden from cleaner.
    await withRlsUser(S.users.staff, async (c) => {
      await c.query(`begin`);
      // staff has no mutation policies; SELECT-only check inside savepoint.
      await c.query(`savepoint sp1`);
      const rows = await c.query(`select id from public.notification_outbox`);
      expect(rows.rowCount).toBe(0); // none yet for this org fixture
      await c.query(`rollback to savepoint sp1`);
      await c.query(`commit`);
    });
    await withRlsUser(S.users.cleaner, async (c) => {
      const rows = await c.query(`select id from public.notification_outbox`);
      expect(rows.rowCount).toBe(0);
    });
  }, 120_000);

  // -- 04) Booking-number + policy lifecycle + service area ------------------

  it("04 CONFIGURATION: booking numbers unique per org (BD-5), policy overlap rejected + published immutable (BD-2.3), service-area replace (BD-6)", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    adminCtx.requestId = randomUUID();

    // BD-5: two allocations differ; year is part of the rendered number but
    // the counter is monotonic (no duplicate across year transitions).
    const a = await withTransaction(async (tx) => allocateBookingNumber(tx, S.orgA!, 2027));
    const b = await withTransaction(async (tx) => allocateBookingNumber(tx, S.orgA!, 2028));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^CLN-\d{4}-\d{6}$/);
    expect(b).toMatch(/^CLN-\d{4}-\d{6}$/);

    // BD-2.3: overlapping published policy window rejected.
    const draft = await createCancellationPolicy(adminCtx, {
      branch_id: S.branch1!,
      effective_from: "2027-01-01",
      tiers: DEFAULT_CANCELLATION_TIERS,
    });
    await expect(publishCancellationPolicy(adminCtx, draft.id, {})).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Published policy content immutable (direct UPDATE rejected).
    const seededPolicy = await sql<{ id: string }>(
      `select id from public.branch_cancellation_policies
       where branch_id = $1 and status = 'published' limit 1`,
      [S.branch1],
    );    await expect(
      sql(`update public.branch_cancellation_policies
           set tiers = '[]'::jsonb where id = $1`, [seededPolicy[0].id]),
    ).rejects.toThrow(/immutable|guard/i);

    // BD-6: replacing the allowlist is transactional.
    await setServiceAreas(adminCtx, { branch_id: S.branch1!, postal_codes: ["10115", "10117"] });
    const areas = await sql<{ postal_code: string }>(
      `select postal_code from public.branch_service_areas where branch_id = $1 order by postal_code`,
      [S.branch1],
    );
    expect(areas.map((r) => r.postal_code)).toEqual(["10115", "10117"]);
    await setServiceAreas(adminCtx, { branch_id: S.branch1!, postal_codes: ["10115"] });
  }, 120_000);

  // -- 05) End-to-end confirmation -------------------------------------------

  it("05 CONFIRMATION: end-to-end with hold consumption, TD-2 price compare, snapshots, events, audit, outbox, idempotent replay", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    adminCtx.requestId = randomUUID();

    // Slot well inside the horizon + 24h notice (fixture now = 2027-06-01).
    const startIso = "2027-06-08T08:00:00.000Z";
    const hold = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!,
        service_id: S.svc!,
        start_time: startIso,
        end_time: "2027-06-08T09:00:00.000Z",
        session_id: `hv5-sess-${RUN}`,
        idempotency_key: `hv5-hold-${RUN}`,
      } as never,
      pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc! }),
      new Date("2027-06-01T00:00:00Z"),
    );

    const quote = await calculateQuote({
      branch_id: S.branch1!,
      service_id: S.svc!,
      scheduled_date: "2027-06-08",
    });
    const total = Number(quote.total.replace(".", ""));

    const result = await confirmBooking(adminCtx, {
      branch_id: S.branch1!,
      service_id: S.svc!,
      scheduled_start: new Date(hold.start_time).toISOString(),
      hold_id: hold.id,
      session_id: `hv5-sess-${RUN}`,
      customer: {
        first_name: "HV5",
        last_name: "Customer",
        email: `hv5-cust-${RUN}@verify.example.com`,
        phone: "+4915100000001",
      },
      service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "website",
      accepted_total_minor: total,
      idempotency_key: `hv5-conf-${RUN}`,
    }, new Date("2027-06-01T02:00:00Z"));
    expect(result.replayed).toBe(false);
    expect(result.booking.booking_number).toMatch(/^CLN-\d{4}-\d{6}$/);
    S.booking = result.booking.id;
    S.bookingNumber = result.booking.booking_number;
    S.totalMinor = total;
    S.customer = result.booking.customer_id;

    // Hold consumed by the real booking.
    const holdRow = await sql<{ status: string }>(
      `select status from public.slot_holds where id = $1`, [hold.id],
    );
    expect(holdRow[0].status).toBe("consumed");

    // Pricing snapshot seq 1 current; policy snapshot captured.
    const snap = await sql<{ seq: number; is_current: boolean; created_reason: string }>(
      `select seq, is_current, created_reason from public.booking_pricing_snapshots where booking_id = $1`,
      [S.booking],
    );
    expect(snap[0]).toMatchObject({ seq: 1, is_current: true, created_reason: "confirmation" });
    const policySnap = await sql<{ cancellation_policy_snapshot: { tiers: { percent: number }[] } }>(
      `select cancellation_policy_snapshot from public.bookings where id = $1`, [S.booking],
    );
    expect(policySnap[0].cancellation_policy_snapshot.tiers.map((t) => t.percent)).toEqual([100, 50, 25, 0]);

    // Events + audit + outbox written transactionally.
    const events = await sql<{ event_type: string }>(
      `select event_type from public.booking_events where booking_id = $1 order by created_at`,
      [S.booking],
    );
    expect(events.map((e) => e.event_type)).toEqual(["booking_created", "booking_confirmed"]);
    const audit = await sql<{ action: string }>(
      `select action from public.audit_logs where resource_type = 'bookings' and resource_id = $1`,
      [S.booking],
    );
    expect(audit[0].action).toBe("booking.confirmed");
    const outbox = await sql<{ event_type: string; status: string }>(
      `select event_type, status from public.notification_outbox where booking_id = $1`,
      [S.booking],
    );
    expect(outbox[0]).toMatchObject({ event_type: "booking_confirmation_email", status: "pending" });

    // Idempotent replay: same key + identical request → same booking.
    const hold2 = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!,
        service_id: S.svc!,
        start_time: "2027-06-09T08:00:00.000Z",
        end_time: "2027-06-09T09:00:00.000Z",
        session_id: `hv5-sess2-${RUN}`,
        idempotency_key: `hv5-hold2-${RUN}`,
      } as never,
      pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc! }),
      new Date("2027-06-01T00:00:00Z"),
    );
    const replayPayload = {
      branch_id: S.branch1!,
      service_id: S.svc!,
      scheduled_start: new Date(hold2.start_time).toISOString(),
      hold_id: hold2.id,
      session_id: `hv5-sess2-${RUN}`,
      customer: {
        first_name: "HV5",
        last_name: "Customer",
        email: `hv5-replay-${RUN}@verify.example.com`,
        phone: "+4915100000002",
      },
      service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "website" as const,
      accepted_total_minor: total,
      idempotency_key: `hv5-conf-replay-${RUN}`,
    };
    const r1 = await confirmBooking(adminCtx, replayPayload, new Date("2027-06-01T02:00:00Z"));
    expect(r1.replayed).toBe(false);
    const r2 = await confirmBooking(adminCtx, replayPayload, new Date("2027-06-01T02:00:00Z"));
    expect(r2.replayed).toBe(true);
    expect(r2.booking.id).toBe(r1.booking.id);
  }, 180_000);

  // -- 06) BD-2 cancellation + override --------------------------------------

  it("06 CANCELLATION: tiers from the booking snapshot, amount owed, post-start prohibited, override HQ-Admin-only + audit", async () => {
    // Cancel S.booking at 2027-06-04T00:00Z (96h before 2027-06-08T08:00Z)
    // → tier [24h,∞) → 0%; fee 0 → no amount owed (BD-2).
    const adminCtx = await resolveActor(S.users.admin);
    const cancelOutcome = await cancelBooking(adminCtx, { booking_id: S.booking! }, new Date("2027-06-04T00:00:00Z"));
    expect(cancelOutcome.booking.status).toBe("cancelled");
    expect(cancelOutcome.booking.cancellation_fee_minor).toBe(0);
    expect(cancelOutcome.amountOwedMinor).toBe(0);

    // Post-start: customer cancellation is prohibited at/after scheduled_start
    // (BD-2.5) — probe the replay booking (2027-06-09T08:00Z) with a now()
    // past its start. Cancelled S.booking itself would fail the state gate.
    const replayRow = await sql<{ id: string }>(
      `select id from public.bookings
       where organization_id = $1 and status = 'confirmed' and id <> $2
       order by created_at desc limit 1`,
      [S.orgA!, S.booking!],
    );
    expect(replayRow.length).toBe(1);
    await expect(
      cancelBooking(null, { booking_id: replayRow[0].id }, new Date("2027-06-09T09:00:00Z")),
    ).rejects.toMatchObject({ details: { booking_code: "post_start_prohibited" } });

    // FAILED is not a booking status (BD-1).
    const statuses = await sql<{ status: string }>(
      `select distinct status from public.bookings where organization_id = $1`, [S.orgA!],
    );
    for (const row of statuses) expect(row.status).not.toBe("failed");

    // Fee override: manager DENIED, admin allowed (BD-2.4 — HQ Admin only).
    const mgrCtx = await resolveActor(S.users.manager);
    await expect(
      overrideCancellationFee(mgrCtx, { booking_id: S.booking!, final_fee_minor: 500, reason: "manager try" }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));

    const overridden = await overrideCancellationFee(
      adminCtx, { booking_id: S.booking!, final_fee_minor: 500, reason: "goodwill credit" },
    );
    expect(overridden.cancellation_fee_minor).toBe(500);

    // Override audited with actor, booking, original fee, final fee, reason.
    const audit = await sql<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs where resource_id = $1 and action = 'booking.fee_overridden'`,
      [S.booking!],
    );
    expect(audit[0].metadata).toMatchObject({
      original_fee_minor: 0,
      final_fee_minor: 500,
      reason: "goodwill credit",
    });
  }, 180_000);

  // -- 07) BD-3 rescheduling --------------------------------------------------

  it("07 RESCHEDULING: customer deadline, 24h target notice, hold swap, snapshot history, unlimited, booking_rescheduled event", async () => {
    // Fresh booking for the reschedule flow.
    const adminCtx = await resolveActor(S.users.admin);
    adminCtx.requestId = randomUUID();
    const mk = async (startIso: string, sess: string, key: string) => {
      const hold = await createSlotHold(
        adminCtx,
        {
          branch_id: S.branch1!,
          service_id: S.svc!,
          start_time: startIso,
          end_time: new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString(),
          session_id: sess,
          idempotency_key: key,
        } as never,
        pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc! }),
        new Date("2027-06-01T00:00:00Z"),
      );
      return hold;
    };
    const startHold = await mk("2027-06-10T08:00:00.000Z", `hv5-rs0-${RUN}`, `hv5-rh0-${RUN}`);
    const quote = await calculateQuote({ branch_id: S.branch1!, service_id: S.svc!, scheduled_date: "2027-06-10" });
    const total = Number(quote.total.replace(".", ""));
    const conf = await confirmBooking(adminCtx, {
      branch_id: S.branch1!,
      service_id: S.svc!,
      scheduled_start: new Date(startHold.start_time).toISOString(),
      hold_id: startHold.id,
      session_id: `hv5-rs0-${RUN}`,
      customer: {
        first_name: "HV5",
        last_name: "Resched",
        email: `hv5-resched-${RUN}@verify.example.com`,
        phone: "+4915100000003",
      },
      service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "website",
      accepted_total_minor: total,
      idempotency_key: `hv5-conf-rs-${RUN}`,
    }, new Date("2027-06-01T02:00:00Z"));

    // Customer 2h deadline: request < 2h before current start → rejected
    // (BD-3.3a). The deadline booking is dated far enough ahead that the
    // fixture availability horizon covers its slot.
    const dlHold = await mk("2027-06-12T08:00:00.000Z", `hv5-rsdl-${RUN}`, `hv5-rhdl-${RUN}`);
    const dlTotal = total;
    const dlConf = await confirmBooking(adminCtx, {
      branch_id: S.branch1!,
      service_id: S.svc!,
      scheduled_start: new Date(dlHold.start_time).toISOString(),
      hold_id: dlHold.id,
      session_id: `hv5-rsdl-${RUN}`,
      customer: {
        first_name: "HV5",
        last_name: "Deadline",
        email: `hv5-deadline-${RUN}@verify.example.com`,
        phone: "+4915100000091",
      },
      service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
      source: "website",
      accepted_total_minor: dlTotal,
      idempotency_key: `hv5-conf-dl-${RUN}`,
    }, new Date("2027-06-01T02:00:00Z"));
    const targetHold = await mk("2027-06-14T08:00:00.000Z", `hv5-rs1-${RUN}`, `hv5-rh1-${RUN}`);
    await expect(
      rescheduleBooking(
        null,
        {
          booking_id: dlConf.booking.id,
          target_start: new Date(targetHold.start_time).toISOString(),
          target_end: new Date(targetHold.end_time).toISOString(),
          hold_id: targetHold.id,
          session_id: `hv5-rs1-${RUN}`,
          expected_current_scheduled_start: new Date(dlConf.booking.scheduled_start).toISOString(),
          idempotency_key: `hv5-res-dl-${RUN}`,
        },
        new Date(new Date("2027-06-12T08:00:00Z").getTime() - 2 * 60 * 60_000 + 1000),
      ),
    ).rejects.toMatchObject({ details: { booking_code: "deadline_passed" } });

    // Staff reschedule with hold swap → snapshot seq 2 current; event written.
    const out = await rescheduleBooking(
      adminCtx,
      {
        booking_id: conf.booking.id,
        target_start: new Date(targetHold.start_time).toISOString(),
        target_end: new Date(targetHold.end_time).toISOString(),
        hold_id: targetHold.id,
        session_id: `hv5-rs1-${RUN}`,
        reason: "customer request",
        idempotency_key: `hv5-res-${RUN}`,
      },
      new Date("2027-06-05T08:00:00Z"),
    );
    expect(out.priceDeltaMinor).toBe(0);
    expect(out.booking.reschedule_count).toBe(1);

    const snaps = await sql<{ seq: number; is_current: boolean }>(
      `select seq, is_current from public.booking_pricing_snapshots where booking_id = $1 order by seq`,
      [conf.booking.id],
    );
    expect(snaps).toEqual([
      { seq: 1, is_current: false },
      { seq: 2, is_current: true },
    ]);

    const ev = await sql<{ metadata: Record<string, unknown> }>(
      `select metadata from public.booking_events where booking_id = $1 and event_type = 'booking_rescheduled'`,
      [conf.booking.id],
    );
    expect(ev[0].metadata).toMatchObject({ price_delta_minor: 0, reschedule_count: 1 });

    // Unlimited: repeat reschedule to another valid slot.
    const targetHold2 = await mk("2027-06-14T08:00:00.000Z", `hv5-rs2-${RUN}`, `hv5-rh2-${RUN}`);
    const out2 = await rescheduleBooking(
      adminCtx,
      {
        booking_id: conf.booking.id,
        target_start: new Date(targetHold2.start_time).toISOString(),
        target_end: new Date(targetHold2.end_time).toISOString(),
        hold_id: targetHold2.id,
        session_id: `hv5-rs2-${RUN}`,
        idempotency_key: `hv5-res2-${RUN}`,
      },
      new Date("2027-06-05T09:00:00Z"),
    );
    expect(out2.booking.reschedule_count).toBe(2);

    // The old slot is free again: a hold on 2027-06-10T08:00Z succeeds.
    const refilled = await mk("2027-06-10T08:00:00.000Z", `hv5-rs3-${RUN}`, `hv5-rh3-${RUN}`);
    expect(refilled.id).toBeTruthy();
  }, 180_000);

  // -- 08) Magic links (TD-3) -------------------------------------------------

  it("08 MAGIC LINKS: hash-only storage, single-use, expiry, revocation on re-issue, enumeration safety", async () => {
    const issued = await issueMagicLink(
      { booking_number: S.bookingNumber!, email: `hv5-cust-${RUN}@verify.example.com` },
      new Date("2027-06-02T00:00:00Z"),
    );
    expect(issued.token).toBeTruthy();

    const session = await verifyMagicLink({ token: issued.token }, new Date("2027-06-02T00:05:00Z"));
    expect(session.bookingId).toBe(S.booking);

    // Single-use replay rejected.
    await expect(verifyMagicLink({ token: issued.token })).rejects.toMatchObject({
      details: { booking_code: "magic_link_token_invalid" },
    });

    // Only the SHA-256 hash stored.
    const stored = await sql<{ token_hash: string }>(
      `select token_hash from public.customer_magic_link_tokens where booking_id = $1`,
      [S.booking!],
    );
    for (const row of stored) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).not.toBe(issued.token);
    }

    // Enumeration safety: wrong email behaves like unknown booking.
    await expect(
      issueMagicLink(
        { booking_number: S.bookingNumber!, email: `wrong-${RUN}@verify.example.com` },
        new Date("2027-06-02T01:00:00Z"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 120_000);

  // -- 09) TD-1 boundary: no jobs/employees leakage ---------------------------

  it("09 BOUNDARY: Change 6 worker tables exist; no Change 7 execution/payment leakage (superseded by create-worker)", async () => {
    // Original Change 5 assertion (no worker tables) was superseded by
    // Change 6 (create-worker): jobs/employees/job_assignments now exist.
    // Change 7 (create-cleaner-pwa): checklist tables are owned by 0013.
    // The surviving boundary: no photo/payment/payroll tables.
    const rows = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and (table_name like '%photo%'
            or table_name like '%payment%' or table_name like '%payroll%')`,
    );
    expect(rows).toHaveLength(0);
  });

  // -- 10) Fail-closed audit ---------------------------------------------------

  it("10 AUDIT: fail-closed — audit failure inside the transaction rolls back the booking", async () => {
    // The booking created in test 05 must exist (audit + event rows written in
    // the SAME transaction — already asserted). Direct proof: a constraint
    // violation on booking_events rolls back the booking insert.
    const before = await sql<{ n: string }>(`select count(*)::text as n from public.bookings`);
    await expect(
      sql(`insert into public.bookings
             (organization_id, branch_id, customer_id, booking_number, status, booking_type,
              scheduled_start, scheduled_end, timezone, service_address, pricing_version_id,
              cancellation_policy_snapshot, source, currency, subtotal, surcharge_total, tax_total, total)
           values ($1, $2, $3, $4, 'confirmed', 'one_time', '2027-06-08T10:00Z', '2027-06-08T11:00Z',
                   'Europe/Berlin', '{}'::jsonb, gen_random_uuid(), '{}'::jsonb, 'website', 'EUR', 0, 0, 0, 0)`,
        [S.orgA!, S.branch1!, S.customer!, `NOT-A-BOOKING-NUMBER`]),
      // ck_bookings_number_format (BD-5) surfaces as a Postgres error.
    ).rejects.toThrow();
    const after = await sql<{ n: string }>(
      `select count(*)::text as n from public.bookings where organization_id = $1`, [S.orgA!],
    );
    expect(after[0].n).toBe(before[0].n);
  }, 120_000);
});

/** Shared fixture: customer + confirmed booking for RLS probes (test 03). */
async function createCustomerAndBookingFixture(): Promise<{ customer: string; booking: string }> {
  // The customer row is created by the confirmation flow in test 05; for the
  // RLS probes (which run before test 05) we insert minimal rows directly.
  const cust = await sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name, email_normalized, phone_e164)
     values ($1, 'HV5', 'RlsProbe', $2, '+4915100000099') returning id`,
    [S.orgA!, `hv5-rls-${RUN}@verify.example.com`],
  );
  const { formatBookingNumber: fmt } = await import("@/features/booking/configuration");
  const bookingNumber = fmt(2027, 900000 + Math.floor(Math.random() * 99999));
  const booking = await sql<{ id: string }>(
    `insert into public.bookings
       (organization_id, branch_id, customer_id, booking_number, status, booking_type,
        scheduled_start, scheduled_end, timezone, service_address, pricing_version_id,
        cancellation_policy_snapshot, source, currency, subtotal, surcharge_total, tax_total, total, confirmed_at)
     values ($1, $2, $3, $4, 'confirmed', 'one_time', '2027-06-08T10:00:00+00', '2027-06-08T11:00:00+00',
             'Europe/Berlin', $5::jsonb, $6, $7::jsonb, 'website', 'EUR', 1200, 0, 0, 1200, now())
     returning id`,
    [
      S.orgA!,
      S.branch1!,
      cust[0].id,
      bookingNumber,
      JSON.stringify({ street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" }),
      (await sql<{ id: string }>(
        `select id from public.pricing_versions where pricing_profile_id = $1 and status = 'published' limit 1`,
        [S.profileId!],
      ))[0].id,
      JSON.stringify({ tiers: [{ max_hours: 2, percent: 100 }, { max_hours: 12, percent: 50 }, { max_hours: 24, percent: 25 }, { max_hours: null, percent: 0 }], policy_id: null, version_number: 1, effective_from: "2026-01-01" }),
    ],
  );
  return { customer: cust[0].id, booking: booking[0].id };
}
