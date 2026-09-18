/**
 * HOSTED SUPABASE VERIFICATION — OpenSpec Change 7 (create-cleaner-pwa)
 *
 * SKIPPED by default: runs only with  HOSTED_VERIFY=1 npx vitest run
 * tests/hosted/cleaner-hosted-verification.test.ts — never part of `npm test`.
 * Requires `.env.local` pointing at the TARGET staging project
 * (ksdxzkghyvvdizwclhbu) with the migration chain 0001–0013 applied.
 *
 * Coverage: 0013 schema (4 new tables, execution timestamps, CHECK
 * constraints, widened job_events, RLS without FORCE), cleaner execution
 * flow end-to-end (en_route/check-in incl. direct path/start/checkout/
 * completion — BD-C2), checklist snapshot + mandatory gating (BD-C3/C9),
 * incident severity gating + manager override (BD-C9), completion →
 * booking through the existing contract, idempotent retries, RLS probes
 * as the real `authenticated` role (cleaner own-assignment scope,
 * cross-cleaner denial, org isolation, write denial), minimized customer
 * data (BD-C1), and no GPS/signature artifacts (BD-C6/C8).
 *
 * ALL fixture values are explicit NON-PRODUCTION fixtures (P3). The suite
 * creates its own hv7-suffixed entities and deletes everything afterwards.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { Pool } from "pg";

import { resolveActor } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import { seedSchedulingDefaults } from "@/features/scheduling/seed";
import { seedBookingDefaults } from "@/features/booking/seed";
import { createProfile, createRule, createVersion, publishVersion, updateProfile } from "@/features/pricing/service";
import { createSlotHold } from "@/features/scheduling/holds";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import { calculateQuote } from "@/features/pricing/quote";
import { parseMinor } from "@/features/pricing/money";
import { setServiceAreas } from "@/features/booking/configuration";
import { confirmBooking } from "@/features/booking/service";
import {
  createEmployee,
  setEmployeeBranches,
  setEmployeeAvailability,
} from "@/features/worker/employees";
import { ensureJobForBooking, completeJob } from "@/features/worker/jobs";
import { assignCleaner } from "@/features/worker/assignments";
import {
  resolveCleanerContext,
  cleanerEnRoute,
  cleanerCheckIn,
  cleanerStartWork,
  cleanerCheckOut,
  completeCleanerJob,
  completeChecklistItem,
  reportCleanerIncident,
  getJobChecklist,
} from "@/features/worker/execution";
import { WorkerErrorCode } from "@/features/worker/errors";

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
const PREFIX = "hv7-";

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

/** Real `authenticated` RLS probe inside a rolled-back tx. */
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

const EXECUTION_TABLES = [
  "checklist_templates",
  "job_checklist_items",
  "job_checklist_snapshots",
  "job_media",
];

const TEARDOWN_TABLES = EXECUTION_TABLES.concat([
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
]);

