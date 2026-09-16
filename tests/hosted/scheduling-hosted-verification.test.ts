/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 3 (create-scheduling-availability)
 *
 * SKIPPED by default (task 13.1 implemented; 13.2 executed only on explicit
 * authorization): runs only with  HOSTED_VERIFY=1 npx vitest run tests/hosted/
 * — never as part of `npm test`. Requires a configured `.env.local` pointing
 * at the TARGET staging project (ksdxzkghyvvdizwclhbu) with the migration
 * chain 0001–0009 applied.
 *
 * Coverage (task 13.1): 0009 schema (5 tables, columns, constraints, FKs,
 * indexes, no duration/price fields, no FORCE RLS), real-Auth authorization
 * (HQ / HQ Staff / Branch Manager / Cleaner / cross-org / unauthenticated),
 * organization + branch isolation, RLS probes as the real `authenticated`
 * role (read scoping + write denial), definer-helper policies, transactional
 * audit incl. FAIL-CLOSED verification, scheduling configuration with the
 * approved §86 defaults, operating-hours effective dating + immutability,
 * typed schedule exceptions with template precedence, service scheduling
 * rules with cross-branch rejection, deterministic availability incl. notice
 * and DST transitions on real PostgreSQL/ICU, capacity cap = 3 (S7), slot
 * holds lifecycle (TTL 15 min, one-active-per-session, idempotency, release,
 * atomic consumption, sweep), and best-effort cleanup of every `hv3-` record.
 *
 * Duration contract note: this suite injects an explicit 45-minute
 * DurationProvider (fixed45) — deliberately different from the 60-minute
 * placeholder — so every slot-length assertion proves the engine consumed
 * THE INJECTED contract, never the placeholder. The placeholder itself is
 * never imported here.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import {
  createScheduleException,
  getSchedulingConfig,
  listOperatingHours,
  listScheduleExceptions,
  updateSchedulingConfig,
  upsertOperatingHours,
  upsertServiceSchedulingRule,
} from "@/features/scheduling/service";
import { getAvailability } from "@/features/scheduling/availability";
import {
  consumeHoldInTx,
  createSlotHold,
  releaseSlotHold,
  sweepExpiredHolds,
} from "@/features/scheduling/holds";
import { validateSlotFeasibility } from "@/features/scheduling/feasibility";
import {
  DEFAULT_OPERATING_HOURS,
  seedSchedulingDefaults,
} from "@/features/scheduling/seed";
import type { DurationProvider } from "@/features/scheduling/durationProvider";
import type { TransactionClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";

function loadEnvLocal(): void {
  const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!(m[1] in process.env) || !process.env[m[1]]) process.env[m[1]] = value;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL_RAW = process.env.SUPABASE_DB_URL ?? "";
const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split(".")[0] : "";
const HOSTED = process.env.HOSTED_VERIFY === "1";

const RUN = randomBytes(3).toString("hex");
const PREFIX = "hv3-";

let pool: Pool | null = null;

async function sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  if (!pool) throw new Error("pool not initialized");
  const res = await pool.query(text, (params ?? []) as never[]);
  return res.rows as T[];
}

const adminAuth: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Create a REAL hosted auth user (admin API); registered for cleanup. */
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

/**
 * Run fn as the real `authenticated` role with auth.uid() set — genuine RLS
 * evaluation on the hosted database. Everything runs in a rolled-back tx.
 */
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

/** Run fn as the privileged (owner) role inside a rolled-back tx. */
async function withOwnerTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool!.connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

interface AuditRow {
  action: string;
  actor_user_id: string | null;
  actor_type: string;
  organization_id: string;
  branch_id: string | null;
  resource_type: string;
  resource_id: string | null;
  result: string;
  metadata: Record<string, unknown>;
}

async function auditRows(resourceId: string): Promise<AuditRow[]> {
  return sql<AuditRow>(
    `select action, actor_user_id, actor_type, organization_id, branch_id,
            resource_type, resource_id, result, metadata
       from public.audit_logs where resource_id = $1 order by created_at asc`,
    [resourceId],
  );
}

