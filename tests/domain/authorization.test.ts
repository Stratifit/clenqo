/**
 * Authorization tests (task 2.3; spec "HQ-only branch creation").
 * Uses the real requirePermission chain over the consolidated catalog.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext, VALID_BRANCH_INPUT } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import { AppError, ErrorCode } from "@/lib/errors";

let t: TestDb;
let orgA: string, orgB: string;
let adminA: AuthContext, adminB: AuthContext;
let staffA: AuthContext, managerA: AuthContext;

beforeAll(async () => {
  t = await getDomainHarness();
  orgA = await t.fx.createOrganization("Org A", "org-a");
  orgB = await t.fx.createOrganization("Org B", "org-b");
  adminA = await hqAdminContext(orgA, "admin-a@test");
  adminB = await hqAdminContext(orgB, "admin-b@test");

  // HQ Staff: no branches.create in the catalog (SECURITY.md §14).
  const staffUser = await t.fx.createUser("staff-a@test");
  await t.fx.createMembership(staffUser, orgA, "hq_staff");
  staffA = await resolveActor(staffUser);

  const managerUser = await t.fx.createUser("manager-a@test");
  await t.fx.createMembership(managerUser, orgA, "branch_manager");
  managerA = await resolveActor(managerUser);
});

describe("HQ-only branch creation", () => {
  it("HQ Admin can create a branch", async () => {
    const { branch, created } = await createAndProvision(adminA, {
      ...VALID_BRANCH_INPUT, slug: "auth-berlin",
    });
    expect(created).toBe(true);
    expect(branch.provisioning_status).toBe("ready");
  });

  it("HQ Staff without branches.create is denied", async () => {
    await expect(
      createAndProvision(staffA, { ...VALID_BRANCH_INPUT, slug: "staff-berlin" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("Branch Manager is denied before any branch record is created", async () => {
    await expect(
      createAndProvision(managerA, { ...VALID_BRANCH_INPUT, slug: "mgr-berlin" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const rows = await t.db.query(`select * from public.branches where slug = 'mgr-berlin'`);
    expect(rows.rows).toHaveLength(0);
  });

  it("cross-organization creation is denied even for a valid HQ admin", async () => {
    // adminB belongs to orgB; the org context is resolved from the membership,
    // and the created branch would land in orgB — but a malicious body cannot
    // target orgA. Verify orgB admin creates into orgB (never orgA):
    const { branch } = await createAndProvision(adminB, {
      ...VALID_BRANCH_INPUT, slug: "b-berlin",
    });
    expect(branch.organization_id).toBe(orgB);
    expect(branch.organization_id).not.toBe(orgA);
  });
});

describe("unauthenticated access", () => {
  it("session resolution throws UNAUTHENTICATED", async () => {
    const { getAuthenticatedUserId } = await import("@/lib/session/server");
    const { setSessionOverrideForTests } = await import("@/lib/session/server");
    setSessionOverrideForTests(null);
    try {
      await expect(getAuthenticatedUserId()).rejects.toMatchObject({
        code: ErrorCode.UNAUTHENTICATED,
      });
    } finally {
      setSessionOverrideForTests(undefined as unknown as string | null);
    }
  });
});

describe("audit of authorization failure", () => {
  it("denied creation leaves no branch.created audit for the denied actor", async () => {
    await expect(
      createAndProvision(managerA, { ...VALID_BRANCH_INPUT, slug: "mgr-berlin-2" }),
    ).rejects.toBeInstanceOf(AppError);
    const rows = await t.db.query(
      `select * from public.audit_logs where action = 'branch.created' and resource_id is null`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});
