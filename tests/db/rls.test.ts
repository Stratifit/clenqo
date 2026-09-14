/**
 * RLS & isolation tests (tasks 1.7, 7.1, 7.2, 7.4).
 * Executes the REAL policies as the `authenticated` role with auth.uid() set.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb, asAuthenticatedUser, type TestDb } from "../helpers/db";

let t: TestDb;
let orgA: string, orgB: string;
let hqA: string, mgrB: string;
let branchA1: string, branchA2: string, branchB1: string;
let membershipA: string;

beforeAll(async () => {
  t = await getTestDb();

  orgA = await t.fx.createOrganization("CLENQO A", "clenqo-a");
  orgB = await t.fx.createOrganization("CLENQO B", "clenqo-b");

  hqA = await t.fx.createUser("hq@a.test");
  await t.fx.createMembership(hqA, orgA, "hq_admin");

  const userB = await t.fx.createUser("manager@b.test");
  await t.fx.createMembership(userB, orgB, "branch_manager");
  mgrB = userB;

  branchA1 = await t.fx.createBranch(orgA, "berlin");
  branchA2 = await t.fx.createBranch(orgA, "hamburg");
  branchB1 = await t.fx.createBranch(orgB, "koeln");

  membershipA = await t.fx.createMembership(
    await t.fx.createUser("mgr@a.test"),
    orgA,
    "branch_manager",
  );
  await t.fx.grantBranch(membershipA, branchA1);
});

describe("RLS: organizations", () => {
  it("HQ admin sees only their organization", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.organizations`);
      expect(res.rows.map((r) => r.id)).toEqual([orgA]);
    });
  });

  it("unauthenticated sees nothing", async () => {
    await asAuthenticatedUser(t.db, null, async () => {
      const res = await t.db.query(`select id from public.organizations`);
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("RLS: branches", () => {
  it("HQ admin sees all branches of their organization", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.branches`);
      expect(res.rows.map((r) => r.id).sort()).toEqual([branchA1, branchA2].sort());
    });
  });

  it("branch manager sees only branches with membership_branches rows", async () => {
    await asAuthenticatedUser(t.db, mgrB, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.branches`);
      // mgrB has no membership_branches rows yet
      expect(res.rows).toHaveLength(0);
    });
  });

  it("branch-scoped manager cannot read another branch by manipulating the id", async () => {
    // (Grant scope to branchA1 only — already granted in beforeAll.)
    const scopedUser = await t.db.query<{ user_id: string }>(
      `select user_id from public.memberships where id = $1`,
      [membershipA],
    );
    const uid = scopedUser.rows[0].user_id;

    await asAuthenticatedUser(t.db, uid, async () => {
      const visible = await t.db.query<{ id: string }>(`select id from public.branches`);
      expect(visible.rows.map((r) => r.id)).toEqual([branchA1]);

      // Direct probe of branchA2 by id → no rows.
      const probe = await t.db.query(`select * from public.branches where id = $1`, [branchA2]);
      expect(probe.rows).toHaveLength(0);
    });
  });

  it("cross-organization data is invisible regardless of known ids", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const probe = await t.db.query(`select * from public.branches where id = $1`, [branchB1]);
      expect(probe.rows).toHaveLength(0);
    });
  });
});

describe("RLS: website tables follow branch scope", () => {
  it("website rows are visible only within the organization", async () => {
    // Provision content for branchA1 directly (fixture-level).
    const site = await t.db.query<{ id: string }>(
      `insert into public.branch_websites (branch_id, default_locale)
       values ($1, 'de') returning id`,
      [branchA1],
    );
    const websiteId = site.rows[0].id;

    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.branch_websites`);
      expect(res.rows.map((r) => r.id)).toEqual([websiteId]);
    });

    await asAuthenticatedUser(t.db, mgrB, async () => {
      const res = await t.db.query(`select id from public.branch_websites`);
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("RLS: audit immutability", () => {
  it("application role cannot modify or delete audit records", async () => {
    // Insert as harness (privileged) — the app writes via the privileged client.
    await t.db.query(
      `insert into public.audit_logs (organization_id, action, resource_type)
       values ($1, 'branch.created', 'branch')`,
      [orgA],
    );

    // Each assertion in its own context: a failed statement aborts its
    // transaction, so update/delete/select must not share one.
    await asAuthenticatedUser(t.db, hqA, async () => {
      await expect(
        t.db.query(`update public.audit_logs set action = 'tampered'`),
      ).rejects.toThrow();
    });
    await asAuthenticatedUser(t.db, hqA, async () => {
      await expect(
        t.db.query(`delete from public.audit_logs`),
      ).rejects.toThrow();
    });
    await asAuthenticatedUser(t.db, hqA, async () => {
      // Read is allowed for members (scoped).
      const res = await t.db.query<{ action: string }>(
        `select action from public.audit_logs`,
      );
      expect(res.rows[0].action).toBe("branch.created");
    });
  });
});
