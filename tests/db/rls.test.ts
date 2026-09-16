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

describe("RLS: service catalog (task 3.2)", () => {
  // Catalog fixture rows, inserted as harness (privileged client) — the same
  // way the application's privileged server client writes catalog data after
  // application-level authorization.
  let catA1: string, svcA1: string, svcA2: string, addonA1: string, compatA1: string;
  let catB1: string, svcB1: string;

  beforeAll(async () => {
    const cat = async (org: string, branch: string, slug: string): Promise<string> =>
      (
        await t.db.query<{ id: string }>(
          `insert into public.service_categories (organization_id, branch_id, slug, name)
           values ($1, $2, $3, $4) returning id`,
          [org, branch, slug, `Cat ${slug}`],
        )
      ).rows[0].id;
    const svc = async (org: string, branch: string, category: string, slug: string): Promise<string> =>
      (
        await t.db.query<{ id: string }>(
          `insert into public.services (organization_id, branch_id, category_id, slug, name)
           values ($1, $2, $3, $4, $5) returning id`,
          [org, branch, category, slug, `Svc ${slug}`],
        )
      ).rows[0].id;

    catA1 = await cat(orgA, branchA1, "rls-cat-a1");
    svcA1 = await svc(orgA, branchA1, catA1, "rls-svc-a1");
    svcA2 = await svc(orgA, branchA2, catA1, "rls-svc-a2"); // same org, other branch
    catB1 = await cat(orgB, branchB1, "rls-cat-b1");
    svcB1 = await svc(orgB, branchB1, catB1, "rls-svc-b1");

    addonA1 = (
      await t.db.query<{ id: string }>(
        `insert into public.service_addons (organization_id, branch_id, slug, name)
         values ($1, $2, 'rls-addon-a1', 'Addon A1') returning id`,
        [orgA, branchA1],
      )
    ).rows[0].id;
    compatA1 = (
      await t.db.query<{ id: string }>(
        `insert into public.service_addon_compatibility
           (organization_id, branch_id, service_addon_id, service_id)
         values ($1, $2, $3, $4) returning id`,
        [orgA, branchA1, addonA1, svcA1],
      )
    ).rows[0].id;

    // Translation + alias on the branchA1 service.
    await t.db.query(
      `insert into public.service_translations (service_id, locale, name)
       values ($1, 'de', 'RLS Service DE')`,
      [svcA1],
    );
    await t.db.query(
      `insert into public.service_slug_aliases
         (organization_id, branch_id, entity_type, entity_id, old_slug)
       values ($1, $2, 'service', $3, 'rls-old-slug')`,
      [orgA, branchA1, svcA1],
    );
  });

  it("HQ admin reads own organization catalog", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.services`);
      expect(res.rows.map((r) => r.id).sort()).toEqual([svcA1, svcA2].sort());
    });
  });

  it("HQ admin cannot read another organization's catalog by known ID", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const probe = await t.db.query(`select * from public.services where id = $1`, [svcB1]);
      expect(probe.rows).toHaveLength(0);
      const catProbe = await t.db.query(`select * from public.service_categories where id = $1`, [catB1]);
      expect(catProbe.rows).toHaveLength(0);
    });
  });

  it("branch manager reads only the assigned branch's catalog rows", async () => {
    const scopedUser = await t.db.query<{ user_id: string }>(
      `select user_id from public.memberships where id = $1`, [membershipA],
    );
    const uid = scopedUser.rows[0].user_id;
    await asAuthenticatedUser(t.db, uid, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.services`);
      expect(res.rows.map((r) => r.id)).toEqual([svcA1]); // branchA2's row invisible
    });
  });

  it("branch manager cannot read another branch by manipulating the id", async () => {
    const scopedUser = await t.db.query<{ user_id: string }>(
      `select user_id from public.memberships where id = $1`, [membershipA],
    );
    const uid = scopedUser.rows[0].user_id;
    await asAuthenticatedUser(t.db, uid, async () => {
      const probe = await t.db.query(`select * from public.services where id = $1`, [svcA2]);
      expect(probe.rows).toHaveLength(0);
    });
  });

  it("cleaner cannot read catalog: no HQ role, no branch scope, no other-org access", async () => {
    // Catalog visibility requires HQ role or explicit branch scope. A cleaner
    // has neither, so RLS hides every catalog row — including their own org's
    // (application-layer services.view gates reads on top of this).
    const cleanerB = await t.fx.createUser("rls-cleaner@b.test");
    await t.fx.createMembership(cleanerB, orgB, "cleaner");
    await asAuthenticatedUser(t.db, cleanerB, async () => {
      const probe = await t.db.query(`select * from public.services where id = $1`, [svcA1]);
      expect(probe.rows).toHaveLength(0); // other-org probe invisible
      const own = await t.db.query<{ id: string }>(`select id from public.services`);
      expect(own.rows).toHaveLength(0); // even own-org rows: no branch scope
    });

    // With an explicit branch grant, the RLS model permits branch-scoped
    // visibility; the application permission layer remains the first gate.
    const cleanerMembership = await t.db.query<{ id: string }>(
      `select id from public.memberships where user_id = $1`, [cleanerB],
    );
    await t.fx.grantBranch(cleanerMembership.rows[0].id, branchB1);
    await asAuthenticatedUser(t.db, cleanerB, async () => {
      const own = await t.db.query<{ id: string }>(`select id from public.services`);
      expect(own.rows.map((r) => r.id)).toEqual([svcB1]);
    });
  });

  it("anonymous sees no catalog rows", async () => {
    await asAuthenticatedUser(t.db, null, async () => {
      const res = await t.db.query(`select id from public.services`);
      expect(res.rows).toHaveLength(0);
      const cats = await t.db.query(`select id from public.service_categories`);
      expect(cats.rows).toHaveLength(0);
    });
  });

  it("translation tables inherit the parent entity's scope", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ service_id: string }>(
        `select service_id from public.service_translations`,
      );
      expect(res.rows.map((r) => r.service_id)).toEqual([svcA1]);
    });
    await asAuthenticatedUser(t.db, mgrB, async () => {
      const res = await t.db.query(`select service_id from public.service_translations`);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("compatibility rows cannot leak across branches", async () => {
    const scopedUser = await t.db.query<{ user_id: string }>(
      `select user_id from public.memberships where id = $1`, [membershipA],
    );
    const uid = scopedUser.rows[0].user_id;
    await asAuthenticatedUser(t.db, uid, async () => {
      const res = await t.db.query<{ id: string }>(
        `select id from public.service_addon_compatibility`,
      );
      expect(res.rows.map((r) => r.id)).toEqual([compatA1]);
    });
    await asAuthenticatedUser(t.db, mgrB, async () => {
      const res = await t.db.query(`select id from public.service_addon_compatibility`);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("slug aliases are scoped to the owning organization and branch", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ old_slug: string }>(
        `select old_slug from public.service_slug_aliases`,
      );
      expect(res.rows.map((r) => r.old_slug)).toEqual(["rls-old-slug"]);
    });
    await asAuthenticatedUser(t.db, mgrB, async () => {
      const res = await t.db.query(`select old_slug from public.service_slug_aliases`);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("writes remain denied through the authenticated RLS path", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      await expect(
        t.db.query(
          `insert into public.service_categories (organization_id, branch_id, slug, name)
           values ($1, $2, 'rls-hijack', 'Hijack')`,
          [orgA, branchA1],
        ),
      ).rejects.toThrow();
      await expect(
        t.db.query(`update public.services set status = 'archived'`),
      ).rejects.toThrow();
      await expect(t.db.query(`delete from public.services`)).rejects.toThrow();
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
