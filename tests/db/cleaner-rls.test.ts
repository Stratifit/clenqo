/**
 * Cleaner execution RLS tests (Change 7, tasks 10.1/12.2; design §12).
 * Executes the REAL 0013 policies as the `authenticated` role with auth.uid().
 *
 * Coverage: checklist_templates (staff/branch-manager scope; no cleaner
 * read of unpublished templates), job_checklist_snapshots/items and
 * job_media (cleaner sees only own-active-assignment jobs; cross-cleaner
 * denial; org isolation), no application-role write policies (mutation
 * denial), migrated execution-timestamp columns present.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb, asAuthenticatedUser, type TestDb } from "../helpers/db";

let t: TestDb;
let orgA: string, orgB: string;
let hqA: string, cleanerUid: string, otherCleanerUid: string;
let branchA: string;
let membershipA: string;
let employeeCleaner: string, employeeOther: string;
let jobCleaner: string, jobOther: string;
let svcA: string;

async function insertEmployee(org: string, firstName: string, userId: string | null): Promise<string> {
  const res = await t.db.query<{ id: string }>(
    `insert into public.employees (organization_id, employee_number, first_name, last_name, user_id)
     values ($1, 'EMP-' || lpad((floor(random() * 899999) + 100000)::text, 6, '0'), $2, 'Rls', $3)
     returning id`,
    [org, firstName, userId],
  );
  return res.rows[0].id;
}

async function linkBranch(employee: string, branch: string): Promise<void> {
  await t.db.query(
    `insert into public.employee_branches (organization_id, employee_id, branch_id)
     select organization_id, id, $2 from public.employees where id = $1`,
    [employee, branch],
  );
}

async function insertJob(org: string, branch: string, number: string): Promise<string> {
  const res = await t.db.query<{ id: string }>(
    `insert into public.jobs (organization_id, branch_id, job_number, scheduled_start, scheduled_end, timezone, job_snapshot)
     values ($1, $2, $3, now() + interval '7 days', now() + interval '8 days', 'Europe/Berlin', '{}'::jsonb)
     returning id`,
    [org, branch, number],
  );
  return res.rows[0].id;
}

async function assign(employee: string, job: string, org: string, branch: string): Promise<void> {
  await t.db.query(
    `insert into public.job_assignments (organization_id, branch_id, job_id, employee_id, assignment_status)
     values ($1, $2, $3, $4, 'active')`,
    [org, branch, job, employee],
  );
}

beforeAll(async () => {
  t = await getTestDb();

  orgA = await t.fx.createOrganization("Cleaner RLS A", "cleaner-rls-a");
  orgB = await t.fx.createOrganization("Cleaner RLS B", "cleaner-rls-b");

  hqA = await t.fx.createUser("cleaner-rls-hq@a.test");
  await t.fx.createMembership(hqA, orgA, "hq_admin");

  cleanerUid = await t.fx.createUser("cleaner-rls-c1@a.test");
  await t.fx.createMembership(cleanerUid, orgA, "cleaner");
  otherCleanerUid = await t.fx.createUser("cleaner-rls-c2@a.test");
  await t.fx.createMembership(otherCleanerUid, orgA, "cleaner");

  branchA = await t.fx.createBranch(orgA, "crls-berlin");
  await t.fx.createBranch(orgB, "crls-koeln");

  membershipA = await t.fx.createMembership(await t.fx.createUser("cleaner-rls-mgr@a.test"), orgA, "branch_manager");
  await t.fx.grantBranch(membershipA, branchA);

  // Service for templates (create category first — services.category_id NOT NULL).
  const catId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
       values ($1, $2, 'crls-cat', 'Cat', 'active', true) returning id`,
      [orgA, branchA],
    )
  ).rows[0].id;
  svcA = (
    await t.db.query<{ id: string }>(
      `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
       values ($1, $2, $3, 'crls-svc', 'Svc', 'active', true) returning id`,
      [orgA, branchA, catId],
    )
  ).rows[0].id;

  employeeCleaner = await insertEmployee(orgA, "LinkedC", cleanerUid);
  await linkBranch(employeeCleaner, branchA);
  employeeOther = await insertEmployee(orgA, "OtherC", otherCleanerUid);
  await linkBranch(employeeOther, branchA);

  jobCleaner = await insertJob(orgA, branchA, "JOB-2027-700001");
  jobOther = await insertJob(orgA, branchA, "JOB-2027-700002");
  await assign(employeeCleaner, jobCleaner, orgA, branchA);
  await assign(employeeOther, jobOther, orgA, branchA);
});

describe("RLS: checklist_templates (0013)", () => {
  it("HQ admin sees org templates; branch manager sees branch rows; cleaner sees none", async () => {
    await t.db.query(
      `insert into public.checklist_templates (organization_id, branch_id, service_id, version, status, name, items)
       values ($1, $2, $3, 1, 'published', 'RlsTpl', '[]'::jsonb)`,
      [orgA, branchA, svcA],
    );

    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ n: string }>(`select count(*)::text as n from public.checklist_templates`);
      expect(Number(res.rows[0].n)).toBe(1);
    });

    const mgrUid = (await t.db.query<{ user_id: string }>(`select user_id from public.memberships where id = $1`, [membershipA])).rows[0].user_id;
    await asAuthenticatedUser(t.db, mgrUid, async () => {
      const res = await t.db.query<{ n: string }>(`select count(*)::text as n from public.checklist_templates where branch_id = $1`, [branchA]);
      expect(Number(res.rows[0].n)).toBe(1);
    });

    await asAuthenticatedUser(t.db, cleanerUid, async () => {
      const res = await t.db.query<{ n: string }>(`select count(*)::text as n from public.checklist_templates`);
      expect(Number(res.rows[0].n)).toBe(0);
    });
  });
});

describe("RLS: snapshots / items / media (cleaner own-active-assignment)", () => {
  it("cleaner sees snapshot/items/media only for their own assigned job", async () => {
    // Snapshot + item on the cleaner's job and the other cleaner's job.
    for (const [job, tplVersion] of [[jobCleaner, 11], [jobOther, 12]] as const) {
      const snapId = (
        await t.db.query<{ id: string }>(
          `insert into public.job_checklist_snapshots (organization_id, branch_id, job_id, template_version, snapshot)
           values ($1, $2, $3, $4, '[]'::jsonb) returning id`,
          [orgA, branchA, job, tplVersion],
        )
      ).rows[0].id;
      await t.db.query(
        `insert into public.job_checklist_items (organization_id, branch_id, job_id, snapshot_id, item_key, label, mandatory)
         values ($1, $2, $3, $4, 'k1', 'Item', true)`,
        [orgA, branchA, job, snapId],
      );
    }
    await t.db.query(
      `insert into public.job_media (organization_id, branch_id, job_id, category, storage_path)
       values ($1, $2, $3, 'before', 'jobs/a/b/c/before/x.jpg')`,
      [orgA, branchA, jobCleaner],
    );

    await asAuthenticatedUser(t.db, cleanerUid, async () => {
      const snaps = await t.db.query<{ job_id: string }>(`select job_id from public.job_checklist_snapshots`);
      expect(snaps.rows.map((r) => r.job_id)).toEqual([jobCleaner]);

      const items = await t.db.query<{ job_id: string }>(`select job_id from public.job_checklist_items`);
      expect(items.rows.map((r) => r.job_id)).toEqual([jobCleaner]);

      const media = await t.db.query<{ job_id: string }>(`select job_id from public.job_media`);
      expect(media.rows.map((r) => r.job_id)).toEqual([jobCleaner]);
    });
  });

  it("org isolation: cross-org HQ sees nothing on new tables", async () => {
    const hqB = await t.fx.createUser("cleaner-rls-hq@b.test");
    await t.fx.createMembership(hqB, orgB, "hq_admin");
    await asAuthenticatedUser(t.db, hqB, async () => {
      for (const table of ["job_checklist_snapshots", "job_checklist_items", "job_media"]) {
        const res = await t.db.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
        expect(Number(res.rows[0].n)).toBe(0);
      }
    });
  });

  it("no application-role write policies: inserts denied as authenticated", async () => {
    await asAuthenticatedUser(t.db, cleanerUid, async () => {
      await expect(
        t.db.query(
          `insert into public.job_media (organization_id, branch_id, job_id, category, storage_path)
           values ($1, $2, $3, 'after', 'jobs/x/y/z/after/y.jpg')`,
          [orgA, branchA, jobCleaner],
        ),
      ).rejects.toThrow();
    });
  });
});

describe("schema: execution timestamps (0013)", () => {
  it("adds the five execution columns and widens job_events (en_route, checklist_completed)", async () => {
    const cols = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'jobs' and column_name in
       ('en_route_at','checked_in_at','checked_out_at','actual_start','actual_end')`,
    );
    expect(cols.rows).toHaveLength(5);

    const check = await t.db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'job_events_event_type_check'`,
    );
    expect(check.rows[0].def).toContain("en_route");
    expect(check.rows[0].def).toContain("checklist_completed");

    // No location/signature artifacts (BD-C6/BD-C8).
    const forbidden = await t.db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.columns
       where table_schema = 'public' and (column_name like '%location%' or column_name like '%gps%'
         or column_name like '%coordinate%' or column_name like '%signature%')`,
    );
    expect(Number(forbidden.rows[0].n)).toBe(0);
  });
});