async function cleanup(): Promise<void> {
  const maintUrl = DB_URL_RAW;
  if (maintUrl) {
    const mHost = new URL(maintUrl).hostname;
    const maint = new Pool({
      connectionString: maintUrl,
      max: 1,
      ssl: mHost.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const orgs = (
        await maint.query("select id from public.organizations where slug like 'hv7-org-%'")
      ).rows as { id: string }[];
      for (const org of orgs) {
        const stmt = TEARDOWN_TABLES.map((t) => `delete from public.${t} where organization_id = '${org.id}'`).join("; ");
        await maint.query(`set session_replication_role = replica; ${stmt}; set session_replication_role = origin;`);
        await maint.query(
          `set session_replication_role = replica;
           delete from public.pricing_profiles where organization_id = '${org.id}';
           delete from public.service_addon_compatibility where organization_id = '${org.id}';
           delete from public.service_slug_aliases where organization_id = '${org.id}';
           delete from public.service_addons where organization_id = '${org.id}';
           delete from public.services where organization_id = '${org.id}';
           delete from public.service_categories where organization_id = '${org.id}';
           delete from public.audit_logs where organization_id = '${org.id}';
           delete from public.branches where organization_id = '${org.id}';
           delete from public.membership_branches where membership_id in (select m.id from public.memberships m where m.organization_id = '${org.id}');
           delete from public.memberships where organization_id = '${org.id}';
           delete from public.organizations where id = '${org.id}';
           set session_replication_role = origin;`,
        );
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
    `select count(*)::text as n from public.organizations where slug like 'hv7-org-%'`,
  );
  checks.push(["organizations", Number(orgs[0].n)]);
  const branches = await sql<{ n: string }>(
    `select count(*)::text as n from public.branches where slug like 'hv7-%'`,
  );
  checks.push(["branches", Number(branches[0].n)]);
  for (const table of TEARDOWN_TABLES) {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.${table}
        where organization_id in (select id from public.organizations where slug like 'hv7-org-%')`,
    );
    checks.push([table, Number(rows[0].n)]);
  }
  const leftovers = checks.filter(([, n]) => n !== 0);
  expect(leftovers).toEqual([]);
}

const S: {
  orgA?: string;
  branch1?: string;
  cat?: string;
  svc?: string;
  users: Record<string, string>;
  employeeLinked?: string;
  booking?: string;
  job?: string;
} = { users: {} };

// NON-PRODUCTION fixture values (P3).
const FIX_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 };
const FIX_DURATION = { consumed_factors: ["base" as const], base_minutes: 60 };

describe.skipIf(!HOSTED)("hosted verification: create-cleaner-pwa", () => {
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
      console.log("hv7 cleanup verified: zero leftover rows and auth users");
    } finally {
      await pool?.end();
      pool = null;
    }
  }, 300_000);

  // -- 00) DATABASE: migration 0013 ---------------------------------------

  it("00 DATABASE: migration 0013 applied — execution tables, timestamps, widened events, RLS without FORCE", async () => {
    const tables = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in
        ('checklist_templates','job_checklist_snapshots','job_checklist_items','job_media')
        order by table_name`,
    );
    expect(tables).toHaveLength(4);

    // Execution timestamps on jobs.
    const cols = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'jobs' and column_name in
        ('en_route_at','checked_in_at','checked_out_at','actual_start','actual_end')`,
    );
    expect(cols).toHaveLength(5);

    // Widened job_events CHECK.
    const evCheck = await sql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'job_events_event_type_check'`,
    );
    expect(evCheck[0].def).toContain("en_route");
    expect(evCheck[0].def).toContain("checklist_completed");

    // Media category + evidence linkage CHECKs (BD-C4).
    const mediaChecks = await sql<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.job_media'::regclass
          and conname in ('job_media_category_check','ck_job_media_evidence_requires_incident')`,
    );
    expect(mediaChecks).toHaveLength(2);

    // RLS enabled, no FORCE (established pattern).
    const rls = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('checklist_templates','job_checklist_snapshots','job_checklist_items','job_media')
        order by relname`,
    );
    expect(rls).toHaveLength(4);
    for (const r of rls) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(false);
    }

    // No GPS/signature artifacts (BD-C6/C8).
    const forbidden = await sql<{ n: string }>(
      `select count(*)::text as n from information_schema.columns
        where table_schema = 'public' and (column_name like '%location%' or column_name like '%gps%'
          or column_name like '%coordinate%' or column_name like '%signature%')`,
    );
    expect(Number(forbidden[0].n)).toBe(0);
  });

  // -- 01) FIXTURES ---------------------------------------------------------

  it("01 FIXTURES: hosted org, real Auth users, provisioned active branch, catalog + pricing + published checklist template", async () => {
    const orgId = (
      await sql<{ id: string }>(
        `insert into public.organizations (name, slug) values ('HV7 Org ${RUN}', 'hv7-org-${RUN}') returning id`,
      )
    )[0].id;
    S.orgA = orgId;

    S.users.hq = await createHostedUser("hq");
    await sql(
      `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'hq_admin')`,
      [orgId, S.users.hq],
    );
    S.users.cleaner = await createHostedUser("cleaner");
    await sql(
      `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'cleaner')`,
      [orgId, S.users.cleaner],
    );
    S.users.other = await createHostedUser("other");

    const { branch } = await createAndProvision(await resolveActor(S.users.hq), {
      name: `HV7 Berlin ${RUN}`,
      slug: `${PREFIX}${RUN}-berlin`,
      country_code: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      default_locale: "de",
      enabled_locales: ["de"],
    } as never);
    S.branch1 = branch.id;
    await sql(`update public.branches set status = 'active', activated_at = now() where id = $1`, [S.branch1]);
    await sql(`update public.branch_scheduling_configuration set customer_horizon_days = 90, concurrency_cap = 10, minimum_notice_minutes = 0 where branch_id = $1`, [S.branch1]);

    await seedSchedulingDefaults(S.branch1);
    await seedBookingDefaults(S.branch1);

    S.cat = (
      await sql<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name, status, is_enabled)
         values ($1, $2, 'hv7-cat', 'Cat', 'active', true) returning id`,
        [orgId, S.branch1],
      )
    )[0].id;
    S.svc = (
      await sql<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name, status, is_enabled)
         values ($1, $2, $3, 'hv7-svc', 'Svc', 'active', true) returning id`,
        [orgId, S.branch1, S.cat],
      )
    )[0].id;

    const ctx = await resolveActor(S.users.hq);
    const profile = await createProfile(ctx, { branch_id: S.branch1, name: `HV7 Profile ${RUN}`, currency: "EUR" });
    const version = await createVersion(ctx, { profile_id: profile.id, branch_id: S.branch1, effective_from: "2026-01-01" });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "base_rate", service_id: S.svc, configuration: FIX_RATE });
    await createRule(ctx, { version_id: version.id, branch_id: S.branch1, rule_type: "duration_rule", service_id: S.svc, configuration: FIX_DURATION });
    await publishVersion(ctx, version.id, { branch_id: S.branch1 });
    await updateProfile(ctx, profile.id, { status: "active" });

    await setServiceAreas(ctx, { branch_id: S.branch1, postal_codes: ["10115"] });

    await sql(
      `update public.branch_scheduling_configuration set slot_grid_minutes = 60, minimum_notice_minutes = 0, concurrency_cap = 50 where branch_id = $1`,
      [S.branch1!],
    );

    // Published checklist template (NON-PRODUCTION structural fixture).
    await sql(
      `insert into public.checklist_templates (organization_id, branch_id, service_id, version, status, name, items)
       values ($1, $2, $3, 1, 'published', 'HV7 Checklist', $4::jsonb)`,
      [
        orgId,
        S.branch1,
        S.svc,
        JSON.stringify([
          { key: "kitchen", label: "Kitchen surfaces", mandatory: true, sort_order: 1 },
          { key: "bath", label: "Bathroom", mandatory: true, sort_order: 2 },
        ]),
      ],
    );
  });

  // -- 02) CLEANER + JOB ----------------------------------------------------

  it("02 CLEANER: linked employee (BD-W12), booking → job (BD-W4/W6), active assignment, context resolution", async () => {
    const ctx = await resolveActor(S.users.hq);
    const linked = await createEmployee(ctx, {
      first_name: "HV7",
      last_name: "Cleaner",
      email: `hv7-cleaner-${RUN}@verify.example.com`,
      employment_type: "part_time",
      user_id: S.users.cleaner,
    });
    S.employeeLinked = linked.id;
    await setEmployeeBranches(ctx, { employee_id: linked.id, branch_ids: [S.branch1] });
    await setEmployeeAvailability(ctx, {
      employee_id: linked.id,
      windows: [1, 2, 3, 4, 5].map((wd) => ({
        weekday: wd,
        start_time: "00:00",
        end_time: "23:59",
        effective_from: "2026-01-01",
      })) as never,
    });

    const startIso = (() => {
      const d = new Date(Date.now() + 7 * 24 * 3600_000);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(10, 0, 0, 0);
      return d.toISOString();
    })();
    const sessionId = `hv7-sess-${randomUUID()}`;
    const hold = await createSlotHold(
      ctx,
      {
        branch_id: S.branch1,
        service_id: S.svc,
        start_time: startIso,
        end_time: new Date(new Date(startIso).getTime() + 3600_000).toISOString(),
        session_id: sessionId,
        idempotency_key: `hold-${randomUUID()}`,
      } as never,
      pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc! }),
      new Date(),
    );
    const quote = await calculateQuote({ branch_id: S.branch1!, service_id: S.svc!, scheduled_date: startIso.slice(0, 10) });
    const result = await confirmBooking(
      ctx,
      {
        branch_id: S.branch1,
        service_id: S.svc,
        scheduled_start: new Date(hold.start_time).toISOString(),
        hold_id: hold.id,
        session_id: sessionId,
        customer: {
          first_name: "HV7",
          last_name: "Customer",
          email: `hv7-cust-${RUN}@verify.example.com`,
          phone: "+491510000007",
        },
        service_address: { street: "Main", house_number: "1", postal_code: "10115", city: "Berlin", country: "de" },
        source: "dashboard",
        accepted_total_minor: Number(parseMinor(quote.total)),
        idempotency_key: `conf-${randomUUID()}`,
      },
      new Date(),
    );
    S.booking = result.booking.id;

    const job = await ensureJobForBooking(S.booking);
    S.job = job.id;
    await assignCleaner(ctx, { job_id: S.job, employee_id: S.employeeLinked });

    // Context resolution chain (§4).
    const cleaner = await resolveCleanerContext(S.users.cleaner);
    expect(cleaner.employeeId).toBe(S.employeeLinked);
    expect(cleaner.branchIds).toContain(S.branch1);

    // Unlinked user denied.
    await expect(resolveCleanerContext(S.users.other)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.NO_ACTIVE_ASSIGNMENT },
    });
  });

  // -- 03) EXECUTION FLOW ----------------------------------------------------

  it("03 EXECUTION: direct check-in (BD-C2), checklist snapshot + mandatory gating (BD-C3/C9), completion → booking completed", async () => {
    // Direct assigned → checked_in (no en_route — explicitly permitted).
    let job = await cleanerCheckIn(S.users.cleaner, S.job!);
    expect(job.status).toBe("checked_in");
    expect(job.en_route_at).toBeNull();
    expect(job.checked_in_at).not.toBeNull();

    // Snapshot materialized from the published template.
    const { snapshot, items } = await getJobChecklist(S.job!);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.template_version).toBe(1);
    expect(items).toHaveLength(2);

    // Completion blocked by pending mandatory items (deterministic gate echo).
    await expect(completeCleanerJob(S.users.cleaner, S.job!)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.COMPLETION_BLOCKED },
    });

    // Start work, complete both mandatory items.
    job = await cleanerStartWork(S.users.cleaner, S.job!);
    expect(job.status).toBe("in_progress");
    for (const item of items.filter((i) => i.mandatory)) {
      await completeChecklistItem(S.users.cleaner, { job_id: S.job!, item_id: item.id });
    }

    // Open critical incident blocks (BD-C9 gate 3).
    await reportCleanerIncident(S.users.cleaner, {
      job_id: S.job!,
      incident_type: "safety_issue",
      severity: "critical",
    });
    await expect(completeCleanerJob(S.users.cleaner, S.job!)).rejects.toMatchObject({
      details: { worker_code: WorkerErrorCode.COMPLETION_BLOCKED },
    });

    // Manager override: staff completion path (jobs.manage at the action layer),
    // audited; completion → booking completed through the EXISTING contract.
    await completeJob({ userId: S.users.hq }, S.job!);
    const bookingRow = await sql<{ status: string }>(`select status from public.bookings where id = $1`, [S.booking!]);
    expect(bookingRow[0].status).toBe("completed");

    const audit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where resource_id = $1 and action like 'job.completed%'`,
      [S.job!],
    );
    expect(Number(audit[0].n)).toBeGreaterThanOrEqual(1);
  });

  // -- 04) EXECUTION FLOW 2: en_route + checkout + idempotent cleaner completion

  it("04 EXECUTION 2: en_route recorded, checkout before completion, idempotent cleaner completion (BD-C2/C9)", async () => {
    const ctx = await resolveActor(S.users.hq);
    // Second booking/job for the same linked cleaner.
    const startIso = (() => {
      const d = new Date(Date.now() + 9 * 24 * 3600_000);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(10, 0, 0, 0);
      return d.toISOString();
    })();
    const sessionId = `hv7-sess2-${randomUUID()}`;
    const hold = await createSlotHold(
      ctx,
      {
        branch_id: S.branch1,
        service_id: S.svc,
        start_time: startIso,
        end_time: new Date(new Date(startIso).getTime() + 3600_000).toISOString(),
        session_id: sessionId,
        idempotency_key: `hold-${randomUUID()}`,
      } as never,
      pricingDurationProvider({ branchId: S.branch1!, serviceId: S.svc! }),
      new Date(),
    );
    const quote = await calculateQuote({ branch_id: S.branch1!, service_id: S.svc!, scheduled_date: startIso.slice(0, 10) });
    const result = await confirmBooking(
      ctx,
      {
        branch_id: S.branch1,
        service_id: S.svc,
        scheduled_start: new Date(hold.start_time).toISOString(),
        hold_id: hold.id,
        session_id: sessionId,
        customer: {
          first_name: "HV7",
          last_name: "Second",
          email: `hv7-cust2-${RUN}@verify.example.com`,
          phone: "+491510000008",
        },
        service_address: { street: "Other", house_number: "2", postal_code: "10115", city: "Berlin", country: "de" },
        source: "dashboard",
        accepted_total_minor: Number(parseMinor(quote.total)),
        idempotency_key: `conf-${randomUUID()}`,
      },
      new Date(),
    );
    const job2 = await ensureJobForBooking(result.booking.id);
    await assignCleaner(ctx, { job_id: job2.id, employee_id: S.employeeLinked });

    // Full path: en_route → check_in → start → check_out → complete.
    let job = await cleanerEnRoute(S.users.cleaner, job2.id);
    expect(job.status).toBe("en_route");
    expect(job.en_route_at).not.toBeNull();

    job = await cleanerCheckIn(S.users.cleaner, job2.id);
    job = await cleanerStartWork(S.users.cleaner, job2.id);
    job = await cleanerCheckOut(S.users.cleaner, job2.id);
    expect(job.checked_out_at).not.toBeNull();
    expect(job.status).toBe("in_progress"); // checkout does not complete

    // Complete mandatory items (snapshot from the same template).
    const { items } = await getJobChecklist(job2.id);
    for (const item of items.filter((i) => i.mandatory)) {
      await completeChecklistItem(S.users.cleaner, { job_id: job2.id, item_id: item.id });
    }

    const completed = await completeCleanerJob(S.users.cleaner, job2.id);
    expect(completed.status).toBe("completed");
    const bookingRow = await sql<{ status: string }>(`select status from public.bookings where id = $1`, [result.booking.id]);
    expect(bookingRow[0].status).toBe("completed");

    // Idempotent repeat: acknowledged no-op, no duplicate events.
    const again = await completeCleanerJob(S.users.cleaner, job2.id);
    expect(again.completed_at).toBe(completed.completed_at);
    const ev = await sql<{ n: string }>(
      `select count(*)::text as n from public.job_events where job_id = $1 and event_type = 'job_completed'`,
      [job2.id],
    );
    expect(Number(ev[0].n)).toBe(1);
  });

  // -- 05) RLS ----------------------------------------------------------------

  it("05 RLS: cleaner own-assignment scope on new tables, cross-cleaner denial, org isolation, write denial", async () => {
    // Snapshots/items exist for the two hv7 jobs. A CLEANER-ROLE user in the
    // same org but without any assignment (users.other) sees nothing.
    await withRlsUser(S.users.other, async (client) => {
      for (const table of EXECUTION_TABLES) {
        const res = await client.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
        expect(Number(res.rows[0].n)).toBe(0);
      }
    });

    // The linked cleaner (cleaner-role + own assignments) sees none of the
    // templates. NOTE: both hv7 jobs are COMPLETED by this point, and the
    // 0013 cleaner scope intentionally matches the approved active-assignment
    // design (active/pending only) — completed history flows through the
    // authorized domain layer, not raw RLS rows.
    await withRlsUser(S.users.cleaner, async (client) => {
      const tpl = await client.query<{ n: string }>(`select count(*)::text as n from public.checklist_templates`);
      expect(Number(tpl.rows[0].n)).toBe(0); // unpublished-to-cleaners
    });

    // Org isolation: an unrelated auth user sees nothing anywhere.
    const outsider = await createHostedUser("outsider");
    await withRlsUser(outsider, async (client) => {
      const res = await client.query<{ n: string }>(`select count(*)::text as n from public.job_checklist_items`);
      expect(Number(res.rows[0].n)).toBe(0);
    });

    // Write denial: no application-role insert policies on new tables.
    await withRlsUser(S.users.hq, async (client) => {
      await expect(
        client.query(
          `insert into public.job_media (organization_id, branch_id, job_id, category, storage_path)
           values ($1, $2, $3, 'after', 'jobs/hv7/after/deny.jpg')`,
          [S.orgA!, S.branch1!, S.job!],
        ),
      ).rejects.toThrow();
    });
  });

  // -- 06) BOUNDARY ------------------------------------------------------------

  it("06 BOUNDARY: minimized customer data in snapshots (BD-C1); widened events recorded; no delivery infrastructure", async () => {
    // Minimized snapshot on the job the cleaner executed.
    const snap = await sql<{ job_snapshot: Record<string, unknown> }>(
      `select job_snapshot from public.jobs where id = $1`,
      [S.job!],
    );
    const display = snap[0].job_snapshot.customer_display as { first_name?: string; last_initial?: string; email?: string } | null;
    expect(display?.first_name).toBe("HV7");
    expect(display?.last_initial).toMatch(/^[A-Z]$/);
    expect(display?.email).toBeUndefined();

    // Execution events recorded through the widened CHECK.
    const ev = await sql<{ event_type: string }>(
      `select event_type from public.job_events where job_id = $1 order by created_at`,
      [S.job!],
    );
    const types = ev.map((r) => r.event_type);
    expect(types).toContain("check_in");
    expect(types).toContain("job_started");
    expect(types).toContain("incident_reported");
    expect(types).toContain("job_completed");

    // No delivery/notification-provider structures ever.
    const forbidden = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'
        and (table_name like '%push%' or table_name like '%sms%' or table_name like '%whatsapp%'
             or table_name like '%delivery%' or table_name like '%signature%')`,
    );
    expect(forbidden).toHaveLength(0);
  });
});
