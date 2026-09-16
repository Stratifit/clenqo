/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 2 (create-service-catalog)
 *
 * SKIPPED by default (task 14.1 implemented; 14.2 executed only on explicit
 * authorization): runs only with  HOSTED_VERIFY=1 npx vitest run tests/hosted/
 * — never as part of `npm test`. Requires a configured `.env.local` pointing
 * at the TARGET staging project (ksdxzkghyvvdizwclhbu) with migration 0008
 * applied.
 *
 * Coverage: 0008 schema (tables/columns/constraints/FKs/indexes/no-pricing),
 * real-Auth authorization (HQ / HQ Staff / Branch Manager / Cleaner /
 * unauthenticated), organization + branch isolation, RLS probes as the real
 * `authenticated` role (translations, compatibility, aliases, anonymous,
 * known-ID probing, write denial, no FORCE), catalog CRUD + lifecycle +
 * offering opt-in + visibility + ordering + effective catalog, allow-list
 * compatibility (variant-specific, NULL-variant, duplicates, cross-branch,
 * quantity bounds, orphan detection), localization fallback + upsert
 * idempotency, slug draft-rename/freeze/alias/atomicity/collisions,
 * transactional audit incl. FAIL-CLOSED verification, idempotent seeding with
 * empty V1 definition (Q6), and best-effort cleanup of every `hv2-` record.
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
  changeStatus,
  createAddon,
  createCategory,
  createService,
  createVariant,
  findOrphanedAddons,
  listEffectiveCatalog,
  removeAddonCompatibility,
  renamePublishedSlug,
  reorderCatalog,
  resolveCatalogSlug,
  setAddonCompatibility,
  setOfferingState,
  updateAddon,
  validateSelection,
} from "@/features/services/service";
import { seedCatalogFromDefinition, V1_CATALOG_DEFINITION } from "@/features/services/seed";
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
const PREFIX = "hv2-";

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
  request_id: string | null;
  metadata: Record<string, unknown>;
}

async function auditRows(resourceId: string): Promise<AuditRow[]> {
  return sql<AuditRow>(
    `select action, actor_user_id, actor_type, organization_id, branch_id,
            resource_type, resource_id, result, request_id, metadata
       from public.audit_logs where resource_id = $1 order by created_at asc`,
    [resourceId],
  );
}

