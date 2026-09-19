/**
 * BD-A1 one-time bootstrap tests — dedicated file with clean state.
 *
 * The invariant "setup only while zero active hq_admin memberships exist"
 * requires a pre-bootstrap database, so these tests wipe organizations/
 * memberships first (raw pglite superuser, same harness as the rest of the
 * domain suite) and cover: happy path, transactional audit, permanent
 * fail-closed lock, and the concurrent-attempt serialization (advisory lock).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness } from "../helpers/domain";
import { performSetup, hasActiveHqAdmin, type SetupResult } from "@/features/admin/auth";
import type { TestDb } from "../helpers/db";

let t: TestDb;

beforeAll(async () => {
  t = await getDomainHarness();
  // Fresh-install state: no memberships, no organizations (raw superuser
  // deletes; branches FK-cascade with their organization).
  await t.db.query(`delete from public.membership_branches`);
  await t.db.query(`delete from public.memberships`);
  await t.db.query(`delete from public.branches`);
  await t.db.query(`delete from public.organizations`);
  process.env.SETUP_TOKEN = "test-setup-token";
});

describe("bootstrap (BD-A1) — clean state", () => {
  it("happy path: creates organization + hq_admin membership transactionally, audits success", async () => {
    expect(await hasActiveHqAdmin()).toBe(false);

    const userId = await t.fx.createUser("bootstrap-first@test.example");
    const result = await performSetup({
      setupToken: "test-setup-token",
      userId,
      organizationName: "Bootstrap Org",
    });

    expect(result.organizationId).toBeTruthy();
    const org = await t.db.query<{ name: string }>(`select name from public.organizations where id = $1`, [
      result.organizationId,
    ]);
    expect(org.rows[0].name).toBe("Bootstrap Org");

    const membership = await t.db.query<{ role: string; status: string }>(
      `select role, status from public.memberships where organization_id = $1 and user_id = $2`,
      [result.organizationId, userId],
    );
    expect(membership.rows[0]).toMatchObject({ role: "hq_admin", status: "active" });

    const audit = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.audit_logs
       where action = 'admin.setup_completed' and organization_id = $1`,
      [result.organizationId],
    );
    expect(Number(audit.rows[0].count)).toBe(1);
  });

  it("permanently fails closed after the first HQ Admin exists (valid token or not)", async () => {
    expect(await hasActiveHqAdmin()).toBe(true);
    const second = await t.fx.createUser("bootstrap-second@test.example");
    await expect(
      performSetup({ setupToken: "test-setup-token", userId: second }),
    ).rejects.toThrow(/permanently disabled after bootstrap/i);
    await expect(
      performSetup({ setupToken: "totally-wrong", userId: second }),
    ).rejects.toThrow(/permanently disabled after bootstrap/i);

    // The rejected attempt is audited against the existing organization
    // (invariant rejection carries org attribution when one exists).
    const orgId = (await t.db.query<{ id: string }>(`select id from public.organizations limit 1`)).rows[0].id;
    const audit = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.audit_logs
       where action = 'admin.setup_rejected' and result = 'failure' and organization_id = $1`,
      [orgId],
    );
    expect(Number(audit.rows[0].count)).toBeGreaterThanOrEqual(1);

    // Still exactly one active HQ Admin membership.
    const admins = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.memberships where role = 'hq_admin' and status = 'active'`,
    );
    expect(Number(admins.rows[0].count)).toBe(1);
  });

  it("concurrent setup attempts serialize: exactly one succeeds", async () => {
    // Reset to pre-bootstrap state, then race two valid-token attempts.
    // Audit rows reference organizations (NOT NULL FK) — clear them first.
    await t.db.query(`delete from public.audit_logs`);
    await t.db.query(`delete from public.membership_branches`);
    await t.db.query(`delete from public.memberships`);
    await t.db.query(`delete from public.branches`);
    await t.db.query(`delete from public.organizations`);

    const u1 = await t.fx.createUser("bootstrap-race-1@test.example");
    const u2 = await t.fx.createUser("bootstrap-race-2@test.example");

    const results = await Promise.allSettled([
      performSetup({ setupToken: "test-setup-token", userId: u1, organizationName: "Race Org" }),
      performSetup({ setupToken: "test-setup-token", userId: u2, organizationName: "Race Org" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(
      fulfilled,
      `race outcomes: ${JSON.stringify(
        results.map((r) => (r.status === "rejected" ? String((r.reason as Error)?.message) : r.status)),
      )}`,
    ).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const admins = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.memberships where role = 'hq_admin' and status = 'active'`,
    );
    expect(Number(admins.rows[0].count)).toBe(1);

    // Restore a fixture-friendly state for any later suites in this worker.
    const winner = results.find(
      (r): r is PromiseFulfilledResult<SetupResult> => r.status === "fulfilled",
    );
    void winner?.value;
  });

  it("rejects an invalid token while pre-bootstrap (no org attribution needed)", async () => {
    await t.db.query(`delete from public.audit_logs`);
    await t.db.query(`delete from public.membership_branches`);
    await t.db.query(`delete from public.memberships`);
    await t.db.query(`delete from public.branches`);
    await t.db.query(`delete from public.organizations`);
    const userId = await t.fx.createUser("bootstrap-token@test.example");
    await expect(
      performSetup({ setupToken: "wrong-token", userId, organizationName: "Boot Org" }),
    ).rejects.toThrow(/invalid setup token/i);
    // No membership was created by the rejected attempt.
    const admins = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.memberships where role = 'hq_admin' and status = 'active'`,
    );
    expect(Number(admins.rows[0].count)).toBe(0);
  });
});
