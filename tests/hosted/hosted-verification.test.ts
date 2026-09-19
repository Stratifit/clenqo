/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 1 (create-branch-provisioning)
 *
 * SKIPPED by default: runs only with  HOSTED_VERIFY=1 npx vitest run tests/hosted/
 * Never executes as part of `npm test`. Requires a configured `.env.local`
 * pointing at the TARGET Supabase project. Creates clearly identifiable
 * `hv-`-prefixed test records and removes them in afterAll (best effort, even
 * on failure). Never prints credential values.
 *
 * Verified areas (see the verification matrix in the change report):
 *   A environment  B real auth  C HQ authorization  D branch lifecycle
 *   E provisioning  F RLS isolation  G idempotency  H failure rollback
 *   I retry  J audit  K security-definer helpers  M activation guards
 *   (L transaction pinning is verified by H+I actually committing/rolling
 *    back multi-statement transactions over the hosted pooler.)
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import {
  createAndProvision,
  retryProvisioning,
  setProvisioningFailureHookForTests,
  type BranchRecord,
} from "@/features/branches/service";
import { activateBranch, checkActivationReadiness } from "@/features/branches/activation";
import { getMasterTemplatePages } from "@/features/website/master-template";
import { AppError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Environment (values are never printed)
// ---------------------------------------------------------------------------

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
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL_RAW = process.env.SUPABASE_DB_URL ?? "";
const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split(".")[0] : "";

/**
 * The production pool (lib/db/server.ts) enables TLS for Supabase hosts by
 * itself; the harness pool mirrors that behavior directly.
 */
const HOSTED = process.env.HOSTED_VERIFY === "1";

// ---------------------------------------------------------------------------
// Shared state + helpers
// ---------------------------------------------------------------------------

const RUN = randomBytes(3).toString("hex"); // unique run marker
const PREFIX = `hv-`;

let pool: Pool | null = null;

async function sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  if (!pool) throw new Error("pool not initialized");
  const res = await pool.query(text, (params ?? []) as never[]);
  return res.rows as T[];
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface TestUser {
  id: string;
  email: string;
  password: string;
}

async function createTestUser(name: string): Promise<TestUser> {
  const email = `${PREFIX}${name}-${RUN}@verify.example.com`;
  const password = randomBytes(18).toString("base64url") + "!Aa1";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return { id: data.user.id, email, password };
}

/** Sign in with the REAL hosted Supabase Auth (anon key → /auth/v1/token). */
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/**
 * Exercise the same construction as lib/session/server.ts: a Supabase SSR
 * server client with a cookie adapter, seeded from a REAL hosted sign-in,
 * then validated with getUser(). (cookies() itself is Next-runtime-only.)
 * Falls back to the plain client's getUser() — also real hosted validation —
 * if the SSR storage adapter refuses setSession.
 */
async function realSessionUserId(user: TestUser): Promise<string> {
  const bootstrap = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await bootstrap.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session) throw error ?? new Error("no session from hosted auth");

  const cookies: { name: string; value: string }[] = [];
  try {
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => cookies,
        setAll: (toSet) => {
          for (const { name, value } of toSet) cookies.push({ name, value });
        },
      },
    });
    await ssr.auth.setSession(data.session as Session);
    const { data: got, error: err2 } = await ssr.auth.getUser();
    if (!err2 && got.user) return got.user.id;
  } catch {
    // fall through to the plain-client validation below
  }
  const { data: got2, error: err3 } = await bootstrap.auth.getUser();
  if (err3 || !got2.user) throw err3 ?? new Error("hosted auth validation failed");
  return got2.user.id;
}

// ---------------------------------------------------------------------------
// Test fixture state
// ---------------------------------------------------------------------------

const S: {
  orgA?: string;
  orgB?: string;
  users: Record<string, TestUser>;
  branchB?: string;
  branch1?: string;
  branch2?: string;
  branch3?: string;
  corr1: string;
  corr2: string;
  corr3: string;
} = { users: {}, corr1: randomUUID(), corr2: randomUUID(), corr3: randomUUID() };

function branchInput(slugSuffix: string) {
  return {
    name: `HV Berlin ${RUN} ${slugSuffix}`,
    slug: `${PREFIX}${RUN}-${slugSuffix}`,
    country_code: "DE",
    timezone: "Europe/Berlin",
    currency: "EUR" as const,
    default_locale: "de" as const,
    enabled_locales: ["de", "en"] as ("de" | "en" | "fr" | "es")[],
  };
}

