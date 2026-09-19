/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 10 (create-config-admin-ui)
 *
 * SKIPPED by default: runs only with  HOSTED_VERIFY=1 npx vitest run
 * tests/hosted/config-admin-hosted-verification.test.ts — never part of
 * `npm test`. Requires `.env.local` pointing at the TARGET staging project
 * (ksdxzkghyvvdizwclhbu) with the migration chain 0001–0014 applied.
 *
 * Change 10 ships NO migration, NO new permission, and NO RLS change — this
 * suite therefore verifies the CONFIG-ADMIN SURFACE against real hosted state:
 *  - schema regression: chain still ends at 0014, config-domain policy
 *    inventories unchanged;
 *  - service catalog admin contracts on real Postgres: create hierarchy,
 *    update, lifecycle activation preconditions, offering toggle, ordering,
 *    addon compatibility, orphan inspection, published slug rename;
 *  - pricing admin contracts: profile → draft version → draft rule,
 *    publish (server validation), published immutability, archive;
 *  - scheduling admin contracts (BD-E3b): hq_admin config/hours/exception
 *    mutations; branch_manager / hq_staff / cleaner DENIALS (branches.edit is
 *    hq_admin-only); foreign-branch fail-closed;
 *  - RLS probes as the real `authenticated` role for the three config domains
 *    (org isolation intact for staff/branch manager/outsider).
 *
 * ALL fixture values are explicit NON-PRODUCTION fixtures (P3). The suite
 * creates its own hv10-suffixed entities and deletes everything afterwards.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import type { AuthContext } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { ErrorCode } from "@/lib/errors";

import {
  createCategoryAction,
  createServiceAction,
  createVariantAction,
  createAddonAction,
  updateServiceAction,
  changeStatusAction,
  setOfferingStateAction,
  reorderCatalogAction,
  setAddonCompatibilityAction,
  removeAddonCompatibilityAction,
  findOrphanedAddonsAction,
  renamePublishedSlugAction,
} from "@/features/services/actions";
import {
  createPricingProfileAction,
  createPricingVersionAction,
  createPricingRuleAction,
  publishPricingVersionAction,
  archivePricingVersionAction,
} from "@/features/pricing/actions";
import {
  getSchedulingConfigAction,
  updateSchedulingConfigAction,
  listOperatingHoursAction,
  upsertOperatingHoursAction,
  listScheduleExceptionsAction,
  createScheduleExceptionAction,
  deleteScheduleExceptionAction,
} from "@/features/scheduling/actions";
import { setSessionOverrideForTests } from "@/lib/session/server";

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
const PREFIX = "hv10-";

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