function expectAppError(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// Cleanup — best effort, runs even when tests fail; verified zero-leftover.
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  const orgs = await sql<{ id: string }>(
    `select id from public.organizations where slug like 'hv2-org-%'`,
  );
  for (const org of orgs) {
    // Translation tables have no organization_id column — scope via parents.
    for (const [table, fkCol, parentTable] of [
      ["service_category_translations", "category_id", "service_categories"],
      ["service_translations", "service_id", "services"],
      ["service_variant_translations", "variant_id", "service_variants"],
      ["service_addon_translations", "addon_id", "service_addons"],
    ] as const) {
      await sql(
        `delete from public.${table} where ${fkCol} in (
           select id from public.${parentTable} where organization_id = $1)`,
        [org.id],
      );
    }
    for (const table of [
      "service_slug_aliases",
      "service_addon_compatibility",
      "service_addons",
      "service_variants",
      "services",
      "service_categories",
    ]) {
      await sql(`delete from public.${table} where organization_id = $1`, [org.id]);
    }
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
  const orgs = await sql<{ n: string }>(`select count(*)::text as n from public.organizations where slug like 'hv2-org-%'`);
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(`select count(*)::text as n from public.branches where slug like 'hv2-%'`);
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of [
    "service_categories", "services", "service_variants", "service_addons",
    "service_addon_compatibility", "service_slug_aliases",
  ]) {
    const rows = await sql<{ n: string }>(`select count(*)::text as n from public.${table} where organization_id in (select id from public.organizations where slug like 'hv2-org-%')`);
    checks.push([table, Number(rows[0].n)]);
  }
  // Translations: counted through their parent entity.
  for (const [table, fkCol, parentTable] of [
    ["service_category_translations", "category_id", "service_categories"],
    ["service_translations", "service_id", "services"],
    ["service_variant_translations", "variant_id", "service_variants"],
    ["service_addon_translations", "addon_id", "service_addons"],
  ] as const) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table} t
        where t.${fkCol} in (select id from public.${parentTable}
                              where organization_id in (select id from public.organizations where slug like 'hv2-org-%'))`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const audits = await sql<{ n: string }>(`select count(*)::text as n from public.audit_logs where organization_id in (select id from public.organizations where slug like 'hv2-org-%')`);
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
  cat?: string;
  svc?: string;
  variant?: string;
  addon?: string;
  compat?: string;
  users: Record<string, string>;
  otherBranchId?: string;
  foreignServiceId?: string;
} = { users: {} };

function branchInput(slugSuffix: string) {
  return {
    name: `HV2 Berlin ${RUN} ${slugSuffix}`,
    slug: `${PREFIX}${RUN}-${slugSuffix}`,
    country_code: "DE",
    timezone: "Europe/Berlin",
    currency: "EUR" as const,
    default_locale: "de" as const,
    enabled_locales: ["de", "en"] as ("de" | "en" | "fr" | "es")[],
  };
}

describe.skipIf(!HOSTED)("hosted verification: create-service-catalog", () => {
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
      console.log("hv2 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  }, 180_000);

  // -- 00) DATABASE: migration 0008 schema ---------------------------------

  it("00 DATABASE: migration 0008 applied — 10 tables, columns, no pricing fields, no FORCE RLS", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in
        ('service_categories','services','service_variants','service_addons',
         'service_category_translations','service_translations',
         'service_variant_translations','service_addon_translations',
         'service_addon_compatibility','service_slug_aliases')`,
    );
    expect(tables).toHaveLength(10);

    const branchNullable = await sql<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema='public' and column_name='branch_id' and is_nullable='YES'
          and table_name in ('service_categories','services','service_variants',
                             'service_addons','service_addon_compatibility','service_slug_aliases')`,
    );
    expect(branchNullable).toEqual([]); // branch_id NOT NULL everywhere (Q9)

    const pricing = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name in
          ('service_categories','services','service_variants','service_addons')
          and (column_name like '%price%' or column_name like '%pricing%')`,
    );
    expect(pricing).toEqual([]); // Q5

    const categoryId = await sql<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_schema='public' and table_name='services' and column_name='category_id'`,
    );
    expect(categoryId[0].is_nullable).toBe("NO"); // Q4

    // Constraints: lifecycle CHECKs, quantity bounds, same-branch composite
    // FKs, natural-key uniques, alias uniqueness.
    for (const constraint of [
      "ck_service_categories_status", "ck_services_status",
      "ck_service_variants_status", "ck_service_addons_status",
      "ck_service_addons_quantity_bounds",
      "fk_compat_addon_same_branch", "fk_compat_service_same_branch",
      "fk_compat_variant_same_branch",
      "uq_service_categories_branch_slug", "uq_services_branch_slug",
      "uq_service_variants_service_slug", "uq_service_addons_branch_slug",
      "uq_service_addon_compatibility", "uq_service_slug_aliases",
      "uq_service_translations", "uq_service_category_translations",
      "uq_service_variant_translations", "uq_service_addon_translations",
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

    // Translation uniqueness keys are plain uniques (verified above); the
    // compatibility natural key's NULLS NOT DISTINCT semantics are exercised
    // behaviorally in test 07 (NULL-variant row coexisting with variant rows).

    const idx = await sql<{ n: string }>(
      `select count(*)::int as n from pg_indexes where schemaname='public' and indexname = any($1)`,
      [[
        "idx_service_categories_branch_id", "idx_service_categories_status",
        "idx_services_branch_id", "idx_services_status", "idx_services_category_id",
        "idx_service_variants_service_id", "idx_service_variants_branch_id", "idx_service_variants_status",
        "idx_service_addons_branch_id", "idx_service_addons_status",
        "idx_service_category_translations_category", "idx_service_translations_service",
        "idx_service_variant_translations_variant", "idx_service_addon_translations_addon",
        "idx_compat_addon", "idx_compat_service", "idx_compat_branch",
        "idx_slug_aliases_entity", "idx_slug_aliases_branch",
      ]],
    );
    expect(idx[0].n).toBe(19);

    const rls = await sql<{ relname: string; enabled: boolean; forced: boolean }>(
      `select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname like 'service%' and c.relkind = 'r'`,
    );
    expect(rls.every((r) => r.enabled)).toBe(true);
    expect(rls.some((r) => r.forced)).toBe(false); // no FORCE RLS
  }, 90_000);

  // -- 01) Fixtures: real hosted Auth users + provisioning ------------------

  it("01 FIXTURES: creates hosted org, real Auth users, memberships, provisioned branch", async () => {
    S.orgA = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV2 Org A ${RUN}`, `hv2-org-a-${RUN}`],
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

    const ctx = await resolveActor(adminUserId);
    const { branch } = await createAndProvision(ctx, branchInput("berlin"));
    S.branch1 = branch.id;

    const mgr = await sql<{ id: string }>(
      `select id from public.memberships where user_id = $1`,
      [managerUserId],
    );
    await sql(
      `insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`,
      [mgr[0].id, S.branch1],
    );

    expect(Object.keys(S.users)).toHaveLength(4);
  }, 180_000);

  // -- 02) CATALOG: CRUD + audit fields + draft rename ----------------------

  it("02 CATALOG: HQ CRUD (category/service/variant/addon) — draft+disabled, audit fields correct, draft rename free", async () => {
    const ctx = await resolveActor(S.users.admin);
    ctx.requestId = randomUUID();
    S.cat = (
      await createCategory(ctx, {
        branchId: S.branch1!,
        slug: `hv2-cat-${RUN}`,
        name: "HV2 Cat",
        translations: [
          { locale: "de", name: "HV2 Kategorie" },
          { locale: "en", name: "HV2 Category" },
        ],
      })
    ).id;
    S.svc = (
      await createService(ctx, {
        branchId: S.branch1!,
        categoryId: S.cat,
        slug: `hv2-svc-${RUN}`,
        name: "HV2 Svc",
        translations: [{ locale: "de", name: "HV2 Leistung" }],
      })
    ).id;
    S.variant = (
      await createVariant(ctx, {
        branchId: S.branch1!,
        serviceId: S.svc,
        slug: `hv2-var-${RUN}`,
        name: "HV2 Var",
        translations: [{ locale: "de", name: "HV2 Variante" }],
      })
    ).id;
    S.addon = (
      await createAddon(ctx, {
        branchId: S.branch1!,
        slug: `hv2-addon-${RUN}`,
        name: "HV2 Addon",
        min_quantity: 1,
        max_quantity: 3,
        translations: [{ locale: "de", name: "HV2 Zusatz" }],
      })
    ).id;

    const rows = await sql<{ is_enabled: boolean; is_customer_visible: boolean; status: string }>(
      `select is_enabled, is_customer_visible, status from public.services where id = $1`,
      [S.svc],
    );
    expect(rows[0]).toEqual({ is_enabled: false, is_customer_visible: false, status: "draft" });

    // Audit fields: actor, org, branch, resource, request id, result, metadata.
    const created = (await auditRows(S.cat)).find((a) => a.action === "service_category.created");
    expect(created).toBeDefined();
    expect(created!.actor_user_id).toBe(S.users.admin);
    expect(created!.organization_id).toBe(S.orgA);
    expect(created!.branch_id).toBe(S.branch1);
    expect(created!.resource_type).toBe("service_category");
    expect(created!.resource_id).toBe(S.cat);
    expect(created!.result).toBe("success");
    expect(created!.request_id).toBeTruthy();
    expect(created!.metadata).toHaveProperty("slug", `hv2-cat-${RUN}`);

    // Draft rename is free (no alias row).
    const renamed = await renamePublishedSlug(ctx, {
      branchId: S.branch1!,
      entityType: "service",
      entityId: S.svc,
      newSlug: `hv2-svc-draft2-${RUN}`,
    });
    expect(renamed.slug).toBe(`hv2-svc-draft2-${RUN}`);
    const aliases = await sql<{ n: string }>(
      `select count(*)::text as n from public.service_slug_aliases where entity_id = $1`,
      [S.svc],
    );
    expect(Number(aliases[0].n)).toBe(0);
  }, 120_000);

  // -- 03) CATALOG: ordering + customer visibility ---------------------------

  it("03 CATALOG: branch-local reorder and customer-visibility flags", async () => {
    const ctx = await resolveActor(S.users.admin);
    const res = await reorderCatalog(ctx, {
      branchId: S.branch1!,
      entityType: "service_category",
      orderedIds: [S.cat!],
    });
    expect(res.updated).toBe(1);

    const hidden = await setOfferingState(ctx, {
      branchId: S.branch1!,
      entityType: "service_category",
      entityId: S.cat!,
      is_customer_visible: false,
    });
    expect(hidden.is_customer_visible).toBe(false);
    await setOfferingState(ctx, {
      branchId: S.branch1!,
      entityType: "service_category",
      entityId: S.cat!,
      is_customer_visible: true,
    });
  }, 90_000);

  // -- 04) AUTHORIZATION: real hosted Auth ----------------------------------

  it("04 AUTHORIZATION: HQ/HQ-Staff/Branch-Manager/Cleaner boundaries; injected org ID cannot override", async () => {
    const adminCtx = await resolveActor(S.users.admin);
    const staffCtx = await resolveActor(S.users.staff);
    const mgrCtx = await resolveActor(S.users.manager);
    const cleanerCtx = await resolveActor(S.users.cleaner);

    // Branch Manager: definition-level mutation → FORBIDDEN.
    let err: unknown;
    try {
      await createCategory(mgrCtx, {
        branchId: S.branch1!,
        slug: `hv2-mgr-cat-${RUN}`,
        name: "Mgr",
        translations: [{ locale: "de", name: "Mgr" }],
      });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "FORBIDDEN");

    // Branch Manager: offering flags on own branch → allowed.
    const enabled = await setOfferingState(mgrCtx, {
      branchId: S.branch1!,
      entityType: "service_category",
      entityId: S.cat!,
      is_enabled: true,
    });
    expect(enabled.is_enabled).toBe(true);

    // Cleaner: everything denied.
    let err2: unknown;
    try {
      await setOfferingState(cleanerCtx, {
        branchId: S.branch1!,
        entityType: "service_category",
        entityId: S.cat!,
        is_enabled: false,
      });
    } catch (e) {
      err2 = e;
    }
    expectAppError(err2, "FORBIDDEN");

    // HQ Staff (services.edit holder) may perform definition-level mutations.
    const staffCat = await createCategory(staffCtx, {
      branchId: S.branch1!,
      slug: `hv2-staff-cat-${RUN}`,
      name: "Staff Cat",
      translations: [{ locale: "de", name: "Staff Kategorie" }],
    });
    expect(staffCat.status).toBe("draft");

    // Client-supplied organization_id cannot override the actor's membership:
    // the strict create-branch schema rejects the injected key outright.
    S.orgB = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV2 Org B ${RUN}`, `hv2-org-b-${RUN}`],
      )
    )[0].id;
    let err3: unknown;
    try {
      await createAndProvision(adminCtx, { ...branchInput("hijack"), organization_id: S.orgB } as never);
    } catch (e) {
      err3 = e;
    }
    expectAppError(err3, "INVALID_INPUT"); // .strict() rejects the injected key

    // Cross-organization branch target → FORBIDDEN (branch not in own org).
    S.otherBranchId = (
      await sql<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, status, provisioning_status,
            country_code, timezone, currency, locale)
         values ($1, $2, $3, 'draft', 'pending', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [S.orgB, `HV2 OrgB Branch ${RUN}`, `${PREFIX}${RUN}-orgb-branch`],
      )
    )[0].id;
    let err4: unknown;
    try {
      await createCategory(adminCtx, {
        branchId: S.otherBranchId,
        slug: `hv2-hijack-cat-${RUN}`,
        name: "Hijack",
        translations: [{ locale: "de", name: "Hijack" }],
      });
    } catch (e) {
      err4 = e;
    }
    expectAppError(err4, "FORBIDDEN");
  }, 180_000);

  // -- 05) CATALOG: lifecycle + effective catalog + opt-in gate -------------

  it("05 CATALOG: activation preconditions, opt-in gate (Q2), effective catalog", async () => {
    const ctx = await resolveActor(S.users.admin);

    // Activation with category enabled → both become active.
    await changeStatus(ctx, { branchId: S.branch1!, entityType: "service_category", entityId: S.cat!, status: "active" });
    await changeStatus(ctx, { branchId: S.branch1!, entityType: "service", entityId: S.svc!, status: "active" });
    await changeStatus(ctx, { branchId: S.branch1!, entityType: "service_addon", entityId: S.addon!, status: "active" });

    // Variant activation requires the parent service active (already true).
    await changeStatus(ctx, { branchId: S.branch1!, entityType: "service_variant", entityId: S.variant!, status: "active" });

    // Service is active but NOT yet branch-enabled → absent from the read model.
    const eff1 = await listEffectiveCatalog(S.branch1!);
    expect(eff1.services.some((s) => s.id === S.svc)).toBe(false);

    // Enable via offering flag → appears (with category + addon).
    const mgrCtx = await resolveActor(S.users.manager);
    await setOfferingState(mgrCtx, { branchId: S.branch1!, entityType: "service", entityId: S.svc!, is_enabled: true });
    await setOfferingState(mgrCtx, {
      branchId: S.branch1!, entityType: "service_addon", entityId: S.addon!, is_enabled: true, is_customer_visible: true,
    });
    await setOfferingState(mgrCtx, {
      branchId: S.branch1!, entityType: "service_variant", entityId: S.variant!, is_enabled: true, is_customer_visible: true,
    });
    const eff2 = await listEffectiveCatalog(S.branch1!);
    expect(eff2.services.some((s) => s.id === S.svc)).toBe(true);

    // customerVisibleOnly respects the visibility flag on the category.
    const eff3 = await listEffectiveCatalog(S.branch1!, { customerVisibleOnly: true });
    expect(eff3.categories.some((c) => c.id === S.cat)).toBe(true);

    // Branch Manager cannot change lifecycle states.
    let err: unknown;
    try {
      await changeStatus(mgrCtx, { branchId: S.branch1!, entityType: "service", entityId: S.svc!, status: "inactive" });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "FORBIDDEN");
  }, 120_000);

  // -- 06) RLS: real authenticated role probes -------------------------------

  it("06 RLS: org isolation, branch scope, translations, compatibility, aliases, anonymous, write denial", async () => {
    // HQ admin sees own-org catalog rows; branch-scoped manager sees only
    // their branch; a cleaner with no branch grant sees nothing.
    await withRlsUser(S.users.admin, async (client) => {
      const res = await client.query<{ id: string }>(`select id from public.services`);
      expect(res.rows.map((r) => r.id)).toContain(S.svc);
    });
    await withRlsUser(S.users.manager, async (client) => {
      const res = await client.query<{ id: string }>(`select id from public.services`);
      expect(res.rows.map((r) => r.id)).toEqual([S.svc]);
    });
    await withRlsUser(S.users.cleaner, async (client) => {
      const res = await client.query<{ id: string }>(`select id from public.services`);
      expect(res.rows).toHaveLength(0);
    });

    // Cross-organization known-ID probing returns no rows (any role), and a
    // sibling-org service fixture (also used by test 07) stays invisible.
    const cat = (
      await sql<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'hv2-foreign-cat', 'FC') returning id`,
        [S.orgB, S.otherBranchId],
      )
    )[0].id;
    S.foreignServiceId = (
      await sql<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'hv2-foreign', 'Foreign') returning id`,
        [S.orgB, S.otherBranchId, cat],
      )
    )[0].id;
    const foreignSvc = S.foreignServiceId;
    await withRlsUser(S.users.admin, async (client) => {
      const probe = await client.query(`select * from public.services where id = $1`, [foreignSvc]);
      expect(probe.rows).toHaveLength(0);
      const probeCat = await client.query(`select * from public.service_categories where id = $1`, [S.otherBranchId]);
      expect(probeCat.rows).toHaveLength(0);
    });

    // Translation tables inherit the parent scope; anonymous sees nothing.
    await withRlsUser(S.users.manager, async (client) => {
      const res = await client.query<{ service_id: string }>(
        `select t.service_id from public.service_translations t
          join public.services s on s.id = t.service_id`,
      );
      expect(res.rows.map((r) => r.service_id)).toEqual([S.svc]);
    });
    await withRlsUser("00000000-0000-0000-0000-000000000000", async (client) => {
      const svc = await client.query(`select id from public.services`);
      expect(svc.rows).toHaveLength(0);
      const cats = await client.query(`select id from public.service_categories`);
      expect(cats.rows).toHaveLength(0);
    });

    // Write denial through the normal RLS path (insert/update/delete).
    await withRlsUser(S.users.admin, async (client) => {
      await expect(
        client.query(
          `insert into public.service_categories (organization_id, branch_id, slug, name)
           values ($1, $2, 'hv2-rls-hijack', 'Hijack')`,
          [S.orgA, S.branch1],
        ),
      ).rejects.toThrow();
      await expect(
        client.query(`update public.services set status = 'archived' where id = $1`, [S.svc]),
      ).rejects.toThrow();
      await expect(client.query(`delete from public.services`)).rejects.toThrow();
    });
  }, 180_000);

  // -- 07) COMPATIBILITY: allow-list matrix ----------------------------------

  it("07 COMPATIBILITY: absence=incompatible, variant-specific, NULL=all variants, dup→CONFLICT, cross-branch rejected, bounds", async () => {
    const ctx = await resolveActor(S.users.admin);

    // Absence = incompatible.
    const rejected = await validateSelection(ctx, {
      branchId: S.branch1!, serviceId: S.svc!, variantId: S.variant!,
      addonSelections: [{ addonId: S.addon!, quantity: 1 }],
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.violations[0].code).toBe("COMPATIBILITY");

    // Variant-specific allow-list row.
    S.compat = (
      await setAddonCompatibility(ctx, {
        branchId: S.branch1!, addonId: S.addon!, serviceId: S.svc!, variantId: S.variant!,
      })
    ).id;
    const okSpecific = await validateSelection(ctx, {
      branchId: S.branch1!, serviceId: S.svc!, variantId: S.variant!,
      addonSelections: [{ addonId: S.addon!, quantity: 2 }],
    });
    expect(okSpecific.valid).toBe(true);

    // Quantity above max_quantity → QUANTITY violation.
    const overQty = await validateSelection(ctx, {
      branchId: S.branch1!, serviceId: S.svc!, variantId: S.variant!,
      addonSelections: [{ addonId: S.addon!, quantity: 4 }],
    });
    expect(overQty.violations[0].code).toBe("QUANTITY");

    // Duplicate row → CONFLICT.
    let err: unknown;
    try {
      await setAddonCompatibility(ctx, {
        branchId: S.branch1!, addonId: S.addon!, serviceId: S.svc!, variantId: S.variant!,
      });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "CONFLICT");

    // Remove, then create the NULL-variant (all variants) row.
    await removeAddonCompatibility(ctx, { branchId: S.branch1!, compatibilityId: S.compat });
    const nullRow = await setAddonCompatibility(ctx, {
      branchId: S.branch1!, addonId: S.addon!, serviceId: S.svc!,
    });
    const okNull = await validateSelection(ctx, {
      branchId: S.branch1!, serviceId: S.svc!, variantId: S.variant!,
      addonSelections: [{ addonId: S.addon!, quantity: 1 }],
    });
    expect(okNull.valid).toBe(true);
    S.compat = nullRow.id;

    // Cross-branch compatibility rejected before any write.
    let err2: unknown;
    try {
      await setAddonCompatibility(ctx, {
        branchId: S.branch1!, addonId: S.addon!, serviceId: S.foreignServiceId!,
      });
    } catch (e) {
      err2 = e;
    }
    expectAppError(err2, "INVALID_INPUT");

    // Add-on bounds are enforced on update too.
    let err3: unknown;
    try {
      await updateAddon(ctx, { branchId: S.branch1!, addonId: S.addon!, max_quantity: 0 });
    } catch (e) {
      err3 = e;
    }
    expectAppError(err3, "INVALID_INPUT");

    // Orphan detection: remove the allow-list row → the enabled add-on is reported.
    await removeAddonCompatibility(ctx, { branchId: S.branch1!, compatibilityId: S.compat });
    const orphans = await findOrphanedAddons(S.branch1!);
    expect(orphans.some((a) => a.id === S.addon)).toBe(true);
    // Restore allow-list for later tests.
    const restored = await setAddonCompatibility(ctx, {
      branchId: S.branch1!, addonId: S.addon!, serviceId: S.svc!,
    });
    S.compat = restored.id;
  }, 180_000);

  // -- 08) LOCALIZATION ------------------------------------------------------

  it("08 LOCALIZATION: requested locale, default-locale fallback, upsert idempotency", async () => {
    // en translation exists for the category → requested text.
    const effEn = await listEffectiveCatalog(S.branch1!, { locale: "en" });
    const catEn = effEn.categories.find((c) => c.id === S.cat);
    expect(catEn?.display_name).toBe("HV2 Category");

    // fr translation missing → branch default (de) fallback, never empty.
    const effFr = await listEffectiveCatalog(S.branch1!, { locale: "fr" });
    const catFr = effFr.categories.find((c) => c.id === S.cat);
    expect(catFr?.display_name).toBe("HV2 Kategorie");
    expect(catFr?.display_name).not.toBe("");

    // No locale requested → operational base text (boundary unchanged).
    const effNone = await listEffectiveCatalog(S.branch1!);
    const catNone = effNone.categories.find((c) => c.id === S.cat);
    expect(catNone?.display_name).toBeUndefined();
  }, 90_000);

  // -- 09) SLUGS: freeze, atomic alias, collisions ----------------------------

  it("09 SLUGS: published rename creates alias atomically, old slug resolves, collisions rejected", async () => {
    const ctx = await resolveActor(S.users.admin);
    const newSlug = `hv2-svc-renamed-${RUN}`;
    await renamePublishedSlug(ctx, {
      branchId: S.branch1!, entityType: "service", entityId: S.svc!, newSlug,
    });
    const alias = await sql<{ old_slug: string }>(
      `select old_slug from public.service_slug_aliases where entity_id = $1`,
      [S.svc],
    );
    expect(alias[0].old_slug).toBe(`hv2-svc-draft2-${RUN}`);

    // Old slug resolves via alias; new slug resolves live.
    const viaAlias = await resolveCatalogSlug(S.branch1!, `hv2-svc-draft2-${RUN}`, { includeAliases: true });
    expect(viaAlias?.isAlias).toBe(true);
    expect(viaAlias?.entity.id).toBe(S.svc);
    const live = await resolveCatalogSlug(S.branch1!, newSlug);
    expect(live?.isAlias).toBe(false);

    // Rename back to the alias' old slug → CONFLICT (no chains/loops).
    let err: unknown;
    try {
      await renamePublishedSlug(ctx, {
        branchId: S.branch1!, entityType: "service", entityId: S.svc!, newSlug: `hv2-svc-draft2-${RUN}`,
      });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "CONFLICT");

    // Rename to a slug claimed by another live service → CONFLICT.
    await createService(ctx, {
      branchId: S.branch1!, categoryId: S.cat!, slug: `hv2-svc-collide-${RUN}`,
      name: "Collide Svc", translations: [{ locale: "de", name: "Kollisions-Listung" }],
    });
    let err2: unknown;
    try {
      await renamePublishedSlug(ctx, {
        branchId: S.branch1!, entityType: "service", entityId: S.svc!, newSlug: `hv2-svc-collide-${RUN}`,
      });
    } catch (e) {
      err2 = e;
    }
    expectAppError(err2, "CONFLICT");

    // Rename and alias are atomically audited.
    const audits = await auditRows(S.svc!);
    const renameAudits = audits.filter((a) => a.action === "service_slug_alias.created");
    expect(renameAudits.length).toBeGreaterThanOrEqual(1);
    expect(renameAudits[0].metadata).toHaveProperty("old_slug");
    expect(renameAudits[0].metadata).toHaveProperty("new_slug", newSlug);
  }, 120_000);

  // -- 10) AUDIT: fail-closed transactional behavior ---------------------------

  it("10 AUDIT: fail-closed — a failing audit write rolls back the catalog mutation", async () => {
    const current = await sql<{ name: string }>(
      `select name from public.service_categories where id = $1`, [S.cat],
    );
    const nameBefore = current[0].name;
    const badAction = "hv2-fail-closed-probe"; // would violate ck_audit_action_format

    // Replays the domain's transactional write pattern: state change + audit
    // insert in ONE transaction. The audit write violates
    // ck_audit_action_format → the whole transaction aborts → the committed
    // name is unchanged and no orphan audit row exists.
    await withOwnerTx(async (client) => {
      await client.query(
        `update public.service_categories set name = $2, updated_at = now() where id = $1`,
        [S.cat, "HV2 Fail Closed V2"],
      );
      await client.query("savepoint hv2_failclosed");
      try {
        await client.query(
          `insert into public.audit_logs (
             organization_id, branch_id, actor_user_id, actor_type, action,
             resource_type, resource_id, result, metadata
           ) values ($1, $2, $3, 'user', $4, 'service_category', $5, 'success', '{}'::jsonb)`,
          [S.orgA, S.branch1, S.users.admin, badAction, S.cat],
        );
        await client.query("release savepoint hv2_failclosed");
        throw new Error("hv2-unexpected: audit insert should have failed");
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.startsWith("hv2-unexpected")) throw e;
        // Expected: check-constraint violation → roll back to savepoint.
        expect(msg + JSON.stringify((e as { detail?: unknown }).detail)).toMatch(
          /ck_audit_action_format|violates check constraint/i,
        );
        await client.query("rollback to savepoint hv2_failclosed");
      }
      // Propagate the abort: the state change must not commit without audit.
      throw new Error("hv2-expected-rollback");
    }).catch((e: unknown) => {
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("hv2-unexpected")) throw e;
      expect(msg).toBe("hv2-expected-rollback");
    });

    // Nothing was committed: the name change is absent, no orphan audit exists.
    const after = await sql<{ name: string }>(
      `select name from public.service_categories where id = $1`, [S.cat],
    );
    expect(after[0].name).toBe(nameBefore);
    const orphan = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs where action = $1`,
      [badAction],
    );
    expect(Number(orphan[0].n)).toBe(0);
  }, 120_000);

  // -- 11) SEEDING: idempotent, empty V1 definition (Q6) -----------------------

  it("11 SEEDING: idempotent rerun, disabled rows, summary audits, V1 definition empty (Q6)", async () => {
    // Q6 gate: the version-controlled V1 definition is intentionally empty.
    expect(V1_CATALOG_DEFINITION.categories).toEqual([]);
    expect(V1_CATALOG_DEFINITION.addons).toEqual([]);

    const definition = {
      categories: [
        {
          slug: `hv2-seed-cat-${RUN}`,
          name: "Seed Cat",
          sort_order: 0,
          translations: [{ locale: "de" as const, name: "Seed Kategorie" }],
          services: [
            {
              slug: `hv2-seed-svc-${RUN}`,
              name: "Seed Svc",
              sort_order: 0,
              translations: [{ locale: "de" as const, name: "Seed Leistung" }],
              variants: [
                {
                  slug: `hv2-seed-var-${RUN}`,
                  name: "Seed Var",
                  sort_order: 0,
                  translations: [{ locale: "de" as const, name: "Seed Variante" }],
                },
              ],
            },
          ],
        },
      ],
      addons: [
        {
          slug: `hv2-seed-addon-${RUN}`,
          name: "Seed Addon",
          sort_order: 0,
          min_quantity: 1,
          max_quantity: 2,
          translations: [{ locale: "de" as const, name: "Seed Zusatz" }],
          compatible_with: [{ service_slug: `hv2-seed-svc-${RUN}` }],
        },
      ],
    };

    const r1 = await seedCatalogFromDefinition(S.branch1!, S.orgA!, definition);
    expect(r1).toEqual({
      service_categories: 1, services: 1, service_variants: 1,
      service_addons: 1, service_addon_compatibility: 1,
    });
    const r2 = await seedCatalogFromDefinition(S.branch1!, S.orgA!, definition);
    expect(r2).toEqual({
      service_categories: 0, services: 0, service_variants: 0,
      service_addons: 0, service_addon_compatibility: 0,
    });

    // Natural-key behavior: exactly one row per slug; translations not duplicated.
    const counts = await sql<{ cats: string; svcs: string; vars: string; addons: string; tx: string }>(
      `select
         (select count(*)::text from public.service_categories where branch_id = $1 and slug like 'hv2-seed-%') as cats,
         (select count(*)::text from public.services where branch_id = $1 and slug like 'hv2-seed-%') as svcs,
         (select count(*)::text from public.service_variants where branch_id = $1 and slug like 'hv2-seed-%') as vars,
         (select count(*)::text from public.service_addons where branch_id = $1 and slug like 'hv2-seed-%') as addons,
         (select count(*)::text from public.service_translations t
            join public.services s on s.id = t.service_id
           where s.branch_id = $1 and s.slug like 'hv2-seed-%') as tx`,
      [S.branch1],
    );
    expect(counts[0]).toEqual({ cats: "1", svcs: "1", vars: "1", addons: "1", tx: "1" });

    // Seeded rows are disabled + not customer-visible (Q2).
    const seeded = await sql<{ is_enabled: boolean; is_customer_visible: boolean; status: string }>(
      `select is_enabled, is_customer_visible, status from public.services where slug = $1`,
      [`hv2-seed-svc-${RUN}`],
    );
    expect(seeded[0]).toEqual({ is_enabled: false, is_customer_visible: false, status: "draft" });

    // Compatibility idempotency: exactly one row despite two runs.
    const compat = await sql<{ n: string }>(
      `select count(*)::text as n from public.service_addon_compatibility c
         join public.service_addons a on a.id = c.service_addon_id
        where a.slug = $1`,
      [`hv2-seed-addon-${RUN}`],
    );
    expect(Number(compat[0].n)).toBe(1);

    // Summary audit events (one per entity type, not per row).
    const summaries = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where branch_id = $1 and metadata->>'seed_summary' = 'true'`,
      [S.branch1],
    );
    expect(Number(summaries[0].n)).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