/** Non-null accessors for fixture state (runtime-guarded, TS-exact). */
function orgA(): string { expect(S.orgA, "fixture org A missing").toBeTruthy(); return S.orgA as string; }
function orgB(): string { expect(S.orgB, "fixture org B missing").toBeTruthy(); return S.orgB as string; }
function branch1(): string { expect(S.branch1, "fixture branch1 missing").toBeTruthy(); return S.branch1 as string; }
function branch2(): string { expect(S.branch2, "fixture branch2 missing").toBeTruthy(); return S.branch2 as string; }
function branch3(): string { expect(S.branch3, "fixture branch3 missing").toBeTruthy(); return S.branch3 as string; }
function branchB(): string { expect(S.branchB, "fixture branchB missing").toBeTruthy(); return S.branchB as string; }

function expectAppError(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

async function artifactCounts(branchId: string): Promise<Record<string, number>> {
  const rows = await sql<{ website: string; locales: string; pages: string; translations: string; sections: string; audits: string }>(
    `select
       (select count(*) from public.branch_websites where branch_id = $1)::text as website,
       (select count(*) from public.website_locales l
          join public.branch_websites w on w.id = l.website_id where w.branch_id = $1)::text as locales,
       (select count(*) from public.website_pages p
          join public.branch_websites w on w.id = p.website_id where w.branch_id = $1)::text as pages,
       (select count(*) from public.website_page_translations t
          join public.website_pages p on p.id = t.page_id
          join public.branch_websites w on w.id = p.website_id where w.branch_id = $1)::text as translations,
       (select count(*) from public.website_sections s
          join public.website_pages p on p.id = s.page_id
          join public.branch_websites w on w.id = p.website_id where w.branch_id = $1)::text as sections,
       (select count(*) from public.audit_logs where branch_id = $1)::text as audits`,
    [branchId],
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

async function auditActions(branchId: string): Promise<{ action: string; result: string; organization_id: string; request_id: string | null; metadata: Record<string, unknown> }[]> {
  return sql(
    `select action, result, organization_id, request_id, metadata
       from public.audit_logs where branch_id = $1 order by created_at asc`,
    [branchId],
  );
}

// ---------------------------------------------------------------------------
// Cleanup — best effort, runs even when tests fail
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  // 1) Organizations from this run (and any leftovers from aborted runs).
  const orgs = await sql<{ id: string }>(
    `select id from public.organizations where slug like 'hv-org-%'`,
  );
  for (const org of orgs) {
    await sql(`delete from public.audit_logs where organization_id = $1`, [org.id]);
    await sql(`delete from public.branches where organization_id = $1`, [org.id]);
    await sql(`delete from public.memberships where organization_id = $1`, [org.id]);
    await sql(`delete from public.organizations where id = $1`, [org.id]);
  }
  // 2) Auth users created by this run, plus hv- leftovers from aborted runs.
  for (const user of Object.values(S.users)) {
    try {
      await admin.auth.admin.deleteUser(user.id);
    } catch {
      /* best effort */
    }
  }
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const matches = (data?.users ?? []).filter((u) => (u.email ?? "").startsWith(PREFIX));
      for (const u of matches) {
        try {
          await admin.auth.admin.deleteUser(u.id);
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!HOSTED)("hosted verification: create-branch-provisioning", () => {
  beforeAll(async () => {
    // A) Environment preconditions (fail fast, nothing printed but booleans).
    expect(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL missing").toBeTruthy();
    expect(ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY missing").toBeTruthy();
    expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY missing").toBeTruthy();
    expect(DB_URL_RAW, "SUPABASE_DB_URL missing").toBeTruthy();
    expect(PROJECT_REF).toBe("ksdxzkghyvvdizwclhbu");

    const host = new URL(DB_URL_RAW).hostname;
    pool = new Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      max: 5,
      ssl: host.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query("select 1");
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await pool?.end();
      pool = null;
    }
  }, 120_000);

  // -- Fixture: organizations + users (real hosted auth users) --------------

  it("creates fixture organizations, memberships, and hosted auth users", async () => {
    S.orgA = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV Org A ${RUN}`, `hv-org-a-${RUN}`],
      )
    )[0].id;
    S.orgB = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug, default_locale, default_timezone, country_code)
         values ($1, $2, 'de', 'Europe/Berlin', 'DE') returning id`,
        [`HV Org B ${RUN}`, `hv-org-b-${RUN}`],
      )
    )[0].id;

    S.users.hqAdminA = await createTestUser("admin-a");
    S.users.hqStaffA = await createTestUser("staff-a");
    S.users.hqAdminB = await createTestUser("admin-b");
    S.users.managerB = await createTestUser("manager-b");
    S.users.cleanerB = await createTestUser("cleaner-b");

    for (const [user, org, role] of [
      ["hqAdminA", S.orgA, "hq_admin"],
      ["hqStaffA", S.orgA, "hq_staff"],
      ["hqAdminB", S.orgB, "hq_admin"],
      ["managerB", S.orgB, "branch_manager"],
      ["cleanerB", S.orgB, "cleaner"],
    ] as const) {
      await sql(
        `insert into public.memberships (organization_id, user_id, role, status) values ($1, $2, $3, 'active')`,
        [org, S.users[user].id, role],
      );
    }

    // Organization B gets one draft branch for branch-scope RLS probes.
    S.branchB = (
      await sql<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, status, provisioning_status,
            country_code, timezone, currency, locale)
         values ($1, $2, $3, 'draft', 'pending', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [S.orgB, `HV OrgB Branch ${RUN}`, `${PREFIX}${RUN}-orgb-branch`],
      )
    )[0].id;
    const mgr = await sql<{ id: string }>(
      `select id from public.memberships where user_id = $1`,
      [S.users.managerB.id],
    );
    await sql(
      `insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`,
      [mgr[0].id, S.branchB],
    );

    expect(Object.keys(S.users)).toHaveLength(5);
  }, 90_000);

  // -- B) Real Supabase Auth + session path ---------------------------------

  it("B: resolves an actor through real hosted Supabase Auth", async () => {
    const userId = await realSessionUserId(S.users.hqAdminA);
    expect(userId).toBe(S.users.hqAdminA.id);
    const ctx = await resolveActor(userId);
    expect(ctx.actor.role).toBe("hq_admin");
    expect(ctx.actor.organizationId).toBe(S.orgA);
  }, 60_000);

  it("B: rejects a user without membership (FORBIDDEN from resolveActor)", async () => {
    const outsider = await createTestUser("outsider");
    await expect(resolveActor(outsider.id)).rejects.toBeInstanceOf(AppError);
    // outsider has no org; cleanup removes it via the email-prefix sweep.
  }, 60_000);

  // -- C) HQ authorization ---------------------------------------------------

  it("C: HQ Staff and Branch Manager cannot create branches (missing branches.create)", async () => {
    const staffCtx = await resolveActor(S.users.hqStaffA.id);
    let err: unknown;
    try {
      await createAndProvision(staffCtx, branchInput("staff-denied"));
    } catch (e) {
      err = e;
    }
    expectAppError(err, "FORBIDDEN");

    const mgrCtx = await resolveActor(S.users.managerB.id);
    let err2: unknown;
    try {
      await createAndProvision(mgrCtx, branchInput("mgr-denied"));
    } catch (e) {
      err2 = e;
    }
    expectAppError(err2, "FORBIDDEN");

    const leaked = await sql<{ n: string }>(
      `select count(*)::text as n from public.branches where slug like '%denied%'`,
    );
    expect(Number(leaked[0].n)).toBe(0);
  }, 60_000);

  it("C: organization context comes from membership — injected organization_id is rejected", async () => {
    const ctx = await resolveActor(S.users.hqAdminA.id);
    let err: unknown;
    try {
      await createAndProvision(ctx, { ...branchInput("org-hijack"), organization_id: S.orgB });
    } catch (e) {
      err = e;
    }
    expectAppError(err, "INVALID_INPUT");
  }, 60_000);

  it("C: cross-organization retry is NOT_FOUND", async () => {
    // Provision a branch in org A first (D covers assertions in depth).
    const ctxA = await resolveActor(S.users.hqAdminA.id);
    ctxA.requestId = S.corr1;
    const res = await createAndProvision(ctxA, branchInput("berlin"));
    S.branch1 = res.branch.id;
    expect(res.created).toBe(true);

    const ctxB = await resolveActor(S.users.hqAdminB.id);
    let err: unknown;
    try {
      await retryProvisioning(ctxB, S.branch1);
    } catch (e) {
      err = e;
    }
    expectAppError(err, "NOT_FOUND");
  }, 90_000);

  // -- D + E) Lifecycle + provisioning completeness --------------------------

  it("D/E: branch is provisioned to ready (not activated) with the full website foundation", async () => {
    const [b] = await sql<BranchRecord>(`select * from public.branches where id = $1`, [branch1()]);
    expect(b.status).toBe("ready");
    expect(b.provisioning_status).toBe("ready");
    expect(b.activated_at).toBeNull(); // creation never activates
    expect(b.provisioned_at).not.toBeNull();
    expect(b.website_status).toBe("offline");

    const [w] = await sql<{ id: string; template_key: string; status: string; default_locale: string; seo_title: string }>(
      `select * from public.branch_websites where branch_id = $1`, [branch1()],
    );
    expect(w).toBeTruthy();
    expect(w.template_key).toBe("clenqo-main");
    expect(w.status).toBe("draft"); // provisioning ≠ publishing
    expect(w.default_locale).toBe("de");
    expect(w.seo_title).toContain("CLENQO");

    const locales = await sql<{ locale: string; is_default: boolean; is_enabled: boolean }>(
      `select locale, is_default, is_enabled from public.website_locales where website_id = $1 order by locale`, [w.id],
    );
    expect(locales.map((l) => l.locale).sort()).toEqual(["de", "en"]);
    expect(locales.filter((l) => l.is_default)).toEqual([{ locale: "de", is_default: true, is_enabled: true }]);

    const pages = await sql<{ slug: string; page_type: string; status: string }>(
      `select slug, page_type, status from public.website_pages where website_id = $1 order by sort_order`, [w.id],
    );
    expect(pages).toHaveLength(7);
    expect(new Set(pages.map((p) => p.page_type))).toEqual(
      new Set(["home", "services", "about", "contact", "faq", "legal", "booking"]),
    );
    expect(pages.every((p) => p.status === "draft")).toBe(true);

    const translations = await sql<{ locale: string }>(
      `select t.locale from public.website_page_translations t
         join public.website_pages p on p.id = t.page_id where p.website_id = $1`, [w.id],
    );
    expect(translations).toHaveLength(7);
    expect(new Set(translations.map((t) => t.locale))).toEqual(new Set(["de"]));

    const sections = await sql<{ page_type: string; section_key: string; content: Record<string, unknown>; is_enabled: boolean }>(
      `select p.page_type, s.section_key, s.content, s.is_enabled
         from public.website_sections s
         join public.website_pages p on p.id = s.page_id
        where p.website_id = $1`, [w.id],
    );
    const expected = getMasterTemplatePages("de");
    expect(sections).toHaveLength(expected.reduce((n, p) => n + p.sections.length, 0));
    // navigation/footer presence: hero + cta sections on the home page, and
    // the configuration audit carries the nav/footer/seo provenance.
    const homeKeys = sections.filter((s) => s.page_type === "home").map((s) => s.section_key);
    expect(homeKeys).toEqual(expect.arrayContaining(["hero", "cta", "trust", "process"]));
    const hero = sections.find((s) => s.page_type === "home" && s.section_key === "hero");
    expect(hero?.content?.cta_href).toBe("/book");
    const disabledReviews = sections.find((s) => s.page_type === "home" && s.section_key === "reviews");
    expect(disabledReviews?.is_enabled).toBe(false);

    // Ownership: everything resolves back to org A / branch 1.
    const wrongScope = await sql<{ n: string }>(
      `select count(*)::text as n
         from public.website_sections s
         join public.website_pages p on p.id = s.page_id
         join public.branch_websites w on w.id = p.website_id
         join public.branches b on b.id = w.branch_id
        where p.website_id = $1 and (w.branch_id <> $2 or b.organization_id <> $3)`,
      [w.id, S.branch1, S.orgA],
    );
    expect(Number(wrongScope[0].n)).toBe(0);
  }, 60_000);

  // -- G) Idempotency ---------------------------------------------------------

  it("G: duplicate creation returns the existing branch with no new artifacts or audits", async () => {
    const before = await artifactCounts(branch1());
    expect(before.website).toBe(1);

    const ctx = await resolveActor(S.users.hqAdminA.id);
    const res = await createAndProvision(ctx, branchInput("berlin"));
    expect(res.created).toBe(false);
    expect(res.branch.id).toBe(S.branch1);

    const after = await artifactCounts(branch1());
    expect(after).toEqual(before); // locales, pages, translations, sections, audits all unchanged
  }, 60_000);

  // -- F) RLS isolation as REAL authenticated roles (PostgREST) ---------------

  it("F: HQ admin sees own-org branch only; cross-org reads return nothing", async () => {
    const cA = await signIn(S.users.hqAdminA.email, S.users.hqAdminA.password);
    const own = await cA.from("branches").select("id").eq("id", branch1());
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const foreign = await cA.from("branches").select("id").eq("organization_id", orgB());
    expect(foreign.error).toBeNull();
    expect(foreign.data).toHaveLength(0);

    const memberships = await cA.from("memberships").select("organization_id");
    expect(memberships.error).toBeNull();
    expect(new Set(memberships.data?.map((m) => m.organization_id))).toEqual(new Set([orgA()]));
  }, 90_000);

  it("F: branch-scoped manager sees only the assigned branch; cleaner sees none", async () => {
    const cMgr = await signIn(S.users.managerB.email, S.users.managerB.password);
    const mgrRows = await cMgr.from("branches").select("id");
    expect(mgrRows.error).toBeNull();
    expect(mgrRows.data?.map((r) => r.id)).toEqual([branchB()]);

    const cCleaner = await signIn(S.users.cleanerB.email, S.users.cleanerB.password);
    const cleanerRows = await cCleaner.from("branches").select("id");
    expect(cleanerRows.error).toBeNull();
    expect(cleanerRows.data).toHaveLength(0);
  }, 90_000);

  it("F: anonymous users see nothing; writes are RLS-blocked for authenticated roles", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const anonRows = await anon.from("branches").select("id");
    expect(anonRows.error).toBeNull();
    expect(anonRows.data).toHaveLength(0);

    const cA = await signIn(S.users.hqAdminA.email, S.users.hqAdminA.password);
    const insert = await cA.from("branches").insert({
      organization_id: S.orgA, name: "RLS Blocked", slug: `${PREFIX}${RUN}-rls-blocked`,
      country_code: "DE", timezone: "Europe/Berlin", currency: "EUR", locale: "de",
    });
    expect(insert.error).toBeTruthy();
    expect((insert.error as { code?: string }).code).toBe("42501");

    const auditInsert = await cA.from("audit_logs").insert({
      organization_id: S.orgA, action: "x.y", resource_type: "x",
    });
    expect(auditInsert.error).toBeTruthy(); // grants revoked — audit is append-only via server
  }, 90_000);

  it("F: audit read access is organization-scoped", async () => {
    const cA = await signIn(S.users.hqAdminA.email, S.users.hqAdminA.password);
    const rows = await cA.from("audit_logs").select("organization_id");
    expect(rows.error).toBeNull();
    expect(rows.data?.length).toBeGreaterThan(0);
    expect(new Set(rows.data?.map((r) => r.organization_id))).toEqual(new Set([orgA()]));
  }, 90_000);

  // -- H) Provisioning failure / Tx2 rollback ---------------------------------

  it("H: injected Tx2 failure rolls back all provisioning content and records the failed state", async () => {
    const ctx = await resolveActor(S.users.hqAdminA.id);
    ctx.requestId = S.corr2;
    setProvisioningFailureHookForTests((stage) => stage === "sections");
    let err: unknown;
    try {
      await createAndProvision(ctx, branchInput("dortmund"));
    } catch (e) {
      err = e;
    }
    setProvisioningFailureHookForTests(null);
    expectAppError(err, "PROVISIONING_FAILED");
    expect((err as AppError).details).toMatchObject({ stage: "sections" });
    // The branch id surfaces in the typed error details (Tx1 committed first).
    S.branch2 = ((err as AppError).details as { branchId?: string }).branchId;
    expect(S.branch2, "branch id must be reported in failure details").toBeTruthy();

    const [b] = await sql<BranchRecord>(`select * from public.branches where id = $1`, [branch2()]);
    expect(b.provisioning_status).toBe("failed");
    expect(b.provisioning_stage).toBe("sections");
    expect(b.provisioning_attempts).toBe(1);
    // Tx3 stores reason and stage in separate columns (design §4).
    expect(b.provisioning_error).toContain("injected test failure");
    expect(b.activated_at).toBeNull();

    // Tx2 rollback: no orphaned website artifacts at all.
    const [w] = await sql<{ n: string }>(
      `select count(*)::text as n from public.branch_websites where branch_id = $1`, [branch2()],
    );
    expect(Number(w.n)).toBe(0);

    const actions = (await auditActions(branch2())).map((a) => a.action);
    expect(actions).toEqual(["branch.created", "provisioning.failed"]);
  }, 90_000);

  // -- I) Retry ----------------------------------------------------------------

  it("I: guarded retry re-provisions idempotently and reaches ready", async () => {
    const ctx = await resolveActor(S.users.hqAdminA.id);
    ctx.requestId = S.corr3;
    const retried = await retryProvisioning(ctx, branch2());
    expect(retried.provisioning_status).toBe("ready");
    expect(retried.status).toBe("ready");
    // attempts counts FAILED attempts (design §4: Tx3 increments on failure);
    // the retry audit records "attempt: 2" as the next attempt number.
    expect(retried.provisioning_attempts).toBe(1);

    const counts2 = await artifactCounts(branch2());
    expect(counts2.website).toBe(1);
    const counts1 = await artifactCounts(branch1());
    expect(counts2.locales).toBe(counts1.locales);
    expect(counts2.pages).toBe(counts1.pages);
    expect(counts2.translations).toBe(counts1.translations);
    expect(counts2.sections).toBe(counts1.sections);

    // First three events commit in distinct transactions (original Tx1, Tx3,
    // retry Tx1) so created_at orders them deterministically. The five Tx2
    // retry audits share one transaction timestamp (design §4), so their
    // relative order is not observable — asserted as an unordered group.
    const actions = (await auditActions(branch2())).map((a) => a.action);
    expect(actions.slice(0, 3)).toEqual([
      "branch.created",
      "provisioning.failed",
      "provisioning.retry_started",
    ]);
    expect(actions.slice(3).sort()).toEqual([
      "branch.ready",
      "configuration.provisioned",
      "locales.provisioned",
      "pages.provisioned",
      "website.provisioned",
    ]);
  }, 90_000);

  it("I: concurrent retries serialize — exactly one wins, no duplicate artifacts", async () => {
    // Create a third branch, force failure, then race two retries.
    const ctx = await resolveActor(S.users.hqAdminA.id);
    ctx.requestId = randomUUID();
    setProvisioningFailureHookForTests((stage) => stage === "locales");
    try {
      await createAndProvision(ctx, branchInput("hamburg"));
    } catch (e) {
      // expected — capture the branch id from the typed failure details
      S.branch3 = (e as AppError).details?.branchId as string | undefined;
    }
    setProvisioningFailureHookForTests(null);
    expect(S.branch3, "branch id must be reported in failure details").toBeTruthy();

    const [failedAttempts] = await sql<{ attempts: number; status: string }>(
      `select provisioning_attempts as attempts, provisioning_status as status from public.branches where id = $1`,
      [branch3()],
    );
    expect(failedAttempts.status).toBe("failed");

    const results = await Promise.all([
      retryProvisioning(ctx, branch3()).catch((e) => e),
      retryProvisioning(ctx, branch3()).catch((e) => e),
    ]);
    const ok = results.filter((r) => !(r instanceof Error));
    expect(ok).toHaveLength(2); // contention resolves to current state, not an error

    const [b] = await sql<BranchRecord>(`select * from public.branches where id = $1`, [branch3()]);
    expect(b.provisioning_status).toBe("ready");
    expect(b.provisioning_attempts).toBe(1); // one failed attempt recorded

    const counts = await artifactCounts(branch3());
    expect(counts.website).toBe(1);
    expect(counts.pages).toBe(7);

    const retryAudits = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs where branch_id = $1 and action = 'provisioning.retry_started'`,
      [branch3()],
    );
    expect(Number(retryAudits[0].n)).toBe(1); // the losing request never started a retry
  }, 120_000);

  it("I: retrying a ready branch is a no-op with no new audits", async () => {
    const before = await artifactCounts(branch1());
    const ctx = await resolveActor(S.users.hqAdminA.id);
    const again = await retryProvisioning(ctx, branch1());
    expect(again.id).toBe(S.branch1);
    expect(again.provisioning_status).toBe("ready");
    const after = await artifactCounts(branch1());
    expect(after).toEqual(before);
  }, 60_000);

  // -- J) Audit events + correlation -------------------------------------------

  it("J: audit events carry correct org/branch/request correlation and bounded metadata", async () => {
    const rows = await auditActions(branch1());
    // branch.created (Tx1) precedes the five Tx2 audits; within Tx2 the
    // events share one transaction timestamp, so order inside the group is
    // not observable — asserted as an unordered group.
    expect(rows[0].action).toBe("branch.created");
    expect(rows.slice(1).map((r) => r.action).sort()).toEqual([
      "branch.ready",
      "configuration.provisioned",
      "locales.provisioned",
      "pages.provisioned",
      "website.provisioned",
    ]);
    for (const r of rows) {
      expect(r.organization_id).toBe(S.orgA);
      expect(r.request_id).toBe(S.corr1);
      expect(r.result).toBe("success");
    }
    const failedRow = (await auditActions(branch2())).find((a) => a.action === "provisioning.failed");
    expect(failedRow?.result).toBe("failure");
    expect(failedRow?.request_id).toBe(S.corr2);
    expect((failedRow?.metadata as { stage?: string }).stage).toBe("sections");
  }, 60_000);

  // -- K) SECURITY DEFINER helpers on hosted Postgres ---------------------------

  it("K: helpers are SECURITY DEFINER, non-superuser-owned, search_path-locked — no bypass", async () => {
    const helpers = await sql<{
      proname: string; owner: string; owner_is_superuser: boolean; prosecdef: boolean; proconfig: string[] | null;
    }>(
      `select f.proname, r.rolname as owner, r.rolsuper as owner_is_superuser,
              f.prosecdef, f.proconfig
         from pg_proc f join pg_roles r on r.oid = f.proowner
        where f.pronamespace = 'public'::regnamespace
          and f.proname in ('has_organization_access','has_branch_access','get_membership_role')`,
    );
    expect(helpers).toHaveLength(3);
    for (const h of helpers) {
      expect(h.prosecdef).toBe(true);
      expect(h.owner_is_superuser).toBe(false); // hosted postgres role — the design's rationale
      expect(h.proconfig).toContain("search_path=public");
    }

    // Correct results as a real authenticated role with real claims.
    const client = await pool!.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query(
        `set local request.jwt.claims = '{"sub":"${S.users.hqAdminA.id}","role":"authenticated"}'`,
      );
      const res = await client.query(
        `select
           public.has_organization_access('${S.users.hqAdminA.id}'::uuid, '${S.orgA}'::uuid) as ok_a,
           public.has_organization_access('${S.users.hqAdminA.id}'::uuid, '${S.orgB}'::uuid) as ok_b,
           (select count(*) from public.branches where id = '${S.branch1}'::uuid) as visible_branch`,
      );
      expect(res.rows[0].ok_a).toBe(true);
      expect(res.rows[0].ok_b).toBe(false); // helpers do not leak cross-org access
      expect(Number(res.rows[0].visible_branch)).toBe(1);
      await client.query("rollback");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }, 60_000);

  // -- M) Activation guards ------------------------------------------------------

  it("M: activation is blocked by readiness requirements and by the database constraint", async () => {
    const ctx = await resolveActor(S.users.hqAdminA.id);
    ctx.requestId = randomUUID();

    const readiness = await checkActivationReadiness(ctx, branch1());
    expect(readiness.eligible).toBe(false);
    // BD-A4 (Change 8): notification_configuration is ADVISORY — reported via
    // advisoryMissing, never in the blocking list. Mandatory items unchanged.
    expect(readiness.missing).toEqual(
      expect.arrayContaining(["services", "pricing", "operating_hours", "manager", "service_area"]),
    );
    expect(readiness.missing).not.toContain("notification_configuration");
    expect(readiness.advisoryMissing).toContain("notification_configuration");

    let err: unknown;
    try {
      await activateBranch(ctx, branch1());
    } catch (e) {
      err = e;
    }
    expectAppError(err, "BRANCH_INACTIVE");

    // Database-level guard: cannot flip a non-ready branch to active via SQL.
    let dbErr: { code?: string; constraint?: string } | undefined;
    try {
      await sql(
        `update public.branches set status = 'active', activated_at = now() where id = $1`,
        [branchB()],
      );
    } catch (e) {
      dbErr = e as { code?: string; constraint?: string };
    }
    expect(dbErr?.code).toBe("23514");
    expect(dbErr?.constraint).toBe("ck_branches_activation_requires_ready");

    // Branch 1 remains ready-but-not-active.
    const [b] = await sql<BranchRecord>(`select status, activated_at from public.branches where id = $1`, [branch1()]);
    expect(b.status).toBe("ready");
    expect(b.activated_at).toBeNull();
  }, 60_000);
});