function expectAppError(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

/** Boolean predicate form of expectAppError for `.rejects.toSatisfy`. */
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

async function cleanup(): Promise<void> {
  const orgs = await sql<{ id: string }>(
    `select id from public.organizations where slug like 'hv3-org-%'`,
  );
  for (const org of orgs) {
    // Scheduling tables first (FKs into services/branches), then catalog
    // translations via parent scoping, then catalog + platform tables.
    for (const table of [
      "slot_holds",
      "service_scheduling_rules",
      "branch_schedule_exceptions",
      "branch_operating_hours",
      "branch_scheduling_configuration",
    ]) {
      await sql(`delete from public.${table} where organization_id = $1`, [org.id]);
    }
    for (const [table, fkCol, parentTable] of [
      ["service_category_translations", "category_id", "service_categories"],
      ["service_translations", "service_id", "services"],
    ] as const) {
      await sql(
        `delete from public.${table} where ${fkCol} in (
           select id from public.${parentTable} where organization_id = $1)`,
        [org.id],
      );
    }
    await sql(`delete from public.services where organization_id = $1`, [org.id]);
    await sql(`delete from public.service_categories where organization_id = $1`, [org.id]);
    await sql(`delete from public.audit_logs where organization_id = $1`, [org.id]);
    // Websites/sections/pages/locales all cascade from branches (0003/0005).
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
    `select count(*)::text as n from public.organizations where slug like 'hv3-org-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv3-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of [
    "branch_operating_hours",
    "branch_schedule_exceptions",
    "branch_scheduling_configuration",
    "service_scheduling_rules",
    "slot_holds",
    "service_categories",
    "services",
  ]) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations where slug like 'hv3-org-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const audits = await sql<{ n: string }>(
    `select count(*)::text as n from public.audit_logs
      where organization_id in (select id from public.organizations where slug like 'hv3-org-%')`,
  );
  checks.push(["audit_logs", Number(audits[0].n)]);
  const leftovers = checks.filter(([, n]) => n !== 0);
  expect(leftovers).toEqual([]); // names of any non-zero tables
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
  foreignSvc?: string;
  users: Record<string, string>;
  releasedHoldId?: string;
  sweptHoldId?: string;
  sessionCHoldId?: string;
} = { users: {} };

function branchInput(slugSuffix: string) {
  return {
    name: `HV3 Berlin ${RUN} ${slugSuffix}`,
    slug: `${PREFIX}${RUN}-${slugSuffix}`,
    country_code: "DE",
    timezone: "Europe/Berlin",
    currency: "EUR" as const,
    default_locale: "de" as const,
    enabled_locales: ["de", "en"] as ("de" | "en" | "fr" | "es")[],
  };
}

/** Explicit injected duration contract — 45 min, deliberately ≠ the 60-min placeholder. */
const fixed45: DurationProvider = {
  async getEstimatedDuration() {
    return 45;
  },
};

const DURATION_MS = 45 * 60_000;

/** Fixed evaluation instant: Tue 2027-06-01 09:00Z (11:00 Berlin, +02:00). */
const NOW = new Date("2027-06-01T09:00:00.000Z");

describe.skipIf(!HOSTED)("hosted verification: create-scheduling-availability", () => {
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
      console.log("hv3 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  }, 180_000);

  // -- 00) DATABASE: migration 0009 schema ---------------------------------

  it("00 DATABASE: migration 0009 applied — 5 tables, constraints, indexes, no duration/price fields, RLS without FORCE", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in
        ('branch_operating_hours','branch_schedule_exceptions',
         'branch_scheduling_configuration','service_scheduling_rules','slot_holds')`,
    );
    expect(tables).toHaveLength(5);

    const branchNullable = await sql<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema='public' and column_name='branch_id' and is_nullable='YES'
          and table_name in ('branch_operating_hours','branch_schedule_exceptions',
                             'branch_scheduling_configuration','service_scheduling_rules','slot_holds')`,
    );
    expect(branchNullable).toEqual([]); // branch_id NOT NULL everywhere (Q9)

    // S6: no duration or pricing authority in scheduling storage.
    const durationCols = await sql<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema='public' and table_name in
          ('branch_operating_hours','branch_schedule_exceptions',
           'branch_scheduling_configuration','service_scheduling_rules','slot_holds')
          and (column_name like '%duration%' or column_name like '%price%' or column_name like '%pricing%')`,
    );
    expect(durationCols).toEqual([]);

    // Constraints of record (CHECKs, composite same-branch FKs, natural keys).
    for (const constraint of [
      "ck_branch_hours_no_wrap", "ck_branch_hours_effective_range",
      "uq_branch_hours_interval_version",
      "ck_schedule_exception_range", "ck_schedule_exception_intervals_shape",
      "uq_scheduling_config_branch", "ck_config_notice_positive",
      "ck_config_advance_positive", "ck_config_grid_divides_hour",
      "ck_config_buffers_nonnegative", "ck_config_cap_positive",
      "ck_config_horizon_positive", "ck_config_hold_ttl_positive",
      "fk_service_rules_service_same_branch", "ck_service_rules_window_pair",
      "ck_service_rules_no_wrap", "uq_service_scheduling_rules",
      "fk_slot_holds_service_same_branch", "ck_slot_holds_interval",
      "ck_slot_holds_expiry",
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
        "idx_branch_hours_branch", "idx_branch_hours_effective",
        "idx_schedule_exceptions_branch", "idx_schedule_exceptions_dates",
        "idx_scheduling_config_branch",
        "idx_service_rules_branch", "idx_service_rules_service",
        "idx_slot_holds_branch_time", "idx_slot_holds_status_expiry",
        "idx_slot_holds_session", "idx_slot_holds_service",
        "uq_slot_holds_one_active_per_session", "uq_slot_holds_idempotency",
      ]],
    );
    expect(idx[0].n).toBe(13);

    const rls = await sql<{ relname: string; enabled: boolean; forced: boolean }>(
      `select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in
          ('branch_operating_hours','branch_schedule_exceptions',
           'branch_scheduling_configuration','service_scheduling_rules','slot_holds')
          and c.relkind = 'r'`,
    );
    expect(rls).toHaveLength(5);
    expect(rls.every((r) => r.enabled)).toBe(true);
    expect(rls.some((r) => r.forced)).toBe(false); // no FORCE RLS

    // Policies reuse the 0006 definer helpers (Change 1/2 pattern).
    for (const policy of [
      "branch_operating_hours_select", "branch_schedule_exceptions_select",
      "branch_scheduling_configuration_select", "service_scheduling_rules_select",
      "slot_holds_select",
    ]) {
      const row = await sql<{ n: string; qual: string }>(
        `select count(*)::int as n, max(pg_get_expr(polqual, polrelid)) as qual from pg_policy
          where polname = $1`,
        [policy],
      );
      expect(Number(row[0].n), policy).toBe(1);
      expect(row[0].qual).toContain("get_membership_role");
      expect(row[0].qual).toContain("has_branch_access");
    }
  }, 90_000);

  // -- 01) Fixtures: real hosted Auth users + provisioning -----------------

  it("01 FIXTURES: hosted orgs, real Auth users, memberships, provisioned branches, idempotent §86 seed", async () => {
    S.orgA = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV3 Org A ${RUN}`, `hv3-org-a-${RUN}`],
      )
    )[0].id;
    S.orgB = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV3 Org B ${RUN}`, `hv3-org-b-${RUN}`],
      )
    )[0].id;

    S.users.admin = await createHostedUser("admin");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_admin', 'active')`,
      [S.orgA, S.users.admin],
    );
    S.users.staff = await createHostedUser("staff");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_staff', 'active')`,
      [S.orgA, S.users.staff],
    );
    S.users.manager = await createHostedUser("manager");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'branch_manager', 'active')`,
      [S.orgA, S.users.manager],
    );
    S.users.cleaner = await createHostedUser("cleaner");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'cleaner', 'active')`,
      [S.orgA, S.users.cleaner],
    );
    S.users.foreignAdmin = await createHostedUser("foreign-admin");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'hq_admin', 'active')`,
      [S.orgB, S.users.foreignAdmin],
    );
    S.users.otherMgr = await createHostedUser("other-manager");
    await sql(
      `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, 'branch_manager', 'active')`,
      [S.orgB, S.users.otherMgr],
    );

    const ctx = await resolveActor(S.users.admin);
    const { branch } = await createAndProvision(ctx, branchInput("berlin"));
    S.branch1 = branch.id;
    const ctxB = await resolveActor(S.users.foreignAdmin);
    const { branch: otherBranch } = await createAndProvision(ctxB, {
      ...branchInput("munich"),
      name: `HV3 Munich ${RUN}`,
    });
    S.otherBranch = otherBranch.id;

    // Branch-scoped roles need explicit membership_branches rows (Change 1).
    await sql(
      `insert into public.membership_branches (membership_id, branch_id)
       select m.id, $2 from public.memberships m where m.user_id = $1`,
      [S.users.manager, S.branch1],
    );
    await sql(
      `insert into public.membership_branches (membership_id, branch_id)
       select m.id, $2 from public.memberships m where m.user_id = $1`,
      [S.users.otherMgr, S.otherBranch],
    );

    // §86 seed (task 11.1) — idempotent by natural keys.
    const r1 = await seedSchedulingDefaults(S.branch1);
    expect(r1.hoursRowsInserted).toBe(6); // S2b: Mon–Fri + Sat = 6 rows (Sun closed)
    expect(r1.configRowsInserted).toBe(1);
    const r2 = await seedSchedulingDefaults(S.branch1);
    expect(r2.hoursRowsInserted).toBe(0);
    expect(r2.configRowsInserted).toBe(0);

    // Placeholder guard: the version-controlled seed must carry the approved
    // S2b value (Sat 09:00–14:00) — a drift here means approved values changed.
    expect(DEFAULT_OPERATING_HOURS[6]).toEqual([{ start: "09:00", end: "14:00" }]);
    expect(DEFAULT_OPERATING_HOURS[0]).toBeUndefined(); // Sunday closed
  }, 180_000);

  // -- 02) Defaults: approved §86 configuration values ----------------------

  it("02 DEFAULTS: configuration carries the approved S1–S18 values exactly", async () => {
    const cfg = await sql<{
      minimum_notice_minutes: number;
      maximum_advance_days: number;
      slot_grid_minutes: number;
      operational_buffer_minutes: number;
      travel_buffer_minutes: number;
      concurrency_cap: number;
      customer_horizon_days: number;
      hold_ttl_minutes: number;
    }>(
      `select minimum_notice_minutes, maximum_advance_days, slot_grid_minutes,
              operational_buffer_minutes, travel_buffer_minutes, concurrency_cap,
              customer_horizon_days, hold_ttl_minutes
         from public.branch_scheduling_configuration where branch_id = $1`,
      [S.branch1],
    );
    expect(cfg[0]).toEqual({
      minimum_notice_minutes: 1440, // S4: 24 h
      maximum_advance_days: 90, // S5
      slot_grid_minutes: 15, // S3
      operational_buffer_minutes: 15, // S6b
      travel_buffer_minutes: 30, // S6b
      concurrency_cap: 3, // S7
      customer_horizon_days: 14, // S12
      hold_ttl_minutes: 15, // S1b
    });

    const hours = await sql<{ weekday: number; start_time: string; end_time: string }>(
      `select weekday, start_time::text, end_time::text
         from public.branch_operating_hours where branch_id = $1
        order by weekday, interval_index`,
      [S.branch1],
    );
    expect(hours).toHaveLength(6);
    expect(hours.filter((h) => h.weekday === 0)).toEqual([]); // Sun closed
    for (const wd of [1, 2, 3, 4, 5]) {
      expect(hours.find((h) => h.weekday === wd)).toEqual({
        weekday: wd, start_time: "08:00:00", end_time: "18:00:00",
      });
    }
    expect(hours.find((h) => h.weekday === 6)).toEqual({
      weekday: 6, start_time: "09:00:00", end_time: "14:00:00",
    });
  }, 60_000);

  // -- 03) Authorization: configuration ops (S17 — branches.view/edit) ------

  it("03 AUTHORIZATION: HQ edits configuration; staff/manager/cleaner/foreign denied; audit records actor", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    const staffCtx = await resolveActor(S.users.staff);
    const mgrCtx = await resolveActor(S.users.manager);
    const cleanerCtx = await resolveActor(S.users.cleaner);
    const foreignCtx = await resolveActor(S.users.foreignAdmin);

    await expect(getSchedulingConfig(adminCtx, S.branch1!)).resolves.toMatchObject({
      concurrency_cap: 3,
    });
    // branches.view extends to staff + branch managers (reads).
    await expect(getSchedulingConfig(staffCtx, S.branch1!)).resolves.toBeTruthy();
    await expect(getSchedulingConfig(mgrCtx, S.branch1!)).resolves.toBeTruthy();

    // branches.edit is HQ-only (S17): staff, manager, cleaner denied.
    await expect(
      updateSchedulingConfig(staffCtx, { branch_id: S.branch1!, concurrency_cap: 9 }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));
    await expect(
      updateSchedulingConfig(mgrCtx, { branch_id: S.branch1!, concurrency_cap: 9 }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));
    await expect(
      getSchedulingConfig(cleanerCtx, S.branch1!),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));
    // Cross-organization denied.
    await expect(
      updateSchedulingConfig(foreignCtx, { branch_id: S.branch1!, concurrency_cap: 9 }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));

    // HQ mutation succeeds and is audited with the acting user.
    const updated = await updateSchedulingConfig(adminCtx, {
      branch_id: S.branch1!,
      concurrency_cap: 3,
    });
    expect(updated.concurrency_cap).toBe(3);
    const audits = await auditRows(S.branch1!);
    const cfgAudit = audits.find((a) => a.action === "scheduling_config.updated");
    expect(cfgAudit).toBeTruthy();
    expect(cfgAudit!.actor_user_id).toBe(S.users.admin);
    expect(cfgAudit!.branch_id).toBe(S.branch1);
  }, 120_000);

  // -- 04) Operating hours: effective dating + historical immutability ------

  it("04 HOURS: effective-dated versions, immutability, back-dating rejected, authorization enforced", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    const mgrCtx = await resolveActor(S.users.manager);

    await expect(
      upsertOperatingHours(mgrCtx, {
        branch_id: S.branch1!, weekday: 6,
        intervals: [{ start: "10:00", end: "13:00" }], effective_from: "2027-07-01",
      }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));
    const mgrList = await listOperatingHours(mgrCtx, S.branch1!); // branches.view OK
    expect(mgrList.length).toBeGreaterThan(0);

    // New Saturday version: prior version closed, content immutable.
    const created = await upsertOperatingHours(adminCtx, {
      branch_id: S.branch1!, weekday: 6,
      intervals: [{ start: "10:00", end: "13:00" }], effective_from: "2027-07-01",
    });
    expect(created).toHaveLength(1);
    const versions = await sql<{ start_time: string; end_time: string; effective_from: string; effective_until: string | null }>(
      `select start_time::text, end_time::text, effective_from::text, effective_until::text
         from public.branch_operating_hours
        where branch_id = $1 and weekday = 6 order by effective_from`,
      [S.branch1],
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual({
      start_time: "09:00:00", end_time: "14:00:00",
      effective_from: "2026-01-01", effective_until: "2027-06-30",
    });
    expect(versions[1]).toEqual({
      start_time: "10:00:00", end_time: "13:00:00",
      effective_from: "2027-07-01", effective_until: null,
    });

    // History is immutable: back-dating a new version is rejected (CONFLICT).
    let conflict: unknown;
    try {
      await upsertOperatingHours(adminCtx, {
        branch_id: S.branch1!, weekday: 6,
        intervals: [{ start: "08:00", end: "09:00" }], effective_from: "2027-06-15",
      });
    } catch (e) {
      conflict = e;
    }
    expectAppError(conflict, "CONFLICT");

    // Sunday template (weekday 0) for the DST probes: 00:30–04:00 local from
    // 2028-01-01 (branch decision — per-branch configurability, S2).
    const sunday = await upsertOperatingHours(adminCtx, {
      branch_id: S.branch1!, weekday: 0,
      intervals: [{ start: "00:30", end: "04:00" }], effective_from: "2028-01-01",
    });
    expect(sunday).toHaveLength(1);
  }, 120_000);

  // -- 05) Schedule exceptions: typed model + template precedence (S9) ------

  it("05 EXCEPTIONS: typed creation audited; manager read allowed, write denied", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    const mgrCtx = await resolveActor(S.users.manager);

    await expect(
      createScheduleException(mgrCtx, {
        branch_id: S.branch1!, exception_type: "closed",
        start_date: "2027-06-02", end_date: "2027-06-02", reason: "hv3 closed day",
      }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));

    const exc = await createScheduleException(adminCtx, {
      branch_id: S.branch1!, exception_type: "closed",
      start_date: "2027-06-02", end_date: "2027-06-02", reason: "hv3 closed day",
    });
    expect(exc.exception_type).toBe("closed");

    const list = await listScheduleExceptions(mgrCtx, S.branch1!); // branches.view
    expect(list.some((e) => e.id === exc.id)).toBe(true);

    const audits = await auditRows(exc.id);
    expect(audits.map((a) => a.action)).toContain("schedule_exception.created");
  }, 120_000);

  // -- 06) Service scheduling rules: windows only, same-branch enforcement --

  it("06 SERVICE RULES: window rule created + audited; cross-branch service rejected; no duration/price data", async () => {
    S.cat = (
      await sql<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name, is_enabled, status)
         values ($1, $2, $3, 'HV3 Cat', true, 'active') returning id`,
        [S.orgA, S.branch1, `hv3-cat-${RUN}`],
      )
    )[0].id;
    S.svc = (
      await sql<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name, is_enabled, status)
         values ($1, $2, $3, $4, 'HV3 Svc', true, 'active') returning id`,
        [S.orgA, S.branch1, S.cat, `hv3-svc-${RUN}`],
      )
    )[0].id;
    // Foreign-branch service for the same-branch rejection probe.
    const foreignCat = (
      await sql<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name, is_enabled, status)
         values ($1, $2, $3, 'HV3 Foreign Cat', true, 'active') returning id`,
        [S.orgB, S.otherBranch, `hv3-fcat-${RUN}`],
      )
    )[0].id;
    S.foreignSvc = (
      await sql<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name, is_enabled, status)
         values ($1, $2, $3, $4, 'HV3 Foreign Svc', true, 'active') returning id`,
        [S.orgB, S.otherBranch, foreignCat, `hv3-fsvc-${RUN}`],
      )
    )[0].id;

    const adminCtx = await resolveActor(S.users.admin);
    const mgrCtx = await resolveActor(S.users.manager);

    // Wednesday window 09:00–12:00 local (weekday 3) — overrides the branch
    // template on Wednesdays only.
    const rule = await upsertServiceSchedulingRule(adminCtx, {
      branch_id: S.branch1!, service_id: S.svc!, weekday: 3,
      start_time: "09:00", end_time: "12:00",
    });
    expect(rule.weekday).toBe(3);
    const audits = await auditRows(rule.id);
    expect(audits.map((a) => a.action)).toContain("service_scheduling_rule.updated");

    await expect(
      upsertServiceSchedulingRule(mgrCtx, {
        branch_id: S.branch1!, service_id: S.svc!, weekday: 3,
        start_time: "09:00", end_time: "12:00",
      }),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));

    // Cross-branch service: NOT_FOUND (same-branch FK + domain guard).
    let err: unknown;
    try {
      await upsertServiceSchedulingRule(adminCtx, {
        branch_id: S.branch1!, service_id: S.foreignSvc!, weekday: 3,
        start_time: "09:00", end_time: "12:00",
      });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "NOT_FOUND");

    // No duration/price ever persisted on the rule (S6).
    const ruleCols = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='service_scheduling_rules'
          and (column_name like '%duration%' or column_name like '%price%')`,
    );
    expect(ruleCols).toEqual([]);
  }, 120_000);

  // -- 07) Availability engine: determinism, exceptions, rules, cap, DST ----

  it("07 AVAILABILITY: closed-day exception, service window, 45-min injected duration, notice, cap=3, DST transitions", async () => {
    const slots = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: NOW },
      fixed45,
    );
    expect(slots.length).toBeGreaterThan(0);

    // Closed-day exception removed 2027-06-02 entirely (S9 precedence).
    const closedDay = slots.filter(
      (s) => s.start >= "2027-06-02T00:00:00.000Z" && s.start < "2027-06-03T00:00:00.000Z",
    );
    expect(closedDay).toEqual([]);

    // Wednesday 2027-06-09 obeys the service rule 09:00–12:00 Berlin (+02:00)
    // → absolute starts within [07:00Z, 10:00Z).
    const wed = slots.filter(
      (s) => s.start >= "2027-06-09T00:00:00.000Z" && s.start < "2027-06-10T00:00:00.000Z",
    );
    expect(wed.length).toBeGreaterThan(0);
    for (const s of wed) {
      expect(s.start >= "2027-06-09T07:00:00.000Z").toBe(true);
      expect(s.start < "2027-06-09T10:00:00.000Z").toBe(true);
    }

    // Duration comes from the INJECTED contract (45 min, 15-min grid) — never
    // the 60-minute placeholder.
    const firstThree = wed.slice(0, 3);
    for (const s of firstThree) {
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(DURATION_MS);
    }
    expect(
      new Date(firstThree[1].start).getTime() - new Date(firstThree[0].start).getTime(),
    ).toBe(15 * 60_000);

    // Customer-safe shape only (§25) + branch timezone surfaced.
    expect(wed[0]).toEqual({
      start: wed[0].start, end: wed[0].end, timezone: "Europe/Berlin", available: true,
    });

    // Minimum notice = 24 h (S4): nothing before the evaluation instant + 24 h.
    expect(slots.every((s) => s.start >= "2027-06-01T09:00:00.000Z")).toBe(true);

    // Determinism: identical inputs ⇒ identical slot list.
    const slotsAgain = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: NOW },
      fixed45,
    );
    expect(slotsAgain).toEqual(slots);

    // Capacity cap = 3 (S7): three distinct sessions hold 10:00 Berlin
    // (08:00Z); the fourth concurrent hold is rejected; releasing one frees it.
    const capSlot = wed.find((s) => s.start === "2027-06-09T08:00:00.000Z")!;
    expect(capSlot).toBeTruthy();
    const capSessions = ["hv3-cap-a", "hv3-cap-b", "hv3-cap-c"].map(
      (n) => `${n}-${RUN}`,
    );
    const capHolds: Awaited<ReturnType<typeof createSlotHold>>[] = [];
    for (let i = 0; i < 3; i++) {
      capHolds.push(
        await createSlotHold(
          await resolveActor(S.users.admin),
          {
            branch_id: S.branch1!, service_id: S.svc!,
            start_time: capSlot.start, end_time: capSlot.end,
            session_id: capSessions[i], idempotency_key: `${capSessions[i]}-idem`,
          },
          fixed45,
          NOW,
        ),
      );
      expect(capHolds[i].status).toBe("held");
    }
    let capErr: unknown;
    try {
      await createSlotHold(
        await resolveActor(S.users.admin),
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: capSlot.start, end_time: capSlot.end,
          session_id: `hv3-cap-d-${RUN}`, idempotency_key: `hv3-cap-d-${RUN}-idem`,
        },
        fixed45,
        NOW,
      );
    } catch (e) {
      capErr = e;
    }
    expectAppError(capErr, "CONFLICT");
    await releaseSlotHold(await resolveActor(S.users.admin), {
      hold_id: capHolds[0].id, session_id: capSessions[0],
    });
    const freed = await createSlotHold(
      await resolveActor(S.users.admin),
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: capSlot.start, end_time: capSlot.end,
        session_id: `hv3-cap-d-${RUN}`, idempotency_key: `hv3-cap-d-${RUN}-idem`,
      },
      fixed45,
      NOW,
    );
    expect(freed.status).toBe("held");
    await releaseSlotHold(await resolveActor(S.users.admin), {
      hold_id: freed.id, session_id: `hv3-cap-d-${RUN}`,
    });
    for (let i = 1; i < 3; i++) {
      await releaseSlotHold(await resolveActor(S.users.admin), {
        hold_id: capHolds[i].id, session_id: capSessions[i],
      });
    }

    // DST spring-forward (S14): 2028-03-26, Europe/Berlin. The local
    // 02:00–02:59 range maps to NO absolute instant: candidate starts exist
    // at 01:45 CET and resume at 03:00 CEST — the 02:xx local times are
    // deterministically ABSENT. Evaluation instant within the S12 horizon.
    const spring = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: new Date("2028-03-20T09:00:00.000Z") },
      fixed45,
    );
    const springFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const springLocal = spring
      .filter((s) => s.start >= "2028-03-26T00:00:00.000Z" && s.start < "2028-03-27T00:00:00.000Z")
      .map((s) => springFmt.format(new Date(s.start)));
    expect(springLocal.some((t) => t >= "02:00" && t < "03:00")).toBe(false);
    expect(springLocal).toContain("01:45"); // last CET candidate
    expect(springLocal).toContain("03:00"); // first CEST candidate

    // DST fall-back (S14): 2028-10-29. 02:00–03:00 local repeats; the window
    // boundary materializes to the FIRST occurrence, so BOTH absolute passes
    // of 02:xx local generate slots (deterministic, real PostgreSQL/ICU).
    const fall = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: new Date("2028-10-23T09:00:00.000Z") },
      fixed45,
    );
    expect(fall.some((s) => s.start === "2028-10-29T00:00:00.000Z")).toBe(true);
    expect(fall.some((s) => s.start === "2028-10-29T01:00:00.000Z")).toBe(true);
    const fallWindow = fall.filter(
      (s) => s.start >= "2028-10-28T23:30:00.000Z" && s.start < "2028-10-29T03:00:00.000Z",
    );
    expect(fallWindow.length).toBeGreaterThan(0);
    const fallFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const fallLocal = fallWindow.map((s) => fallFmt.format(new Date(s.start)));
    // 02:00–02:45 appears TWICE (CEST pass + CET pass = first-occurrence
    // boundary); absolute starts remain unique.
    expect(fallLocal.filter((t) => t >= "02:00" && t < "03:00")).toHaveLength(8);
  }, 240_000);

  // -- 08) Slot holds: S1 lifecycle, TTL, session uniqueness, idempotency ---

  it("08 HOLDS: TTL 15 min, one active per session, idempotent replay, release, terminal consumption, sweep, authorization", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    const cleanerCtx = await resolveActor(S.users.cleaner);
    const foreignCtx = await resolveActor(S.users.foreignAdmin);

    // Cleaner lacks branch scope; foreign admin lacks org scope.
    await expect(
      createSlotHold(
        cleanerCtx,
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: "2027-06-09T07:00:00.000Z", end_time: "2027-06-09T07:45:00.000Z",
          session_id: `hv3-sess-cl-${RUN}`, idempotency_key: `hv3-idem-cl-${RUN}`,
        },
        fixed45,
        NOW,
      ),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));
    await expect(
      createSlotHold(
        foreignCtx,
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: "2027-06-09T07:00:00.000Z", end_time: "2027-06-09T07:45:00.000Z",
          session_id: `hv3-sess-fx-${RUN}`, idempotency_key: `hv3-idem-fx-${RUN}`,
        },
        fixed45,
        NOW,
      ),
    ).rejects.toSatisfy(rejectsWithCode("FORBIDDEN"));

    // Unavailable slot (closed-day exception) → authoritative gate rejects.
    await expect(
      createSlotHold(
        adminCtx,
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: "2027-06-02T07:00:00.000Z", end_time: "2027-06-02T07:45:00.000Z",
          session_id: `hv3-sess-x-${RUN}`, idempotency_key: `hv3-idem-x-${RUN}`,
        },
        fixed45,
        NOW,
      ),
    ).rejects.toSatisfy(rejectsWithCode("CONFLICT"));

    // Create + TTL (S1b: 15 min, DB-clock anchored).
    const sessA = `hv3-sess-a-${RUN}`;
    const hold = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T08:00:00.000Z", end_time: "2027-06-09T08:45:00.000Z",
        session_id: sessA, idempotency_key: `hv3-idem-a-${RUN}`,
      },
      fixed45,
      NOW,
    );
    expect(hold.status).toBe("held");
    const ttlMinutes =
      (new Date(hold.expires_at).getTime() - new Date(hold.created_at).getTime()) / 60_000;
    expect(Math.abs(ttlMinutes - 15)).toBeLessThan(2);

    // Idempotent replay returns the SAME hold.
    const replay = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T08:00:00.000Z", end_time: "2027-06-09T08:45:00.000Z",
        session_id: sessA, idempotency_key: `hv3-idem-a-${RUN}`,
      },
      fixed45,
      NOW,
    );
    expect(replay.id).toBe(hold.id);

    // A held hold consumes concurrency capacity (S1): with the cap
    // temporarily set to 1 (per-branch configurability), the held slot is no
    // longer offered as available.
    await updateSchedulingConfig(adminCtx, { branch_id: S.branch1!, concurrency_cap: 1 });
    const blocked = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: NOW },
      fixed45,
    );
    expect(blocked.find((s) => s.start === "2027-06-09T08:00:00.000Z")?.available).toBe(false);
    await updateSchedulingConfig(adminCtx, { branch_id: S.branch1!, concurrency_cap: 3 });

    // One ACTIVE hold per session: a second active hold for session A is denied.
    let secondErr: unknown;
    try {
      await createSlotHold(
        adminCtx,
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: "2027-06-09T08:45:00.000Z", end_time: "2027-06-09T09:30:00.000Z",
          session_id: sessA, idempotency_key: `hv3-idem-a2-${RUN}`,
        },
        fixed45,
        NOW,
      );
    } catch (e) {
      secondErr = e;
    }
    expectAppError(secondErr, "CONFLICT");

    // A different session may hold a different slot.
    const sessC = `hv3-sess-c-${RUN}`;
    const holdC = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T08:45:00.000Z", end_time: "2027-06-09T09:30:00.000Z",
        session_id: sessC, idempotency_key: `hv3-idem-c-${RUN}`,
      },
      fixed45,
      NOW,
    );
    S.sessionCHoldId = holdC.id;

    // Release; re-release is NOT_FOUND; released holds never block again.
    await releaseSlotHold(adminCtx, { hold_id: hold.id, session_id: sessA });
    S.releasedHoldId = hold.id;
    let reRelease: unknown;
    try {
      await releaseSlotHold(adminCtx, { hold_id: hold.id, session_id: sessA });
    } catch (e) {
      reRelease = e;
    }
    expectAppError(reRelease, "NOT_FOUND");
    const afterRelease = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: NOW },
      fixed45,
    );
    expect(afterRelease.find((s) => s.start === "2027-06-09T08:00:00.000Z")?.available).toBe(true);

    // Consumption is terminal (S16 stage 5): simulate the booking change's
    // transactional consume in a COMMITTED transaction (the stage-5 pattern),
    // then prove a second consume fails.
    const bookingId = randomUUID();
    {
      const client = await pool!.connect();
      try {
        await client.query("begin");
        const consumed = await consumeHoldInTx(
          client as unknown as TransactionClient,
          { hold_id: holdC.id, session_id: sessC, booking_id: bookingId },
        );
        expect(consumed.status).toBe("consumed");
        await client.query("commit");
      } finally {
        client.release();
      }
    }
    {
      const client = await pool!.connect();
      try {
        await client.query("begin");
        let err: unknown;
        try {
          await consumeHoldInTx(
            client as unknown as TransactionClient,
            { hold_id: holdC.id, session_id: sessC, booking_id: randomUUID() },
          );
        } catch (e) {
          err = e;
        }
        expectAppError(err, "CONFLICT");
        await client.query("rollback");
      } finally {
        client.release();
      }
    }
    // Persisted state reflects the atomic consumption.
    const consumedRow = await sql<{ status: string; consumed_by_booking: string | null }>(
      `select status, consumed_by_booking::text from public.slot_holds where id = $1`,
      [holdC.id],
    );
    expect(consumedRow[0]).toEqual({ status: "consumed", consumed_by_booking: bookingId });

    // TTL expiry + sweep (task 8.1): backdate a hold's clock columns (keeping
    // ck_slot_holds_expiry true), sweep, capacity is freed, event audited.
    const sessD = `hv3-sess-d-${RUN}`;
    const holdD = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T09:00:00.000Z", end_time: "2027-06-09T09:45:00.000Z",
        session_id: sessD, idempotency_key: `hv3-idem-d-${RUN}`,
      },
      fixed45,
      NOW,
    );
    await sql(
      `update public.slot_holds
          set created_at = created_at - interval '20 minutes',
              expires_at = expires_at - interval '20 minutes'
        where id = $1`,
      [holdD.id],
    );

    // Read-time expiry (task 8.2): the hold row is still 'held' but past TTL.
    // Replaying its idempotency key hits the read-time expiry branch →
    // stable CONFLICT (never resurrects); the engine's expires_at filter has
    // ALREADY freed capacity before any sweep runs.
    let expiredErr: unknown;
    try {
      await createSlotHold(
        adminCtx,
        {
          branch_id: S.branch1!, service_id: S.svc!,
          start_time: "2027-06-09T09:00:00.000Z", end_time: "2027-06-09T09:45:00.000Z",
          session_id: sessD, idempotency_key: `hv3-idem-d-${RUN}`,
        },
        fixed45,
        NOW,
      );
    } catch (e) {
      expiredErr = e;
    }
    expectAppError(expiredErr, "CONFLICT");
    const freedEarly = await getAvailability(
      { branchId: S.branch1!, serviceId: S.svc!, days: 10, now: NOW },
      fixed45,
    );
    expect(freedEarly.find((s) => s.start === "2027-06-09T09:00:00.000Z")?.available).toBe(true);

    // Periodic sweep transitions the stale row to 'expired' (state truth).
    const swept = await sweepExpiredHolds(adminCtx, S.branch1!);
    expect(swept).toBeGreaterThanOrEqual(1);
    S.sweptHoldId = holdD.id;
    const sweptRow = await sql<{ status: string }>(
      `select status from public.slot_holds where id = $1`,
      [holdD.id],
    );
    expect(sweptRow[0].status).toBe("expired");

    // Idempotent replay of a TERMINAL hold returns the same row unchanged
    // (same key + interval ⇒ same hold, whatever its state).
    const terminal = await createSlotHold(
      adminCtx,
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T09:00:00.000Z", end_time: "2027-06-09T09:45:00.000Z",
        session_id: sessD, idempotency_key: `hv3-idem-d-${RUN}`,
      },
      fixed45,
      NOW,
    );
    expect(terminal.id).toBe(holdD.id);
    expect(terminal.status).toBe("expired");
  }, 240_000);

  // -- 09) Booking-boundary primitive (S16 stage 3 / S15) -------------------

  it("09 FEASIBILITY: authoritative re-check, own-hold hand-off, stale/foreign sessions rejected", async () => {
    // A free slot on the service-rule window is feasible (deterministic now).
    const ok = await validateSlotFeasibility(
      {
        branchId: S.branch1!, serviceId: S.svc!,
        start: "2027-06-09T07:00:00.000Z", end: "2027-06-09T07:45:00.000Z",
        now: NOW,
      },
      fixed45,
    );
    expect(ok.feasible).toBe(true);

    // Off-grid / wrong-length start (end ≠ start+45min) is rejected.
    let staleErr: unknown;
    try {
      await validateSlotFeasibility(
        {
          branchId: S.branch1!, serviceId: S.svc!,
          start: "2027-06-09T09:30:00.000Z", end: "2027-06-09T10:00:00.000Z",
          now: NOW,
        },
        fixed45,
      );
    } catch (e) {
      staleErr = e;
    }
    expectAppError(staleErr, "CONFLICT");

    // Session C's hold occupies 08:45Z but consumes only 1 of 3 concurrency
    // slots (S7): without presenting a hold, the interval is still feasible.
    const underCap = await validateSlotFeasibility(
      {
        branchId: S.branch1!, serviceId: S.svc!,
        start: "2027-06-09T08:45:00.000Z", end: "2027-06-09T09:30:00.000Z",
        now: NOW,
      },
      fixed45,
    );
    expect(underCap.feasible).toBe(true);

    // A hold created NOW for session E occupies the 08:45Z interval and is
    // the stage-4→5 hand-off fixture (session C's hold was consumed in 08).
    const sessE = `hv3-sess-e-${RUN}`;
    const ownHold = await createSlotHold(
      await resolveActor(S.users.admin),
      {
        branch_id: S.branch1!, service_id: S.svc!,
        start_time: "2027-06-09T08:45:00.000Z", end_time: "2027-06-09T09:30:00.000Z",
        session_id: sessE, idempotency_key: `hv3-idem-e-${RUN}`,
      },
      fixed45,
      NOW,
    );
    expect(ownHold.status).toBe("held");

    // Presenting a FOREIGN hold reference (valid hold, wrong session) is
    // rejected as stale.
    await expect(
      validateSlotFeasibility(
        {
          branchId: S.branch1!, serviceId: S.svc!,
          start: "2027-06-09T08:45:00.000Z", end: "2027-06-09T09:30:00.000Z",
          holdId: ownHold.id, sessionId: `hv3-sess-other-${RUN}`,
          now: NOW,
        },
        fixed45,
      ),
    ).rejects.toSatisfy(rejectsWithCode("CONFLICT"));

    // Session E presenting ITS OWN valid hold satisfies the stage-4→5 hand-off.
    const own = await validateSlotFeasibility(
      {
        branchId: S.branch1!, serviceId: S.svc!,
        start: "2027-06-09T08:45:00.000Z", end: "2027-06-09T09:30:00.000Z",
        holdId: ownHold.id, sessionId: sessE,
        now: NOW,
      },
      fixed45,
    );
    expect(own.feasible).toBe(true);
    await releaseSlotHold(await resolveActor(S.users.admin), {
      hold_id: ownHold.id, session_id: sessE,
    });
  }, 120_000);

  // -- 10) Audit: fail-closed transactional behavior -------------------------

  it("10 AUDIT: fail-closed — a failing audit write aborts the hold mutation; lifecycle events paired", async () => {
    // Replays the domain's transactional pattern on slot_holds: state change +
    // audit insert in ONE transaction; the audit write violates
    // ck_audit_action_format → the whole transaction aborts.
    const before = await sql<{ n: string }>(
      `select count(*)::text as n from public.slot_holds where session_id like 'hv3-%'`,
    );
    const badAction = "hv3-fail-closed-probe"; // violates ck_audit_action_format
    await withOwnerTx(async (client) => {
      await client.query(
        `insert into public.slot_holds (
           organization_id, branch_id, service_id, start_time, end_time,
           session_id, idempotency_key, expires_at)
         values ($1, $2, $3, '2027-06-09T10:00:00Z', '2027-06-09T10:45:00Z',
                 $4, $5, '2027-06-09T10:15:00Z')`,
        [S.orgA, S.branch1, S.svc, `hv3-fc-sess-${RUN}`, `hv3-fc-idem-${RUN}`],
      );
      await client.query("savepoint hv3_failclosed");
      try {
        await client.query(
          `insert into public.audit_logs (
             organization_id, branch_id, actor_user_id, actor_type, action,
             resource_type, resource_id, result, metadata
           ) values ($1, $2, $3, 'user', $4, 'slot_holds', $5, 'success', '{}'::jsonb)`,
          [S.orgA, S.branch1, S.users.admin, badAction, S.svc],
        );
        await client.query("release savepoint hv3_failclosed");
        throw new Error("hv3-unexpected: audit insert should have failed");
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.startsWith("hv3-unexpected")) throw e;
        expect(msg + JSON.stringify((e as { detail?: unknown }).detail)).toMatch(
          /ck_audit_action_format|violates check constraint/i,
        );
        await client.query("rollback to savepoint hv3_failclosed");
      }
      // Propagate the abort: the state change must not commit without audit.
      throw new Error("hv3-expected-rollback");
    }).catch((e: unknown) => {
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("hv3-unexpected")) throw e;
      expect(msg).toBe("hv3-expected-rollback");
    });

    const after = await sql<{ n: string }>(
      `select count(*)::text as n from public.slot_holds where session_id like 'hv3-%'`,
    );
    expect(Number(after[0].n)).toBe(Number(before[0].n)); // nothing committed
    const orphan = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs where action = $1`,
      [badAction],
    );
    expect(Number(orphan[0].n)).toBe(0);

    // Lifecycle pairing: released and swept holds carry their full event sets.
    const released = await auditRows(S.releasedHoldId!);
    expect(released.map((a) => a.action)).toEqual(["slot.held", "slot.released"]);
    const swept = await auditRows(S.sweptHoldId!);
    expect(swept.map((a) => a.action)).toEqual(["slot.held", "slot.expired"]);
    expect(swept[1].metadata.reason).toBe("sweep");

    // Consumption event recorded for the consumed hold.
    const consumed = await auditRows(S.sessionCHoldId!);
    expect(consumed.map((a) => a.action)).toContain("slot.consumed");
  }, 120_000);

  // -- 11) RLS: real-role isolation + write denial --------------------------

  it("11 RLS: org/branch isolation and write denial as the real authenticated role; owner writes still work", async () => {
    // Known-ID probe: admin sees the consumed hold; foreign admin does not.
    const visible = await withRlsUser(S.users.admin, (client) =>
      client.query(`select id from public.slot_holds where id = $1`, [S.sessionCHoldId]),
    );
    expect(visible.rowCount).toBe(1);
    const invisible = await withRlsUser(S.users.foreignAdmin, (client) =>
      client.query(`select id from public.slot_holds where id = $1`, [S.sessionCHoldId]),
    );
    expect(invisible.rowCount).toBe(0);

    // Cross-organization invisibility across all five tables.
    for (const [table, fk] of [
      ["branch_operating_hours", "branch_id"],
      ["branch_schedule_exceptions", "branch_id"],
      ["branch_scheduling_configuration", "branch_id"],
      ["service_scheduling_rules", "branch_id"],
      ["slot_holds", "branch_id"],
    ] as const) {
      const rows = await withRlsUser(S.users.foreignAdmin, (client) =>
        client.query(
          `select t.id from public.${table} t join public.branches b on b.id = t.${fk}
            where b.organization_id = $1 limit 1`,
          [S.orgA],
        ),
      );
      expect(rows.rowCount, table).toBe(0);
    }

    // Role visibility on configuration: admin, staff, and branch-scoped
    // manager read; cleaner (no membership_branches) does not.
    for (const [user, seen] of [
      [S.users.admin, 1], [S.users.staff, 1], [S.users.manager, 1], [S.users.cleaner, 0],
    ] as const) {
      const rows = await withRlsUser(user, (client) =>
        client.query(
          `select branch_id from public.branch_scheduling_configuration where branch_id = $1`,
          [S.branch1],
        ),
      );
      expect(rows.rowCount).toBe(seen);
    }

    // Write denial: the SELECT-only policy refuses every mutation for
    // authenticated roles (domain mutations flow through the privileged
    // definer-authorized service layer, not direct table writes).
    const writeProbes: [string, string, unknown[]][] = [
      [
        "branch_scheduling_configuration",
        `update public.branch_scheduling_configuration set updated_at = updated_at where branch_id = $1`,
        [S.branch1],
      ],
      [
        "branch_schedule_exceptions",
        `delete from public.branch_schedule_exceptions where branch_id = $1`,
        [S.branch1],
      ],
      [
        "service_scheduling_rules",
        `update public.service_scheduling_rules set end_time = '12:30' where branch_id = $1`,
        [S.branch1],
      ],
      [
        "slot_holds",
        `update public.slot_holds set status = 'released' where branch_id = $1`,
        [S.branch1],
      ],
    ];
    for (const [table, text, params] of writeProbes) {
      const res = await withRlsUser(S.users.staff, (client) =>
        client.query(text, params as never[]),
      );
      expect(res.rowCount ?? 0, `write denied on ${table}`).toBe(0);
    }

    // Owner path still mutates (no FORCE RLS — owner exemption preserved).
    await withOwnerTx(async (client) => {
      const res = await client.query(
        `update public.branch_scheduling_configuration set updated_at = updated_at
          where branch_id = $1`,
        [S.branch1],
      );
      expect(res.rowCount).toBe(1);
    });

    // INSERT denial (branch_operating_hours): with no INSERT policy,
    // PostgreSQL raises an RLS violation — a hard error rather than a silent
    // 0-row effect. The violation itself is the denial of record.
    let insertErr: unknown;
    try {
      await withRlsUser(S.users.staff, (client) =>
        client.query(
          `insert into public.branch_operating_hours
             (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
           values ($1, $2, 5, 9, '09:00', '17:00', '2030-01-01')`,
          [S.orgA, S.branch1] as never[],
        ),
      );
    } catch (e) {
      insertErr = e;
    }
    expect((insertErr as Error)?.message ?? "").toMatch(/row-level security policy/i);
  }, 180_000);
});
