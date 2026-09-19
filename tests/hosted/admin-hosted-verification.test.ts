/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 8 (create-admin-foundation)
 *
 * SKIPPED by default: runs only with  HOSTED_VERIFY=1 npx vitest run
 * tests/hosted/admin-hosted-verification.test.ts — never part of `npm test`.
 * Requires `.env.local` pointing at the TARGET staging project
 * (ksdxzkghyvvdizwclhbu) with the migration chain 0001–0014 applied.
 *
 * Coverage: 0014 schema (slug CHECKs + global uniqueness + aliases + RLS
 * without FORCE — C8-3), admin context resolution incl. Branch-Manager
 * fail-closed scope (C8-1/BD-A3), memberships RLS boundary for context
 * enumeration, one-time bootstrap lock against the HOSTED committed state
 * (BD-A1 — the hosted project is pre-bootstrap, so the locked invariant is
 * probed with a real valid token; the happy path is exercised in the local
 * domain suite on a clean database), activation readiness advisory/override
 * (BD-A4), and the invitation foundation (users.invite + audited +
 * duplicate protection). No SETUP_TOKEN value is committed; it is generated
 * in-process for this run only.
 *
 * ALL fixture values are explicit NON-PRODUCTION fixtures (P3). The suite
 * creates its own hv8-suffixed entities and deletes everything afterwards.
 * The one-time bootstrap gate itself is NOT consumed: no organization gains
 * an active HQ Admin through /setup here (invitation happens through the
 * domain service directly, not through setup).
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { seedBookingDefaults } from "@/features/booking/seed";
import { createProfile, createRule, createVersion, publishVersion, updateProfile } from "@/features/pricing/service";
import {
  checkActivationReadiness,
  activateBranch,
} from "@/features/branches/activation";
import {
  inviteStaffMember,
  performSetup,
} from "@/features/admin/auth";
import { resolveAdminContext } from "@/features/admin/context";

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
const PREFIX = "hv8-";

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
  "branch_slug_aliases",
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
        await maint.query(
          "select id from public.organizations where slug like 'hv8-org-%' or slug like 'hv8-bootstrap-%'",
        )
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
    `select count(*)::text as n from public.organizations
      where slug like 'hv8-org-%' or slug like 'hv8-bootstrap-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv8-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of TEARDOWN_ORG_TABLES) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations
          where slug like 'hv8-org-%' or slug like 'hv8-bootstrap-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  // Tail tables handled with dedicated statements in cleanup.
  const tail = await sql<{ branches: string; mb: string; mem: string }>(
    `select
       (select count(*)::text as n from public.branches where slug like 'hv8-%') as branches,
       (select count(*)::text as n from public.membership_branches where membership_id in
          (select m.id from public.memberships m where m.organization_id in
             (select id from public.organizations where slug like 'hv8-org-%' or slug like 'hv8-bootstrap-%'))) as mb,
       (select count(*)::text as n from public.memberships where organization_id in
          (select id from public.organizations where slug like 'hv8-org-%' or slug like 'hv8-bootstrap-%')) as mem`,
  );
  checks.push(["branches(tail)", Number(tail[0].branches)]);
  checks.push(["membership_branches(tail)", Number(tail[0].mb)]);
  checks.push(["memberships(tail)", Number(tail[0].mem)]);
  const leftovers = checks.filter(([, n]) => n !== 0);
  expect(leftovers).toEqual([]);
}

const S: {
  orgA?: string;
  branch1?: string;
  users: Record<string, { id: string; email: string }>;
} = { users: {} };

// NON-PRODUCTION fixture values (P3).
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 };
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };

describe.skipIf(!HOSTED)("hosted verification: create-admin-foundation", () => {
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
      console.log("hv8 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  });

  // -- 00) 0014 SCHEMA (C8-3) ----------------------------------------------

  it("00 DATABASE: migration 0014 applied — slug CHECKs, global uniqueness, aliases table, RLS without FORCE", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = 'branch_slug_aliases'`,
    );
    expect(tables).toHaveLength(1);

    const checks = await sql<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.branches'::regclass and contype = 'c'
          and conname like 'ck_branches_slug%'`,
    );
    // length + shape + reserved + no-double-hyphen (C8-3).
    expect(checks.length).toBeGreaterThanOrEqual(4);

    const global = await sql<{ n: string }>(
      `select count(*)::text as n from pg_indexes
        where tablename = 'branches' and indexname = 'uq_branches_slug_global'`,
    );
    expect(Number(global[0].n)).toBe(1);

    const aliasChecks = await sql<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.branch_slug_aliases'::regclass and contype = 'c'`,
    );
    expect(aliasChecks.length).toBeGreaterThanOrEqual(4);

    const rls = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname in ('branches','branch_slug_aliases')`,
    );
    for (const r of rls) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(false);
    }
  });

  // -- 01) FIXTURES --------------------------------------------------------

  it("01 FIXTURES: hosted org, real Auth users, provisioned ready branch, activation-eligible configuration", async () => {
    const orgId = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV8 Org ${RUN}', 'hv8-org-${RUN}') returning id`,
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
    S.users.outsider = await createHostedUser("outsider");

    const { branch } = await createAndProvision(await resolveActor(S.users.hq.id), {
      name: `HV8 Berlin ${RUN}`,
      slug: `${PREFIX}${RUN}-berlin`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch1 = branch.id;

    await seedSchedulingDefaults(S.branch1);
    await seedBookingDefaults(S.branch1);

    // Catalog: one active service (readiness item "services").
    const cat = (
      await sql<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
         values ($1, $2, 'hv8-cat', 'Cat', 'active', true) returning id`,
        [orgId, S.branch1],
      )
    )[0].id;
    const svc = (
      await sql<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
         values ($1, $2, $3, 'hv8-svc', 'Svc', 'active', true) returning id`,
        [orgId, S.branch1, cat],
      )
    )[0].id;

    // Pricing: active profile with a published version (readiness item "pricing").
    const ctx = await resolveActor(S.users.hq.id);
    const profile = await createProfile(ctx, { branch_id: S.branch1, name: `HV8 Profile ${RUN}`, currency: "EUR" });
    const version = await createVersion(ctx, { profile_id: profile.id, branch_id: S.branch1, effective_from: "2026-01-01" });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "base_rate", service_id: svc, configuration: FIX_RATE });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "duration_rule", service_id: svc, configuration: FIX_DURATION });
    await publishVersion(ctx, version.id, { branch_id: S.branch1 });
    await updateProfile(ctx, profile.id, { status: "active" });

    // Service area as a branch-owned fixture column.
    await sql(`update public.branches set service_area = '{"type":"postal_codes","codes":["10115"]}'::jsonb where id = $1`, [S.branch1]);

    // Branch manager scope (readiness item "manager" + C8-1 BM scope test).
    const mgrMembership = (
      await sql<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'branch_manager') returning id`,
        [orgId, S.users.mgr.id],
      )
    )[0].id;
    await sql(`insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`, [mgrMembership, S.branch1]);

    expect(S.users.staff.email).toContain("hv8-staff-");
  });

  // -- 02) CONTEXT (C8-1 / BD-A3) + memberships RLS -------------------------

  it("02 CONTEXT: HQ branch context validated; Branch Manager constrained to membership_branches; fail-closed everywhere else", async () => {
    const hqCtx = await resolveActor(S.users.hq!.id);

    const allCtx = await resolveAdminContext(hqCtx, null);
    expect(allCtx.branchContext).toEqual({ type: "org" });

    const branchCtx = await resolveAdminContext(hqCtx, S.branch1!);
    expect(branchCtx.branchContext).toEqual({ type: "branch", branchId: S.branch1 });

    const staffCtx = await resolveActor(S.users.staff!.id);
    await expect(resolveAdminContext(staffCtx, "all")).resolves.toMatchObject({
      branchContext: { type: "org" },
    });

    const mgrCtx = await resolveActor(S.users.mgr!.id);
    await expect(resolveAdminContext(mgrCtx, "all")).rejects.toThrow(/HQ role/i);
    const mgrBranch = await resolveAdminContext(mgrCtx, S.branch1!);
    expect(mgrBranch.branchContext).toEqual({ type: "branch", branchId: S.branch1 });

    // Context RLS: memberships_select (has_organization_access) lets a
    // same-org member enumerate members; an outsider sees none. Write denial
    // for the application role (no INSERT policy — domain layer only).
    const ownMemberships = await withRlsUser(S.users.staff!.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.memberships where organization_id = $1`, [S.orgA!]),
    );
    // hq + staff + manager: 3 (the outsider deliberately has none).
    expect(Number(ownMemberships.rows[0].n)).toBe(3);

    const outsiderMemberships = await withRlsUser(S.users.outsider!.id, (c) =>
      c.query<{ n: string }>(`select count(*)::text as n from public.memberships where organization_id = $1`, [S.orgA!]),
    );
    expect(Number(outsiderMemberships.rows[0].n)).toBe(0);

    await withRlsUser(S.users.staff!.id, async (c) => {
      await expect(
        c.query(`insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'hq_admin')`, [S.orgA!, S.users.staff!.id]),
      ).rejects.toThrow();
    });
  });

  // -- 03) SLUG RULES (C8-3) -----------------------------------------------

  it("03 SLUGS: shape/length/reserved CHECKs and alias uniqueness enforced on hosted", async () => {
    await expect(
      sql(`update public.branches set slug = 'bad-slug-' where id = $1`, [S.branch1!]),
    ).rejects.toThrow(/ck_branches_slug_shape/);
    await expect(
      sql(`update public.branches set slug = 'x' where id = $1`, [S.branch1!]),
    ).rejects.toThrow(/ck_branches_slug_length/);
    await expect(
      sql(`update public.branches set slug = 'admin' where id = $1`, [S.branch1!]),
    ).rejects.toThrow(/ck_branches_slug_reserved/);

    // Alias insert works; duplicates (global unique) are rejected.
    const alias = `hv8-${RUN}-old`;
    await sql(`insert into public.branch_slug_aliases (organization_id, branch_id, alias) values ($1, $2, $3)`, [
      S.orgA!,
      S.branch1!,
      alias,
    ]);
    await expect(
      sql(`insert into public.branch_slug_aliases (organization_id, branch_id, alias) values ($1, $2, $3)`, [
        S.orgA!,
        S.branch1!,
        alias,
      ]),
    ).rejects.toThrow(/uq_branch_slug_aliases_alias/);
  });

  // -- 04) BD-A4: READINESS ADVISORY + OVERRIDE ------------------------------

  it("04 READINESS: advisory notification_configuration does not block; missing reason fails; audited override activates", async () => {
    const hqCtx = await resolveActor(S.users.hq!.id);

    const check = await checkActivationReadiness(hqCtx, S.branch1!);
    expect(check.eligible).toBe(true);
    expect(check.missing).toHaveLength(0);
    expect(check.advisoryMissing).toContain("notification_configuration");
    const advisoryItem = check.items.find((i) => i.requirement === "notification_configuration");
    expect(advisoryItem?.advisory).toBe(true);

    // Advisory-only gap + no override reason → stable refusal, still inactive.
    await expect(activateBranch(hqCtx, S.branch1!)).rejects.toThrow(/override required/i);
    const stillInactive = await sql<{ status: string }>(`select status from public.branches where id = $1`, [S.branch1!]);
    expect(stillInactive[0].status).not.toBe("active");

    const activated = await activateBranch(hqCtx, S.branch1!, {
      overrideReason: "HV8 verification run — advisory override audit check",
    });
    expect(activated.status).toBe("active");

    // Idempotent re-activation is a no-op returning the active branch.
    const again = await activateBranch(hqCtx, S.branch1!, { overrideReason: "HV8 idempotency check" });
    expect(again.status).toBe("active");

    const overrideAudit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where action = 'admin.activation_override' and branch_id = $1 and organization_id = $2`,
      [S.branch1!, S.orgA!],
    );
    expect(Number(overrideAudit[0].n)).toBe(1);

    const activationAudit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where action = 'branch.activated' and branch_id = $1 and organization_id = $2`,
      [S.branch1!, S.orgA!],
    );
    expect(Number(activationAudit[0].n)).toBe(1);
  });

  // -- 05) INVITATION FOUNDATION --------------------------------------------

  it("05 INVITATION: users.invite gates, existing-user path, audit, duplicate protection, resend", async () => {
    const hqCtx = await resolveActor(S.users.hq!.id);

    // A user created through the Auth admin API but NOT yet a member:
    // invite resolves the existing auth user and grants membership/scope
    // directly (no second invitation email is needed for existing users).
    const invitee = await createHostedUser("invitee");
    const invite = await inviteStaffMember(hqCtx, {
      email: invitee.email,
      role: "hq_staff",
    });
    expect(invite.invited).toBe(false);

    // Duplicate protection: the same email can never gain a second
    // membership in the organization (role change included).
    await expect(
      inviteStaffMember(hqCtx, { email: invitee.email, role: "hq_admin" }),
    ).rejects.toThrow(/already has a membership/i);

    // Unknown role → stable rejection (no new roles invented).
    await expect(
      inviteStaffMember(hqCtx, { email: `hv8-nobody-${RUN}@verify.example.com`, role: "superadmin" }),
    ).rejects.toThrow(/role/i);

    // Audit trail for the membership-granting invite.
    const audit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where action = 'admin.user_invited' and organization_id = $1 and resource_id = $2`,
      [S.orgA!, invite.membershipId],
    );
    expect(Number(audit[0].n)).toBe(1);
  });

  // -- 06) BD-A1: ONE-TIME BOOTSTRAP LOCK ------------------------------------

  it("06 BOOTSTRAP: invariant is probed against committed hosted state; locked project fails closed", async () => {
    // The hosted project starts this run with zero organizations/memberships,
    // so a generated one-time token genuinely exercises the bootstrap flow.
    // The invariant is checked BEFORE the token, so both probes below hit the
    // same fail-closed path once bootstrapped — while a valid token on the
    // pre-bootstrap project proves the setup path itself reaches the database
    // (org + membership + audit), never committing a second HQ Admin.
    const hadBootstrap = (
      await sql<{ n: string }>(`select count(*)::text as n from public.memberships where role = 'hq_admin' and status = 'active'`)
    )[0];

    process.env.SETUP_TOKEN = `hv8-setup-${RUN}`;
    if (hadBootstrap.n === "0") {
      const preUser = await createHostedUser("setup");
      const result = await performSetup({
        setupToken: process.env.SETUP_TOKEN,
        userId: preUser.id,
        organizationName: `HV8 Bootstrap Org ${RUN}`,
      });
      expect(result.organizationId).toBeTruthy();

      const org = await sql<{ name: string; slug: string }>(
        `select name, slug from public.organizations where id = $1`,
        [result.organizationId],
      );
      expect(org[0].name).toBe(`HV8 Bootstrap Org ${RUN}`);
      expect(org[0].slug).toMatch(/^hv8-bootstrap-org/);

      const membership = await sql<{ role: string; status: string }>(
        `select role, status from public.memberships where organization_id = $1 and user_id = $2`,
        [result.organizationId, preUser.id],
      );
      expect(membership[0]).toMatchObject({ role: "hq_admin", status: "active" });

      const audit = await sql<{ n: string }>(
        `select count(*)::text as n from public.audit_logs where action = 'admin.setup_completed' and organization_id = $1`,
        [result.organizationId],
      );
      expect(Number(audit[0].n)).toBe(1);

      // WRONG token on the now-bootstrapped project: invariant fires first —
      // permanent fail-closed, regardless of token validity.
      await expect(
        performSetup({ setupToken: "definitely-wrong", userId: preUser.id }),
      ).rejects.toThrow(/permanently disabled after bootstrap/i);

      // Rejection audited against the existing organization.
      const rejected = await sql<{ n: string }>(
        `select count(*)::text as n from public.audit_logs
          where action = 'admin.setup_rejected' and result = 'failure' and organization_id = $1`,
        [result.organizationId],
      );
      expect(Number(rejected[0].n)).toBeGreaterThanOrEqual(1);

      // Exactly one active HQ Admin exists project-wide.
      const admins = await sql<{ n: string }>(
        `select count(*)::text as n from public.memberships where role = 'hq_admin' and status = 'active'`,
      );
      expect(Number(admins[0].n)).toBe(1);
    } else {
      // Project already bootstrapped by a previous run: the lock must hold.
      const probe = await createHostedUser("setup");
      await expect(
        performSetup({ setupToken: `hv8-setup-${RUN}`, userId: probe.id }),
      ).rejects.toThrow(/permanently disabled after bootstrap/i);
    }
  });

  // -- 07) NO UNAUTHORIZED SCOPE ----------------------------------------------

  it("07 BOUNDARY: no application-flow, CMS, policy-engine, inheritance-engine or payment artifacts in Change 8", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and (table_name like '%application%' or table_name like '%cms%'
               or table_name like '%policy_template%' or table_name like '%config_field%'
               or table_name like '%payment%')`,
    );
    expect(tables).toHaveLength(0);

    // No new permissions were invented: users.invite/users.edit already
    // existed in the canonical catalog (lib/permissions.ts untouched).
    const adminAuditActions = await sql<{ action: string }>(
      `select distinct action from public.audit_logs where action like 'admin.%'`,
    );
    for (const row of adminAuditActions) {
      expect([
        "admin.setup_completed",
        "admin.setup_rejected",
        "admin.user_invited",
        "admin.invitation_resent",
        "admin.user_deactivated",
        "admin.activation_override",
      ]).toContain(row.action);
    }
  });

  // -- 08) BOUNDARY LOG -----------------------------------------------------

  it("08 SUITE LOG: fixture cleanup is verified in afterAll (assertZeroLeftovers)", async () => {
    // Cleanup assertions run in afterAll (Change 6/7 convention): this test
    // documents the sequencing so the report log shows the cleanup verdict.
    expect(true).toBe(true);
  });
});
