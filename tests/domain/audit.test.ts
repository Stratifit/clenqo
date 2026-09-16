/**
 * Audit trail tests (task 5.4; spec "Audit events for creation and
 * provisioning"; AUDIT_SYSTEM §5, §21–26, §46–48).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext, VALID_BRANCH_INPUT } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import type { AuthContext } from "@/lib/authorization/server";
import { createAndProvision, retryProvisioning, setProvisioningFailureHookForTests } from "@/features/branches/service";
import { AppError } from "@/lib/errors";

let t: TestDb;
let ctx: AuthContext;
let orgId: string;

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("CLENQO", "clenqo-audit");
  ctx = await hqAdminContext(orgId, "admin@audit.test");
});

describe("audit events", () => {
  it("audits retry separately from the original failure (task 5.4)", async () => {
    // Arrange: a branch that failed once.
    setProvisioningFailureHookForTests((stage) => stage === "locales");
    let branchId: string;
    try {
      await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "audit-bremen" });
      throw new Error("expected provisioning failure");
    } catch (err) {
      branchId = ((err as AppError).details as { branchId: string }).branchId;
    }
    setProvisioningFailureHookForTests(null);

    // Act: authorized retry succeeds.
    const retried = await retryProvisioning(ctx, branchId);
    expect(retried.provisioning_status).toBe("ready");

    // Assert: retry is traceable as its own event (AUDIT_SYSTEM §48).
    const retryAudit = await t.db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_logs
       where branch_id = $1 and action = 'provisioning.retry_started'`,
      [branchId],
    );
    expect(retryAudit.rows).toHaveLength(1);
    // Attempt numbering: the initial run was attempt 1 (its Tx3 failure set
    // provisioning_attempts = 1); this retry is attempt 2.
    expect(retryAudit.rows[0].metadata.attempt).toBe(2);

    // And the completed run is visible via branch.ready with attempt count.
    const readyAudit = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs
       where branch_id = $1 and action = 'branch.ready'`,
      [branchId],
    );
    expect(readyAudit.rows.length).toBe(1);
    expect(readyAudit.rows[0].metadata.provisioning_attempts).toBe(2);
  });

  it("writes branch.ready transactionally with the provisioning audits (same request id)", async () => {
    const requestId = `req-audit-${Math.random().toString(36).slice(2)}`;
    const ctx2 = { ...ctx, requestId };
    const { branch } = await createAndProvision(ctx2, {
      ...VALID_BRANCH_INPUT, slug: "audit-dortmund",
    });

    const rows = await t.db.query<{ action: string; request_id: string | null; result: string }>(
      `select action, request_id, result from public.audit_logs
       where branch_id = $1 and action in
       ('website.provisioned','locales.provisioned','pages.provisioned',
        'configuration.provisioned','branch.ready')
       order by created_at asc`,
      [branch.id],
    );
    // All five provisioning-phase events exist, all carry the same request id
    // (transactional correlation, AUDIT_SYSTEM §50), all successful.
    expect(rows.rows.map((r) => r.action)).toEqual([
      "website.provisioned", "locales.provisioned", "pages.provisioned",
      "configuration.provisioned", "branch.ready",
    ]);
    for (const row of rows.rows) {
      expect(row.request_id).toBe(requestId);
      expect(row.result).toBe("success");
    }
  });

  it("redacts sensitive-looking metadata keys (AUDIT_SYSTEM §21–23)", async () => {
    const { writeAuditEvent } = await import("@/lib/audit/service");
    await writeAuditEvent({
      action: "branch.created",
      organizationId: orgId,
      resourceType: "branch",
      metadata: {
        legitimate: "value",
        password: "hunter2",
        api_token: "tok_abc123",
        nested: { secret_key: "sk_live_x", safe: 1 },
      },
    });
    const row = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs
       where organization_id = $1 and metadata->>'legitimate' = 'value'
       order by created_at desc limit 1`,
      [orgId],
    );
    const meta = row.rows[0].metadata;
    expect(meta.legitimate).toBe("value");
    expect(meta.password).toBe("[REDACTED]");
    expect(meta.api_token).toBe("[REDACTED]");
    expect((meta.nested as Record<string, unknown>).secret_key).toBe("[REDACTED]");
    expect((meta.nested as Record<string, unknown>).safe).toBe(1);
    expect(JSON.stringify(meta)).not.toMatch(/hunter2|tok_abc123|sk_live_x/);
  });

  it("bounds oversized metadata instead of persisting full payloads (AUDIT_SYSTEM §25)", async () => {
    const { writeAuditEvent } = await import("@/lib/audit/service");
    await writeAuditEvent({
      action: "configuration.provisioned",
      organizationId: orgId,
      resourceType: "branch",
      metadata: { blob: "x".repeat(10_000) },
    });
    const row = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs
       where organization_id = $1 and metadata ? 'truncated'
       order by created_at desc limit 1`,
      [orgId],
    );
    expect(row.rows[0].metadata.truncated).toBe(true);
  });
});

describe("scheduling audit trail (Change 3, task 10.2)", () => {
  it("hold lifecycle events are paired and carry bounded, redacted metadata", async () => {
    const { seedSchedulingDefaults } = await import("@/features/scheduling/seed");
    const { createSlotHold, releaseSlotHold } = await import("@/features/scheduling/holds");
    const { getAvailability } = await import("@/features/scheduling/availability");

    const branchId = await t.fx.createBranch(orgId, "audit-sched");
    await seedSchedulingDefaults(branchId);

    const cat = (
      await t.db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name, is_enabled, status)
         values ($1, $2, 'audit-cat', 'Cat', true, 'active') returning id`,
        [orgId, branchId],
      )
    ).rows[0].id;
    const svc = (
      await t.db.query<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name, is_enabled, status)
         values ($1, $2, $3, 'audit-svc', 'Svc', true, 'active') returning id`,
        [orgId, branchId, cat],
      )
    ).rows[0].id;

    const now = new Date("2027-06-01T09:00:00.000Z");
    const slots = await getAvailability(
      { branchId, serviceId: svc, now, days: 3 },
      { async getEstimatedDuration() { return 60; } },
    );
    const target = slots.find((s) => s.available)!;

    const hold = await createSlotHold(
      ctx,
      {
        branch_id: branchId,
        service_id: svc,
        start_time: target.start,
        end_time: target.end,
        session_id: "audit-sess-1",
        idempotency_key: "audit-idem-1",
      },
      { async getEstimatedDuration() { return 60; } },
      now,
    );
    await releaseSlotHold(ctx, { hold_id: hold.id, session_id: "audit-sess-1" });

    // Paired lifecycle: slot.held and slot.released for the same resource.
    const events = await t.db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_logs
       where branch_id = $1 and resource_id = $2 and action in ('slot.held','slot.released')
       order by created_at asc`,
      [branchId, hold.id],
    );
    expect(events.rows.map((e) => e.action)).toEqual(["slot.held", "slot.released"]);
    // Bounded, redacted: no secrets, no oversized payloads.
    const meta = events.rows[0].metadata;
    expect(JSON.stringify(meta)).not.toMatch(/password|token|secret/i);
    expect(JSON.stringify(meta).length).toBeLessThan(4096);
  });

  it("configuration mutations carry actor identity and dotted action names", async () => {
    const { updateSchedulingConfig } = await import("@/features/scheduling/service");
    const { seedSchedulingDefaults } = await import("@/features/scheduling/seed");
    const branchId = await t.fx.createBranch(orgId, "audit-cfg");
    // The configuration singleton is provisioned by seedSchedulingDefaults;
    // ensure it exists before the mutation.
    await seedSchedulingDefaults(branchId);
    await updateSchedulingConfig(ctx, { branch_id: branchId, concurrency_cap: 4 });

    const row = await t.db.query<{ actor_user_id: string | null; action: string }>(
      `select actor_user_id, action from public.audit_logs
       where branch_id = $1 and action = 'scheduling_config.updated'
       order by created_at desc limit 1`,
      [branchId],
    );
    expect(row.rows[0].action).toBe("scheduling_config.updated");
    expect(row.rows[0].actor_user_id).toBe(ctx.actor.userId);
  });
});
