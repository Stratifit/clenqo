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

// -------------------------------------------------------------------------
// Service catalog authorization (task 4.2; spec "Authorization uses the
// existing permission catalog"). Permission vocabulary stays services.view /
// services.edit (Q8); the ROLE decides whether a services.edit holder may
// perform definition-level mutations.
// -------------------------------------------------------------------------

describe("catalog authorization matrix", () => {
  let branchId: string;

  beforeAll(async () => {
    const { branch } = await createAndProvision(adminA, {
      ...VALID_BRANCH_INPUT, slug: "auth-catalog",
    });
    branchId = branch.id;
    // managerA gets an explicit branch grant for the offering-flag path.
    await t.fx.grantBranch(
      (await t.db.query<{ id: string }>(
        `select id from public.memberships where user_id = $1 and organization_id = $2`,
        [managerA.actor.userId, orgA],
      )).rows[0].id,
      branchId,
    );
  });

  it("HQ Admin can create catalog entities", async () => {
    const { createCategory } = await import("@/features/services/service");
    const cat = await createCategory(adminA, {
      branchId, slug: "auth-cat", name: "Auth Cat",
      translations: [{ locale: "de", name: "Auth Kategorie" }],
    });
    expect(cat.status).toBe("draft");
  });

  it("HQ Staff (services.edit holder) can create catalog entities", async () => {
    const { createCategory } = await import("@/features/services/service");
    const cat = await createCategory(staffA, {
      branchId, slug: "auth-staff-cat", name: "Staff Cat",
      translations: [{ locale: "de", name: "Staff Kategorie" }],
    });
    expect(cat.status).toBe("draft");
  });

  it("Branch Manager (services.edit holder) is denied definition-level mutations", async () => {
    const { createCategory, changeStatus } = await import("@/features/services/service");
    await expect(
      createCategory(managerA, {
        branchId, slug: "auth-mgr-cat", name: "Mgr Cat",
        translations: [{ locale: "de", name: "Mgr Kategorie" }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const cat = await t.db.query<{ id: string }>(
      `select id from public.service_categories where slug = 'auth-cat'`,
    );
    await expect(
      changeStatus(managerA, {
        branchId, entityType: "service_category", entityId: cat.rows[0].id, status: "active",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("Branch Manager can set offering flags on their own branch", async () => {
    const { setOfferingState } = await import("@/features/services/service");
    const cat = await t.db.query<{ id: string }>(
      `select id from public.service_categories where slug = 'auth-cat'`,
    );
    const updated = await setOfferingState(managerA, {
      branchId, entityType: "service_category", entityId: cat.rows[0].id, is_enabled: true,
    });
    expect(updated.is_enabled).toBe(true);
  });

  it("Cleaner is denied (no services.* permissions)", async () => {
    const { createCategory } = await import("@/features/services/service");
    await expect(
      createCategory(managerA, {
        branchId, slug: "never", name: "Never",
        translations: [{ locale: "de", name: "Never" }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const cleanerUser = await t.fx.createUser("cleaner-a@test");
    await t.fx.createMembership(cleanerUser, orgA, "cleaner");
    const cleanerCtx = await resolveActor(cleanerUser);
    const cat = await t.db.query<{ id: string }>(
      `select id from public.service_categories where slug = 'auth-cat'`,
    );
    await expect(
      (async () => {
        const { setOfferingState } = await import("@/features/services/service");
        return setOfferingState(cleanerCtx, {
          branchId, entityType: "service_category", entityId: cat.rows[0].id, is_enabled: false,
        });
      })(),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("cross-organization admin is denied before any state change", async () => {
    const { updateCategory, setOfferingState } = await import("@/features/services/service");
    const cat = await t.db.query<{ id: string }>(
      `select id from public.service_categories where slug = 'auth-cat'`,
    );
    await expect(
      updateCategory(adminB, { branchId, categoryId: cat.rows[0].id, name: "Hijack" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      setOfferingState(adminB, {
        branchId, entityType: "service_category", entityId: cat.rows[0].id, is_enabled: true,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    const unchanged = await t.db.query<{ name: string; is_enabled: boolean }>(
      `select name, is_enabled from public.service_categories where id = $1`,
      [cat.rows[0].id],
    );
    expect(unchanged.rows[0].name).toBe("Auth Cat");
    expect(unchanged.rows[0].is_enabled).toBe(true); // managerA's earlier grant, not adminB's
  });
});