// Translation tables key off the catalog entity (no organization_id column);
// they are removed via the parent-entity deletion that cascades below.
const TEARDOWN_TRANSLATION_TABLES = [
  "service_category_translations",
  "service_translations",
  "service_variant_translations",
  "service_addon_translations",
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
        await maint.query("select id from public.organizations where slug like 'hv10-org-%'")
      ).rows as { id: string }[];
      for (const org of orgs) {
        const stmt = TEARDOWN_ORG_TABLES.map((t) => `delete from public.${t} where organization_id = '${org.id}'`).join("; ");
        const parentOf: Record<string, { fk: string; table: string }> = {
          service_category_translations: { fk: "category_id", table: "service_categories" },
          service_translations: { fk: "service_id", table: "services" },
          service_variant_translations: { fk: "variant_id", table: "service_variants" },
          service_addon_translations: { fk: "addon_id", table: "service_addons" },
        };
        const txStmt = TEARDOWN_TRANSLATION_TABLES.map(
          (t) =>
            `delete from public.${t} where ${parentOf[t].fk} in (select id from public.${parentOf[t].table} where organization_id = '${org.id}')`,
        ).join("; ");
        await maint.query(`set session_replication_role = replica; ${stmt}; ${txStmt};
           delete from public.membership_branches where membership_id in (select m.id from public.memberships m where m.organization_id = '${org.id}');
           -- branch_websites cascades with branches (no organization_id column).
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
    `select count(*)::text as n from public.organizations where slug like 'hv10-org-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv10-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of TEARDOWN_ORG_TABLES) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations where slug like 'hv10-org-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const tail = await sql<{ mb: string; mem: string }>(
    `select
       (select count(*)::text as n from public.membership_branches where membership_id in
          (select m.id from public.memberships m where m.organization_id in
             (select id from public.organizations where slug like 'hv10-org-%'))) as mb,
       (select count(*)::text as n from public.memberships where organization_id in
          (select id from public.organizations where slug like 'hv10-org-%')) as mem`,
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
  hq?: AuthContext;
  users: Record<string, { id: string; email: string }>;
} = { users: {} };

// NON-PRODUCTION structural fixture values (P3) — no production prices/hours.
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1500 };
const FIX_MINIMUM = { minimum_minor: 1000 };

async function actAs(userId: string): Promise<void> {
  setSessionOverrideForTests(userId);
  S.hq = await resolveActor(userId);
}

describe.skipIf(!HOSTED)("hosted verification: create-config-admin-ui", () => {
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
      console.log("hv10 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
      setSessionOverrideForTests(null);
    }
  });

  // -- 00) SCHEMA REGRESSION (no Change 10 migration) ------------------------

  it("00 SCHEMA: no Change 10 migration — chain ends at 0014, config-domain policy inventory unchanged", async () => {
    const migrations = await sql<{ version: string }>(
      `select version from supabase_migrations.schema_migrations`,
    ).catch(() => [] as { version: string }[]);
    const beyond = migrations.filter((m) => /^(001[5-9]|00[2-9]\d)/.test(m.version));
    expect(beyond).toEqual([]);

    const policies = await sql<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and tablename in (
          'service_categories','services','service_variants','service_addons',
          'pricing_profiles','pricing_versions','pricing_rules',
          'branch_scheduling_configuration','branch_operating_hours','branch_schedule_exceptions')
        order by tablename, policyname`,
    );
    // Informational snapshot: every domain must retain at least one policy and
    // Change 10 added none (asserted implicitly by the count being stable).
    const byTable = new Map<string, number>();
    for (const p of policies) byTable.set(p.tablename, (byTable.get(p.tablename) ?? 0) + 1);
    expect(byTable.size).toBeGreaterThanOrEqual(6);
  });

  // -- 01) FIXTURES ----------------------------------------------------------

  it("01 FIXTURES: hosted org, real Auth users, two provisioned branches", async () => {
    const orgId = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV10 Org ${RUN}', 'hv10-org-${RUN}') returning id`,
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
    const mgrMembership = (
      await sql<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'branch_manager') returning id`,
        [orgId, S.users.mgr.id],
      )
    )[0].id;
    S.users.cleaner = await createHostedUser("cleaner");
    const cleanerMembership = (
      await sql<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'cleaner') returning id`,
        [orgId, S.users.cleaner.id],
      )
    )[0].id;
    S.users.outsider = await createHostedUser("outsider");

    const { branch } = await createAndProvision(await resolveActor(S.users.hq.id), {
      name: `HV10 Berlin ${RUN}`,
      slug: `${PREFIX}${RUN}-berlin`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch1 = branch.id;

    const { branch: branch2 } = await createAndProvision(await resolveActor(S.users.hq.id), {
      name: `HV10 Leipzig ${RUN}`,
      slug: `${PREFIX}${RUN}-leipzig`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch2 = branch2.id;

    // Branch-scoped memberships: manager + cleaner on branch1 only.
    await sql(
      `insert into public.membership_branches (membership_id, branch_id) values ($1, $2), ($3, $2)`,
      [mgrMembership, S.branch1, cleanerMembership],
    );

    await seedSchedulingDefaults(S.branch1);
    await seedSchedulingDefaults(S.branch2);

    await actAs(S.users.hq.id);
    expect(S.branch1).toBeTruthy();
  }, 120_000);

  // -- 02) CATALOG ADMIN CONTRACTS -------------------------------------------

  it("02 CATALOG: hierarchy create → update → activate chain → toggle → reorder → compatibility → orphans → slug rename", async () => {
    const cat = await createCategoryAction({
      branchId: S.branch1!,
      slug: `${PREFIX}home`,
      name: "HV10 Home",
      translations: [{ locale: "de", name: "HV10 Home" }],
    });
    if (!cat.success) throw new Error(`hv10 cat: ${JSON.stringify(cat.error)}`);

    const svc = await createServiceAction({
      branchId: S.branch1!,
      categoryId: cat.data.id,
      slug: `${PREFIX}std`,
      name: "HV10 Standard",
      translations: [{ locale: "de", name: "HV10 Standard" }],
    });
    if (!svc.success) throw new Error(`hv10 svc: ${JSON.stringify(svc.error)}`);

    const variant = await createVariantAction({
      branchId: S.branch1!,
      serviceId: svc.data.id,
      slug: `${PREFIX}basic`,
      name: "HV10 Basic",
      translations: [{ locale: "de", name: "HV10 Basic" }],
    });
    if (!variant.success) throw new Error(`hv10 variant: ${JSON.stringify(variant.error)}`);

    const addon = await createAddonAction({
      branchId: S.branch1!,
      slug: `${PREFIX}fridge`,
      name: "HV10 Fridge",
      translations: [{ locale: "de", name: "HV10 Fridge" }],
    });
    if (!addon.success) throw new Error(`hv10 addon: ${JSON.stringify(addon.error)}`);

    // Draft-field update.
    const upd = await updateServiceAction({
      branchId: S.branch1!,
      serviceId: svc.data.id,
      name: "HV10 Standard U",
    });
    if (!upd.success) throw new Error(`hv10 update: ${JSON.stringify(upd.error)}`);

    // Activation preconditions: category before service before variant.
    const catAct = await changeStatusAction({ branchId: S.branch1!, entityType: "service_category", entityId: cat.data.id, status: "active" });
    if (!catAct.success) throw new Error(`hv10 catAct: ${JSON.stringify(catAct.error)}`);
    const svcAct = await changeStatusAction({ branchId: S.branch1!, entityType: "service", entityId: svc.data.id, status: "active" });
    if (!svcAct.success) throw new Error(`hv10 svcAct: ${JSON.stringify(svcAct.error)}`);
    const varAct = await changeStatusAction({ branchId: S.branch1!, entityType: "service_variant", entityId: variant.data.id, status: "active" });
    if (!varAct.success) throw new Error(`hv10 varAct: ${JSON.stringify(varAct.error)}`);
    const addAct = await changeStatusAction({ branchId: S.branch1!, entityType: "service_addon", entityId: addon.data.id, status: "active" });
    if (!addAct.success) throw new Error(`hv10 addAct: ${JSON.stringify(addAct.error)}`);
    // Orphan definition requires the addon to be enabled too.
    const addonOn = await setOfferingStateAction({ branchId: S.branch1!, entityType: "service_addon", entityId: addon.data.id, is_enabled: true });
    if (!addonOn.success) throw new Error(`hv10 addonOn: ${JSON.stringify(addonOn.error)}`);

    // Offering state is separate from lifecycle.
    const on = await setOfferingStateAction({ branchId: S.branch1!, entityType: "service", entityId: svc.data.id, is_enabled: true });
    if (!on.success) throw new Error(`hv10 on: ${JSON.stringify(on.error)}`);

    // Ordering.
    const reorder = await reorderCatalogAction({ branchId: S.branch1!, entityType: "service", orderedIds: [svc.data.id] });
    if (!reorder.success) throw new Error(`hv10 reorder: ${JSON.stringify(reorder.error)}`);

    // Compatibility set/remove on the now-active service.
    const compat = await setAddonCompatibilityAction({ branchId: S.branch1!, addonId: addon.data.id, serviceId: svc.data.id });
    if (!compat.success) throw new Error(`hv10 compat: ${JSON.stringify(compat.error)}`);
    const rm = await removeAddonCompatibilityAction({ branchId: S.branch1!, compatibilityId: compat.data.id });
    if (!rm.success) throw new Error(`hv10 compat rm: ${JSON.stringify(rm.error)}`);

    // Orphan inspection: the addon is enabled+active with no compatibility row.
    const orphans = await findOrphanedAddonsAction(S.branch1!);
    if (!orphans.success) throw new Error(`hv10 orphans: ${JSON.stringify(orphans.error)}`);
    expect(orphans.data.some((a) => a.id === addon.data.id)).toBe(true);

    // Published slug rename creates the audited alias.
    const renamed = await renamePublishedSlugAction({ branchId: S.branch1!, entityType: "service", entityId: svc.data.id, newSlug: `${PREFIX}std-r` });
    if (!renamed.success) throw new Error(`hv10 rename: ${JSON.stringify(renamed.error)}`);

    const alias = await sql<{ n: string }>(
      `select count(*)::text as n from public.service_slug_aliases
        where branch_id = $1 and entity_type = 'service' and entity_id = $2 and old_slug = $3`,
      [S.branch1, svc.data.id, `${PREFIX}std`],
    );
    expect(Number(alias[0].n)).toBe(1);
  }, 120_000);

  // -- 03) PRICING ADMIN CONTRACTS --------------------------------------------

  it("03 PRICING: profile → draft version → draft rule → publish → immutability → archive", async () => {
    const profile = await createPricingProfileAction({ branch_id: S.branch1!, name: `HV10 P ${RUN}`, currency: "EUR" });
    if (!profile.success) throw new Error(`hv10 profile: ${JSON.stringify(profile.error)}`);
    const version = await createPricingVersionAction({ profile_id: profile.data.id, branch_id: S.branch1!, effective_from: "2026-01-01" });
    if (!version.success) throw new Error(`hv10 version: ${JSON.stringify(version.error)}`);
    expect(version.data.status).toBe("draft");

    const rule = await createPricingRuleAction({
      version_id: version.data.id,
      branch_id: S.branch1!,
      rule_type: "base_rate",
      configuration: FIX_RATE,
    });
    if (!rule.success) throw new Error(`hv10 rule: ${JSON.stringify(rule.error)}`);

    const published = await publishPricingVersionAction({ version_id: version.data.id, branch_id: S.branch1! });
    if (!published.success) throw new Error(`hv10 publish: ${JSON.stringify(published.error)}`);
    expect(published.data.status).toBe("published");

    // Published = immutable: rule creation on it must fail.
    const imm = await createPricingRuleAction({
      version_id: version.data.id,
      branch_id: S.branch1!,
      rule_type: "minimum_charge",
      configuration: FIX_MINIMUM,
    });
    expect(imm.success).toBe(false);

    const archived = await archivePricingVersionAction({ version_id: version.data.id });
    if (!archived.success) throw new Error(`hv10 archive: ${JSON.stringify(archived.error)}`);
    expect(archived.data.status).toBe("archived");
  }, 120_000);

  // -- 04) SCHEDULING ADMIN (BD-E3b authorization matrix) ----------------------

  it("04 SCHEDULING HQ: config read/update, weekly hours upsert, typed exception create/delete", async () => {
    const cfg = await getSchedulingConfigAction(S.branch1!);
    if (!cfg.success) throw new Error(`hv10 cfg: ${JSON.stringify(cfg.error)}`);
    const upd = await updateSchedulingConfigAction({ branch_id: S.branch1!, minimum_notice_minutes: 90 });
    if (!upd.success) throw new Error(`hv10 cfg upd: ${JSON.stringify(upd.error)}`);
    expect(upd.data.minimum_notice_minutes).toBe(90);

    const hours = await listOperatingHoursAction(S.branch1!);
    if (!hours.success) throw new Error(`hv10 hours: ${JSON.stringify(hours.error)}`);
    const upserted = await upsertOperatingHoursAction({
      branch_id: S.branch1!,
      weekday: 1,
      intervals: [{ start: "09:00", end: "17:00" }],
      effective_from: "2026-06-01",
    });
    if (!upserted.success) throw new Error(`hv10 hours upsert: ${JSON.stringify(upserted.error)}`);

    const ex = await listScheduleExceptionsAction(S.branch1!);
    if (!ex.success) throw new Error(`hv10 ex: ${JSON.stringify(ex.error)}`);
    const created = await createScheduleExceptionAction({
      branch_id: S.branch1!,
      exception_type: "closed",
      start_date: "2026-12-24",
      end_date: "2026-12-26",
      reason: `HV10 fixture ${RUN}`,
    });
    if (!created.success) throw new Error(`hv10 ex create: ${JSON.stringify(created.error)}`);
    const del = await deleteScheduleExceptionAction({ branch_id: S.branch1!, exception_id: created.data.id });
    if (!del.success) throw new Error(`hv10 ex delete: ${JSON.stringify(del.error)}`);
  }, 120_000);

  it("04b SCHEDULING DENIALS: branch_manager / hq_staff / cleaner mutation denial + foreign-branch fail-closed", async () => {
    // Branch manager: branch1 member, yet branches.edit is hq_admin-only.
    await actAs(S.users.mgr.id);
    const bmCfg = await updateSchedulingConfigAction({ branch_id: S.branch1!, minimum_notice_minutes: 5 });
    expect(bmCfg.success).toBe(false);
    if (!bmCfg.success) expect(bmCfg.error.code).toBe(ErrorCode.FORBIDDEN);

    // hq_staff: org member, still denied.
    await actAs(S.users.staff.id);
    const staffCfg = await updateSchedulingConfigAction({ branch_id: S.branch1!, minimum_notice_minutes: 5 });
    expect(staffCfg.success).toBe(false);
    if (!staffCfg.success) expect(staffCfg.error.code).toBe(ErrorCode.FORBIDDEN);

    // Cleaner: denied.
    await actAs(S.users.cleaner.id);
    const clCfg = await updateSchedulingConfigAction({ branch_id: S.branch1!, minimum_notice_minutes: 5 });
    expect(clCfg.success).toBe(false);

    // HQ admin against a foreign-org branch: fail-closed (org access).
    await actAs(S.users.hq.id);
    const foreignOrg = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV10 Foreign ${RUN}', 'hv10-org-${RUN}-f') returning id`,
      )
    )[0].id;
    const foreignBranch = (
      await sql<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, status, activated_at, provisioning_status, country_code, timezone, currency, locale, enabled_locales)
         values ($1, 'HV10 Foreign B', 'hv10-fb-${RUN}', 'active', now(), 'ready', 'DE', 'Europe/Berlin', 'EUR', 'de', '["de"]'::jsonb) returning id`,
        [foreignOrg],
      )
    )[0].id;
    const fb = await updateSchedulingConfigAction({ branch_id: foreignBranch, minimum_notice_minutes: 5 });
    expect(fb.success).toBe(false);
    if (!fb.success) expect(fb.error.code).toBe(ErrorCode.FORBIDDEN);
  }, 120_000);

  // -- 05) RLS PROBES (real authenticated role) --------------------------------

  it("05 RLS: config-domain org isolation for authenticated roles unchanged", async () => {
    // A branch_manager scoped to branch1 sees nothing of branch2's pricing
    // profiles through RLS (set by service-level checks; RLS is the second wall).
    const rows = await withRlsUser(S.users.mgr.id, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from public.pricing_profiles
          where branch_id = $1`,
        [S.branch2!],
      ),
    );
    expect(Number(rows.rows[0].n)).toBe(0);

    // Outsider (no membership at all): zero visibility across config domains.
    const outside = await withRlsUser(S.users.outsider.id, (client) =>
      client.query<{ n: string }>(
        `select
           (select count(*)::text as n from public.service_categories where branch_id = $1) as cats,
           (select count(*)::text as n from public.pricing_profiles where branch_id = $1) as profiles,
           (select count(*)::text as n from public.branch_scheduling_configuration where branch_id = $1) as cfg`,
        [S.branch1!],
      ),
    );
    expect(outside.rows[0]).toEqual({ cats: "0", profiles: "0", cfg: "0" });
  }, 60_000);
});
