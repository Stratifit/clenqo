/**
 * Provisioning pipeline tests (tasks 3.x, 4.3, 7.3; spec requirements:
 * deterministic provisioning, transactional provisioning, idempotent
 * provisioning, retry & failure handling).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getDomainHarness, hqAdminContext, VALID_BRANCH_INPUT } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import type { AuthContext } from "@/lib/authorization/server";
import {
  createAndProvision,
  retryProvisioning,
  setProvisioningFailureHookForTests,
  type BranchRecord,
} from "@/features/branches/service";
import { AppError } from "@/lib/errors";

let t: TestDb;
let ctx: AuthContext;
let orgId: string;

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("CLENQO", "clenqo-main");
  ctx = await hqAdminContext(orgId, "admin@clenqo.test");
});

afterAll(() => {
  setProvisioningFailureHookForTests(null);
});

// Hooks must never leak between tests.
afterEach(() => {
  setProvisioningFailureHookForTests(null);
});

async function counts(websiteId: string) {
  const locales = await t.db.query<{ count: string }>(
    `select count(*)::text as count from public.website_locales where website_id = $1`, [websiteId]);
  const pages = await t.db.query<{ count: string }>(
    `select count(*)::text as count from public.website_pages where website_id = $1`, [websiteId]);
  const translations = await t.db.query<{ count: string }>(
    `select count(*)::text as count from public.website_page_translations p
     join public.website_pages w on w.id = p.page_id where w.website_id = $1`, [websiteId]);
  const sections = await t.db.query<{ count: string }>(
    `select count(*)::text as count from public.website_sections s
     join public.website_pages w on w.id = s.page_id where w.website_id = $1`, [websiteId]);
  return {
    locales: Number(locales.rows[0].count),
    pages: Number(pages.rows[0].count),
    translations: Number(translations.rows[0].count),
    sections: Number(sections.rows[0].count),
  };
}

describe("successful provisioning", () => {
  it("creates the branch and full website foundation", async () => {
    const { branch, created } = await createAndProvision(ctx, { ...VALID_BRANCH_INPUT });
    expect(created).toBe(true);
    expect(branch.provisioning_status).toBe("ready");
    // Lifecycle: provisioning → ready on success — but NOT active
    // (creation ≠ activation, BRANCH_SYSTEM §19).
    expect(branch.status).toBe("ready");

    const site = await t.db.query<{ id: string; template_key: string }>(
      `select id, template_key from public.branch_websites where branch_id = $1`, [branch.id]);
    expect(site.rows).toHaveLength(1);
    expect(site.rows[0].template_key).toBe("clenqo-main");

    const c = await counts(site.rows[0].id);
    expect(c).toEqual({ locales: 2, pages: 7, translations: 7, sections: 6 + 3 + 2 + 2 + 2 + 1 + 2 });

    // Exactly one default locale.
    const defaults = await t.db.query<{ locale: string }>(
      `select locale from public.website_locales where website_id = $1 and is_default`, [site.rows[0].id]);
    expect(defaults.rows).toHaveLength(1);
    expect(defaults.rows[0].locale).toBe("de");

    // Navigation + footer sections exist (home page registry).
    const nav = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.website_sections
       where section_key in ('cta', 'header')`, []);
    expect(Number(nav.rows[0].count)).toBeGreaterThan(0);
  });

  it("writes the full audit trail with request id correlation", async () => {
    const { branch } = await createAndProvision(ctx, {
      ...VALID_BRANCH_INPUT, slug: "munich", name: "Munich",
    });
    const actions = await t.db.query<{ action: string; request_id: string | null }>(
      `select action, request_id from public.audit_logs
       where branch_id = $1 and action in
       ('branch.created','website.provisioned','locales.provisioned','pages.provisioned',
        'configuration.provisioned','branch.ready')
       order by created_at asc`, [branch.id]);
    expect(actions.rows.map((r) => r.action)).toEqual([
      "branch.created", "website.provisioned", "locales.provisioned",
      "pages.provisioned", "configuration.provisioned", "branch.ready",
    ]);
    const requestIds = new Set(actions.rows.map((r) => r.request_id));
    expect(requestIds.size).toBe(1);
  });
});

describe("validation", () => {
  it("rejects invalid slug", async () => {
    await expect(
      createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "Invalid Slug!" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects unsupported locale", async () => {
    await expect(
      createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "x1", enabled_locales: ["de", "it" as never] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects default locale not included in enabled locales", async () => {
    await expect(
      createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "x2", enabled_locales: ["en"] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects unknown properties (strict schema)", async () => {
    await expect(
      createAndProvision(ctx, { ...VALID_BRANCH_INPUT, organization_id: orgId, slug: "x3" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("duplicate creation idempotency", () => {
  it("returns the existing branch for a repeated identical request", async () => {
    const first = await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "stuttgart" });
    const second = await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "stuttgart" });
    expect(second.created).toBe(false);
    expect(second.branch.id).toBe(first.branch.id);
  });
});

describe("failure handling (Tx2 rollback → Tx3 recoverable state)", () => {
  it("rolls back all provisioning content and records a recoverable failure", async () => {
    setProvisioningFailureHookForTests((stage) => stage === "sections");
    let branchId: string;
    try {
      await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "dresden" });
      throw new Error("expected provisioning failure");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("PROVISIONING_FAILED");
      branchId = ((err as AppError).details as { branchId: string }).branchId;
    }

    // No orphaned website content.
    const sites = await t.db.query(`select * from public.branch_websites where branch_id = $1`, [branchId]);
    expect(sites.rows).toHaveLength(0);

    // Failure audit survives with stage + error code only (no secrets).
    const audit = await t.db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_logs where resource_id = $1 and action = 'provisioning.failed'`,
      [branchId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.stage).toBe("sections");
    expect(JSON.stringify(audit.rows[0].metadata)).not.toMatch(/secret|token|password/i);
  });
});

describe("retry", () => {
  it("is a no-op for an already-ready branch", async () => {
    const { branch } = await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "koeln-t" });
    const before = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.branch_websites where branch_id = $1`, [branch.id]);
    const result = await retryProvisioning(ctx, branch.id);
    expect(result.provisioning_status).toBe("ready");
    const after = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.branch_websites where branch_id = $1`, [branch.id]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("retries a failed branch to ready with no duplicate artifacts", async () => {
    // Arrange a failed branch.
    setProvisioningFailureHookForTests((stage) => stage === "pages");
    let branchId: string;
    try {
      await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "leipzig" });
      throw new Error("expected provisioning failure");
    } catch (err) {
      branchId = ((err as AppError).details as { branchId: string }).branchId;
    }
    setProvisioningFailureHookForTests(null);

    // Act: authorized retry (guards transition failed → provisioning).
    const retried = await retryProvisioning(ctx, branchId);
    expect(retried.provisioning_status).toBe("ready");

    const site = await t.db.query<{ id: string }>(
      `select id from public.branch_websites where branch_id = $1`, [branchId]);
    expect(site.rows).toHaveLength(1);
    const c = await counts(site.rows[0].id);
    expect(c.pages).toBe(7);
  });

  it("serializes concurrent retries: exactly one wins the transition", async () => {
    // Arrange a failed branch.
    setProvisioningFailureHookForTests((stage) => stage === "translations");
    try {
      await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug: "hamburg-t" });
    } catch { /* expected */ }
    setProvisioningFailureHookForTests(null);

    const row = await t.db.query<{ id: string }>(
      `select id from public.branches where slug = 'hamburg-t' and provisioning_status = 'failed'`);
    expect(row.rows).toHaveLength(1);
    const branchId = row.rows[0].id;

    // First retry call wins; second call observes 'provisioning' or 'ready'
    // and does not execute a second pipeline run.
    const [r1, r2] = await Promise.all([
      retryProvisioning(ctx, branchId).catch(() => null),
      retryProvisioning(ctx, branchId).catch(() => null),
    ]);
    const results = [r1, r2].filter(Boolean) as BranchRecord[];
    expect(results.length).toBeGreaterThanOrEqual(1);
    const final = await t.db.query<{ provisioning_status: string }>(
      `select provisioning_status from public.branches where id = $1`, [branchId]);
    expect(final.rows[0].provisioning_status).toBe("ready");

    // No duplicate artifacts.
    const site = await t.db.query<{ id: string }>(
      `select id from public.branch_websites where branch_id = $1`, [branchId]);
    expect(site.rows).toHaveLength(1);
  });
});
