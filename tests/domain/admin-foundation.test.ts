/**
 * Admin foundation domain tests (Change 8, tasks 10.1; design §15 matrix).
 * Runs against real pglite + the full migration chain (0001→0014).
 *
 * Coverage: bootstrap invariant/token/concurrency/audit (BD-A1), admin
 * context resolution (C8-1/BD-A3), invitation + duplicate protection +
 * deactivation (design §11), activation readiness advisory/override
 * (BD-A4), slug global uniqueness/CHECKs/aliases (C8-3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext } from "../helpers/domain";
import { setSessionOverrideForTests } from "@/lib/session/server";
import { inviteStaffMember, deactivateStaffMember } from "@/features/admin/auth";
import { resolveAdminContext } from "@/features/admin/context";
import { evaluateReadiness, activateBranch, checkActivationReadiness } from "@/features/branches/activation";
import { getBranchById } from "@/features/branches/service";
import type { AuthContext } from "@/lib/authorization/server";
import type { TestDb } from "../helpers/db";

let t: TestDb;
let orgId: string;
let branchA: string;
let branchB: string;
let hqCtx: AuthContext;

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("Admin Test Org", "admin-test-org");
  hqCtx = await hqAdminContext(orgId, "admin-hq@test.example");
  branchA = await t.fx.createBranch(orgId, "admin-branch-a");
  branchB = await t.fx.createBranch(orgId, "admin-branch-b");
});

// ---------------------------------------------------------------------------
// BD-A1 bootstrap tests live in tests/domain/admin-bootstrap.test.ts (they
// require pre-bootstrap clean state; this file runs post-bootstrap scenarios).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// C8-1 / BD-A3: admin context resolution
// ---------------------------------------------------------------------------

describe("admin context (C8-1/BD-A3)", () => {
  it("HQ Admin may use the organization-wide context", async () => {
    const admin = await resolveAdminContext(hqCtx, "all");
    expect(admin.branchContext).toEqual({ type: "org" });
    expect(admin.organizationId).toBe(orgId);
  });

  it("HQ Admin may select an authorized branch by UUID", async () => {
    const admin = await resolveAdminContext(hqCtx, branchA);
    expect(admin.branchContext).toEqual({ type: "branch", branchId: branchA });
  });

  it("HQ context resolution fails closed for a branch of another organization", async () => {
    const otherOrg = await t.fx.createOrganization("Other Org", "other-org-slug");
    const otherBranch = await t.fx.createBranch(otherOrg, "other-org-branch");
    await expect(resolveAdminContext(hqCtx, otherBranch)).rejects.toThrow(/not accessible|scope required/i);
  });

  it("Branch Manager cannot use All Branches (fail closed)", async () => {
    const userId = await t.fx.createUser("admin-bm@test.example");
    const membershipId = await t.fx.createMembership(userId, orgId, "branch_manager");
    await t.fx.grantBranch(membershipId, branchA);
    setSessionOverrideForTests(userId);
    const { resolveActor } = await import("@/lib/authorization/server");
    const c = await resolveActor(userId);
    c.requestId = "req-bm";
    const bmCtx: AuthContext = c;

    await expect(resolveAdminContext(bmCtx, "all")).rejects.toThrow(/HQ role/i);
    setSessionOverrideForTests(hqCtx.actor.userId);
  });

  it("Branch Manager may select only a branch in membership_branches", async () => {
    const userId = await t.fx.createUser("admin-bm2@test.example");
    const membershipId = await t.fx.createMembership(userId, orgId, "branch_manager");
    await t.fx.grantBranch(membershipId, branchA);
    setSessionOverrideForTests(userId);
    const { resolveActor } = await import("@/lib/authorization/server");
    const bmCtx = await resolveActor(userId);
    bmCtx.requestId = "req-bm2";

    const ok = await resolveAdminContext(bmCtx, branchA);
    expect(ok.branchContext).toEqual({ type: "branch", branchId: branchA });

    // branchB is in the same org but NOT granted → fail closed.
    await expect(resolveAdminContext(bmCtx, branchB)).rejects.toThrow(/scope required/i);
    setSessionOverrideForTests(hqCtx.actor.userId);
  });
});

// ---------------------------------------------------------------------------
// Invitations + deactivation (design §11)
// ---------------------------------------------------------------------------

describe("invitations and deactivation", () => {
  it("rejects an unauthorized caller (no users.invite permission)", async () => {
    const userId = await t.fx.createUser("no-perm@test.example");
    const membershipId = await t.fx.createMembership(userId, orgId, "branch_manager");
    await t.fx.grantBranch(membershipId, branchA);
    setSessionOverrideForTests(userId);
    const { resolveActor } = await import("@/lib/authorization/server");
    const ctx = await resolveActor(userId);
    ctx.requestId = "req-noperm";
    await expect(
      inviteStaffMember(ctx, { email: "someone@example.com", role: "branch_manager", branchIds: [branchA] }),
    ).rejects.toThrow();
    setSessionOverrideForTests(hqCtx.actor.userId);
  });

  it("grants an existing auth user membership without a duplicate invitation, transactionally audited", async () => {
    // User already exists in auth.users (created via fixture).
    const existingUserId = await t.fx.createUser("already-exists@test.example");
    const result = await inviteStaffMember(hqCtx, {
      email: "already-exists@test.example",
      role: "branch_manager",
      branchIds: [branchA],
    });
    expect(result.invited).toBe(false);
    const scope = await t.db.query<{ branch_id: string }>(
      `select branch_id from public.membership_branches where membership_id = $1`,
      [result.membershipId],
    );
    expect(scope.rows[0].branch_id).toBe(branchA);
    const audit = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.audit_logs where action = 'admin.user_invited' and resource_id = $1`,
      [result.membershipId],
    );
    expect(Number(audit.rows[0].count)).toBe(1);
    void existingUserId;
  });

  it("prevents duplicate memberships (stable CONFLICT)", async () => {
    await expect(
      inviteStaffMember(hqCtx, { email: "already-exists@test.example", role: "hq_staff" }),
    ).rejects.toThrow(/already has a membership/i);
  });

  it("invites a brand-new user through the Supabase Auth primitive", async () => {
    // In pglite the supabase-js admin API is unavailable (no hosted Auth);
    // the service fails closed with a clear internal error rather than
    // creating a membership without an auth user.
    await expect(
      inviteStaffMember(hqCtx, { email: "brand-new@test.example", role: "hq_staff" }),
    ).rejects.toThrow(/invitation failed|supabase service configuration/i);
    const none = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.memberships m
       join auth.users u on u.id = m.user_id where lower(u.email) = 'brand-new@test.example'`,
    );
    expect(Number(none.rows[0].count)).toBe(0);
  });

  it("deactivates a membership with audit and never deletes the auth user", async () => {
    const userId = await t.fx.createUser("deactivate-me@test.example");
    const membershipId = await t.fx.createMembership(userId, orgId, "hq_staff");
    await deactivateStaffMember(hqCtx, membershipId);
    const row = await t.db.query<{ status: string }>(`select status from public.memberships where id = $1`, [
      membershipId,
    ]);
    expect(row.rows[0].status).toBe("inactive");
    const user = await t.db.query<{ id: string }>(`select id from auth.users where id = $1`, [userId]);
    expect(user.rows.length).toBe(1); // auth user retained
    const audit = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.audit_logs where action = 'admin.user_deactivated' and resource_id = $1`,
      [membershipId],
    );
    expect(Number(audit.rows[0].count)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BD-A4: activation readiness
// ---------------------------------------------------------------------------

describe("activation readiness (BD-A4)", () => {
  function mandatories(branch: Awaited<ReturnType<typeof getBranchById>>): Promise<string[]> {
    return evaluateReadiness(branch as never).then((items) =>
      items.filter((i) => !i.satisfied && !i.advisory).map((i) => i.requirement),
    );
  }

  it("notification_configuration is advisory and never blocks", async () => {
    const branch = await getBranchById(branchA);
    const items = await evaluateReadiness(branch as never);
    const notif = items.find((i) => i.requirement === "notification_configuration");
    expect(notif?.advisory).toBe(true);
    expect((await mandatories(branch))).not.toContain("notification_configuration");
  });

  it("mandatory missing items block activation and cannot be overridden", async () => {
    const branch = await getBranchById(branchA);
    const missing = await mandatories(branch);
    expect(missing.length).toBeGreaterThan(0); // fresh branch lacks services/pricing/etc.
    await expect(
      activateBranch(hqCtx, branchA, { overrideReason: "trying to override mandatory gaps" }),
    ).rejects.toThrow(/requirements not met/i);
  });

  it("checkActivationReadiness reports advisory items separately", async () => {
    const result = await checkActivationReadiness(hqCtx, branchA);
    expect(result.advisoryMissing).toContain("notification_configuration");
    expect(result.missing).not.toContain("notification_configuration");
  });
});

// ---------------------------------------------------------------------------
// C8-3: slug routing identity
// ---------------------------------------------------------------------------

describe("slug alignment (C8-3)", () => {
  it("enforces global slug uniqueness across organizations", async () => {
    const otherOrg = await t.fx.createOrganization("Slug Org", "slug-org");
    await expect(t.fx.createBranch(otherOrg, "admin-branch-a")).rejects.toThrow();
  });

  it("archived branches retain slug reservation", async () => {
    const slugOrg = await t.fx.createOrganization("Archive Slug Org", "archive-slug-org");
    const temp = await t.fx.createBranch(slugOrg, "reserved-slug-x");
    await t.db.query(`update public.branches set status = 'archived', archived_at = now() where id = $1`, [temp]);
    await expect(t.fx.createBranch(slugOrg, "reserved-slug-x")).rejects.toThrow();
  });

  it("enforces shape/length CHECKs", async () => {
    const slugOrg = await t.fx.createOrganization("Shape Org", "shape-org");
    await expect(t.fx.createBranch(slugOrg, "ab")).resolves.toBeTruthy(); // 2 chars ok
    await expect(t.fx.createBranch(slugOrg, "a")).rejects.toThrow(); // too short
    await expect(t.fx.createBranch(slugOrg, "-leading")).rejects.toThrow(); // edge hyphen
    await expect(t.fx.createBranch(slugOrg, "dou--ble")).rejects.toThrow(); // double hyphen
    await expect(t.fx.createBranch(slugOrg, "UPPER")).rejects.toThrow(); // normalization
  });

  it("rejects reserved words", async () => {
    const slugOrg = await t.fx.createOrganization("Reserved Org", "reserved-org");
    await expect(t.fx.createBranch(slugOrg, "admin")).rejects.toThrow();
    await expect(t.fx.createBranch(slugOrg, "cleaner")).rejects.toThrow();
    await expect(t.fx.createBranch(slugOrg, "login")).rejects.toThrow();
  });

  it("branch_slug_aliases: unique globally, same validation, RLS enabled", async () => {
    const aliasOrg = await t.fx.createOrganization("Alias Org", "alias-org");
    const b = await t.fx.createBranch(aliasOrg, "alias-target");
    await t.db.query(
      `insert into public.branch_slug_aliases (organization_id, branch_id, alias) values ($1, $2, 'old-slug-1')`,
      [aliasOrg, b],
    );
    // Globally unique alias.
    await expect(
      t.db.query(
        `insert into public.branch_slug_aliases (organization_id, branch_id, alias) values ($1, $2, 'old-slug-1')`,
        [aliasOrg, b],
      ),
    ).rejects.toThrow();
    // Reserved words rejected on aliases too.
    await expect(
      t.db.query(
        `insert into public.branch_slug_aliases (organization_id, branch_id, alias) values ($1, $2, 'admin')`,
        [aliasOrg, b],
      ),
    ).rejects.toThrow();
    // RLS enabled.
    const rls = await t.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'branch_slug_aliases'`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});
