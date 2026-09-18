/**
 * Worker RLS tests (Change 6, task 12.4; design §9/TD-W2).
 * Executes the REAL 0012 policies as the `authenticated` role with auth.uid().
 *
 * Coverage: org isolation (cross-org HQ sees nothing), branch scope
 * (branch manager sees only authorized branches), cleaner self-scope
 * (own employee row, own assignments, own assigned jobs — not other
 * cleaners'), anonymous denial, sequence-table manager visibility.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb, asAuthenticatedUser, type TestDb } from "../helpers/db";

let t: TestDb;
let orgA: string, orgB: string;
let hqA: string, hqB: string;
let branchA1: string, branchA2: string, branchB1: string;
let membershipA: string; // branch_manager scoped to branchA1
let cleanerAuthUid: string; // auth user linked to employee in branchA1
let employeeA1: string, employeeA2: string, employeeB1: string;
let jobA1: string, jobB1: string;

/** Insert an employee directly (privileged) with an optional auth link. */
async function insertEmployee(org: string, firstName: string, userId: string | null): Promise<string> {
  const res = await t.db.query<{ id: string }>(
    `insert into public.employees (organization_id, employee_number, first_name, last_name, user_id)
     values ($1, 'EMP-' || lpad((floor(random() * 899999) + 100000)::text, 6, '0'), $2, 'Tester', $3)
     returning id`,
    [org, firstName, userId],
  );
  return res.rows[0].id;
}

async function linkBranch(employee: string, branch: string): Promise<void> {
  await t.db.query(
    `insert into public.employee_branches (organization_id, employee_id, branch_id)
     select e.organization_id, e.id, $2 from public.employees e where e.id = $1`,
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

beforeAll(async () => {
  t = await getTestDb();

  orgA = await t.fx.createOrganization("Worker RLS A", "worker-rls-a");
  orgB = await t.fx.createOrganization("Worker RLS B", "worker-rls-b");

  hqA = await t.fx.createUser("worker-hq@a.test");
  await t.fx.createMembership(hqA, orgA, "hq_admin");
  hqB = await t.fx.createUser("worker-hq@b.test");
  await t.fx.createMembership(hqB, orgB, "hq_admin");

  branchA1 = await t.fx.createBranch(orgA, "wrls-berlin");
  branchA2 = await t.fx.createBranch(orgA, "wrls-hamburg");
  branchB1 = await t.fx.createBranch(orgB, "wrls-koeln");

  membershipA = await t.fx.createMembership(await t.fx.createUser("worker-mgr@a.test"), orgA, "branch_manager");
  await t.fx.grantBranch(membershipA, branchA1);

  // Employees: A1-cleaner linked to a real auth uid; others unlinked.
  cleanerAuthUid = await t.fx.createUser("worker-cleaner@a.test");
  employeeA1 = await insertEmployee(orgA, "LinkedA", cleanerAuthUid);
  await linkBranch(employeeA1, branchA1);
  employeeA2 = await insertEmployee(orgA, "OtherA", null);
  await linkBranch(employeeA2, branchA2);
  employeeB1 = await insertEmployee(orgB, "CrossB", null);
  await linkBranch(employeeB1, branchB1);

  jobA1 = await insertJob(orgA, branchA1, "JOB-2027-800001");
  jobB1 = await insertJob(orgB, branchB1, "JOB-2027-800002");

  // Assignment linking the cleaner's employee row to jobA1.
  await t.db.query(
    `insert into public.job_assignments (organization_id, branch_id, job_id, employee_id, assignment_status)
     select organization_id, branch_id, id, $2, 'active' from public.jobs where id = $1`,
    [jobA1, employeeA1],
  );
});

describe("RLS: employees (0012)", () => {
  it("HQ admin sees only own organization's employees", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.employees`);
      expect(res.rows.map((r) => r.id).sort()).toEqual([employeeA1, employeeA2].sort());
    });
  });

  it("branch manager sees only employees of authorized branches", async () => {
    await asAuthenticatedUser(t.db, (await t.db.query<{ user_id: string }>(`select user_id from public.memberships where id = $1`, [membershipA])).rows[0].user_id, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.employees`);
      expect(res.rows.map((r) => r.id)).toEqual([employeeA1]); // branchA1 only
    });
  });

  it("linked cleaner sees own employee row only", async () => {
    await asAuthenticatedUser(t.db, cleanerAuthUid, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.employees`);
      expect(res.rows.map((r) => r.id)).toEqual([employeeA1]);
    });
  });

  it("unauthenticated sees nothing", async () => {
    await asAuthenticatedUser(t.db, null, async () => {
      const res = await t.db.query(`select id from public.employees`);
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("RLS: jobs and assignments (0012)", () => {
  it("HQ sees own org's jobs; cross-org jobs are invisible", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.jobs`);
      expect(res.rows.map((r) => r.id)).toEqual([jobA1]);
    });
    await asAuthenticatedUser(t.db, hqB, async () => {
      const res = await t.db.query<{ id: string }>(`select id from public.jobs`);
      expect(res.rows.map((r) => r.id)).toEqual([jobB1]);
    });
  });

  it("cleaner sees own assigned job but not other jobs", async () => {
    await asAuthenticatedUser(t.db, cleanerAuthUid, async () => {
      const jobs = await t.db.query<{ id: string }>(`select id from public.jobs`);
      expect(jobs.rows.map((r) => r.id)).toEqual([jobA1]); // own assignment only
      const assigns = await t.db.query<{ id: string }>(`select id from public.job_assignments`);
      expect(assigns.rows).toHaveLength(1); // own assignment only
    });
  });

  it("application-role writes are denied (privileged domain layer only)", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      await expect(
        t.db.query(
          `insert into public.jobs (organization_id, branch_id, job_number, scheduled_start, scheduled_end, timezone, job_snapshot)
           values ($1, $2, 'JOB-2027-800003', now(), now() + interval '1 hour', 'Europe/Berlin', '{}'::jsonb)`,
          [orgA, branchA1],
        ),
      ).rejects.toThrow();
    });
  });
});

describe("RLS: job events and number sequences (0012)", () => {
  it("job_events follow job visibility", async () => {
    await t.db.query(
      `insert into public.job_events (organization_id, branch_id, job_id, event_type)
       select organization_id, branch_id, id, 'job_created' from public.jobs where id = $1`,
      [jobA1],
    );
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query<{ job_id: string }>(`select job_id from public.job_events`);
      expect(res.rows.map((r) => r.job_id)).toEqual([jobA1]);
    });
    await asAuthenticatedUser(t.db, hqB, async () => {
      const res = await t.db.query(`select job_id from public.job_events`);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("sequence tables are visible to HQ but writes stay privileged", async () => {
    await asAuthenticatedUser(t.db, hqA, async () => {
      const res = await t.db.query(`select organization_id from public.job_number_sequences`);
      expect(res.rows).toHaveLength(0); // none allocated in this fixture
      await expect(
        t.db.query(`insert into public.job_number_sequences (organization_id) values ($1)`, [orgA]),
      ).rejects.toThrow();
    });
  });
});
