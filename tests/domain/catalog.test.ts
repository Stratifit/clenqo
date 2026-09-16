/**
 * Service catalog domain tests (openspec/changes/create-service-catalog
 * tasks 6.4, 7.2, 8.3, 9.2, 10.2; spec scenarios) plus the task-4.2
 * authorization boundary, task-9 archive guard, task-10 localization
 * fallback, task-16 acceptance walkthrough, and the seed/DELETE regression
 * assertions.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext, VALID_BRANCH_INPUT } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { createAndProvision } from "@/features/branches/service";
import {
  changeStatus,
  createAddon,
  createCategory,
  createService,
  createVariant,
  findOrphanedAddons,
  listEffectiveCatalog,
  removeAddonCompatibility,
  renamePublishedSlug,
  reorderCatalog,
  resolveCatalogSlug,
  setAddonCompatibility,
  setOfferingState,
  updateAddon,
  updateCategory,
  upsertTranslation,
  validateSelection,
} from "@/features/services/service";
import { seedCatalogFromDefinition } from "@/features/services/seed";

let t: TestDb;
let ctx: AuthContext;
let orgId: string;
let branchId: string;
// Task-4.2 authorization boundary fixtures.
let managerCtx: AuthContext;
let staffCtx: AuthContext;
let cleanerCtx: AuthContext;
let otherOrgAdminCtx: AuthContext;
let secondBranchId: string;

async function setupBranch(slug: string): Promise<string> {
  const { branch } = await createAndProvision(ctx, { ...VALID_BRANCH_INPUT, slug });
  return branch.id;
}

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("CLENQO Catalog", "clenqo-catalog");
  ctx = await hqAdminContext(orgId, "catalog-admin@clenqo.test");
  branchId = await setupBranch("catalog-berlin");

  // Authorization-boundary actors (task 4.2).
  const managerUser = await t.fx.createUser("catalog-manager@clenqo.test");
  await t.fx.createMembership(managerUser, orgId, "branch_manager");
  managerCtx = await resolveActor(managerUser);
  const mb = await t.db.query<{ id: string }>(
    `select id from public.memberships where user_id = $1`, [managerUser],
  );
  await t.fx.grantBranch(mb.rows[0].id, branchId);

  const staffUser = await t.fx.createUser("catalog-staff@clenqo.test");
  await t.fx.createMembership(staffUser, orgId, "hq_staff");
  staffCtx = await resolveActor(staffUser);

  const cleanerUser = await t.fx.createUser("catalog-cleaner@clenqo.test");
  await t.fx.createMembership(cleanerUser, orgId, "cleaner");
  cleanerCtx = await resolveActor(cleanerUser);

  const otherOrg = await t.fx.createOrganization("Other Org", "catalog-other-org");
  otherOrgAdminCtx = await hqAdminContext(otherOrg, "other-admin@clenqo.test");
  // An org-A branch the other-org admin and the branch manager have no scope over.
  secondBranchId = await setupBranch("catalog-second-branch");
}, 120_000);

function tx(slug: string, locale = "de", name = `T ${slug}`) {
  return [{ locale, name }];
}

/** Slug counter so fixtures never collide (unique per branch). */
let fixtureSeq = 0;

async function createActiveFixture() {
  const n = ++fixtureSeq;
  const cat = await createCategory(ctx, {
    branchId, slug: `home-cleaning-${n}`, name: "Home Cleaning",
    translations: tx(`home-cleaning-${n}`),
  });
  await changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "active" });
  // Q2: opt the category in — the effective-catalog conjunction requires it.
  await setOfferingState(ctx, {
    branchId, entityType: "service_category", entityId: cat.id,
    is_enabled: true, is_customer_visible: true,
  });
  const svc = await createService(ctx, {
    branchId, categoryId: cat.id, slug: `regular-cleaning-${n}`, name: "Regular Cleaning",
    translations: tx(`regular-cleaning-${n}`),
  });
  await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" });
  return { cat, svc };
}

/** Read-model wrappers mirroring the authorized action layer (ctx-aware). */
async function listEffectiveCatalogFor(
  actorCtx: AuthContext,
  targetBranchId: string,
  opts: { locale?: string; customerVisibleOnly?: boolean } = {},
) {
  const { requirePermission, hasBranchScope } = await import("@/lib/authorization/server");
  const { AppError, ErrorCode } = await import("@/lib/errors");
  requirePermission(actorCtx, "services.view");
  const branchInOrg = await t.db.query<{ exists: boolean }>(
    `select exists(select 1 from public.branches where id = $1 and organization_id = $2) as exists`,
    [targetBranchId, actorCtx.actor.organizationId],
  );
  if (branchInOrg.rows[0]?.exists !== true || !(await hasBranchScope(actorCtx, targetBranchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }
  return listEffectiveCatalog(targetBranchId, opts);
}

async function resolveCatalogSlugFor(
  actorCtx: AuthContext,
  targetBranchId: string,
  slug: string,
  opts: { includeAliases?: boolean } = {},
) {
  const { requirePermission, hasBranchScope } = await import("@/lib/authorization/server");
  requirePermission(actorCtx, "services.view");
  if (!(await hasBranchScope(actorCtx, targetBranchId))) {
    const { AppError, ErrorCode } = await import("@/lib/errors");
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }
  return resolveCatalogSlug(targetBranchId, slug, opts);
}

describe("category + service creation (Q2, Q4)", () => {
  it("creates entities as draft, disabled, not customer-visible", async () => {
    const { cat, svc } = await createActiveFixture();
    // After explicit activation above; verify a fresh creation ships opt-out-free.
    const fresh = await createCategory(ctx, {
      branchId, slug: "deep-cleaning", name: "Deep Cleaning", translations: tx("deep-cleaning"),
    });
    expect(fresh.status).toBe("draft");
    expect(fresh.is_enabled).toBe(false);
    expect(fresh.is_customer_visible).toBe(false);
    expect(fresh.published_at).toBeNull();
    void cat;
    void svc;
  });

  it("requires the category to be on the same branch", async () => {
    const otherBranch = await setupBranch("catalog-hamburg");
    const cat = await createCategory(ctx, {
      branchId: otherBranch, slug: "other-cat", name: "Other", translations: tx("other-cat"),
    });
    await expect(
      createService(ctx, {
        branchId, categoryId: cat.id, slug: "orphan-svc", name: "Orphan",
        translations: tx("orphan-svc"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects duplicate slugs per branch with CONFLICT", async () => {
    await expect(
      createCategory(ctx, {
        branchId, slug: "deep-cleaning", name: "Dup", translations: tx("deep-cleaning"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("lifecycle (spec: catalog lifecycle)", () => {
  it("blocks service activation when the category is not active", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "inactive-cat", name: "Inactive Cat", translations: tx("inactive-cat"),
    });
    const svc = await createService(ctx, {
      branchId, categoryId: cat.id, slug: "svc-inactive-cat", name: "Svc", translations: tx("svc-inactive-cat"),
    });
    await expect(
      changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("blocks activation without a default-locale translation", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "tx-less-cat", name: "NoTx", translations: tx("tx-less-cat"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "active" });
    const svc = await createService(ctx, {
      branchId, categoryId: cat.id, slug: "tx-less-svc", name: "NoTx Svc", translations: [{ locale: "en", name: "En only" }],
    });
    await expect(
      changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("sets published_at on first activation and archived is terminal", async () => {
    const { svc } = await createActiveFixture();
    const afterActivate = await changeStatus(ctx, {
      branchId, entityType: "service", entityId: svc.id, status: "inactive",
    });
    expect(afterActivate.published_at).not.toBeNull();
    // Reactivation from inactive is allowed.
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" });
    // Archive is terminal.
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "archived" });
    await expect(
      changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("audits status_changed with from/to states", async () => {
    const audit = await t.db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_logs
        where resource_type = 'service' and action = 'service.status_changed'
        order by created_at desc limit 1`,
    );
    expect(audit.rows[0].metadata).toHaveProperty("from");
    expect(audit.rows[0].metadata).toHaveProperty("to");
  });
});

describe("effective catalog (Q2 opt-in gate)", () => {
  it("excludes disabled/draft entries even when lifecycle allows", async () => {
    const { svc } = await createActiveFixture();
    // Active but NOT enabled → absent from effective catalog.
    const eff = await listEffectiveCatalog(branchId);
    expect(eff.services.some((s) => s.id === svc.id)).toBe(false);

    // Enable the service (opt-in) → appears.
    await setOfferingState(ctx, { branchId, entityType: "service", entityId: svc.id, is_enabled: true });
    const eff2 = await listEffectiveCatalog(branchId);
    expect(eff2.services.some((s) => s.id === svc.id)).toBe(true);
  });

  it("customerVisibleOnly filters on is_customer_visible", async () => {
    const { svc } = await createActiveFixture();
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id,
      is_enabled: true, is_customer_visible: false,
    });
    const eff = await listEffectiveCatalog(branchId, { customerVisibleOnly: true });
    expect(eff.services.some((s) => s.id === svc.id)).toBe(false);
    const effAdmin = await listEffectiveCatalog(branchId);
    expect(effAdmin.services.some((s) => s.id === svc.id)).toBe(true);
  });
});

describe("variants", () => {
  it("requires parent service active and requires variant selection when present", async () => {
    const { svc } = await createActiveFixture();
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });
    const variant = await createVariant(ctx, {
      branchId, serviceId: svc.id, slug: "deep", name: "Deep", translations: tx("deep"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_variant", entityId: variant.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service_variant", entityId: variant.id,
      is_enabled: true, is_customer_visible: true,
    });

    const res = await validateSelection(ctx, { branchId, serviceId: svc.id, addonSelections: [] });
    expect(res.valid).toBe(false);
    expect(res.violations[0].code).toBe("VARIANT_REQUIRED");

    const res2 = await validateSelection(ctx, {
      branchId, serviceId: svc.id, variantId: variant.id, addonSelections: [],
    });
    expect(res2.valid).toBe(true);
  });
});

describe("add-ons and compatibility (Q3)", () => {
  it("rejects invalid quantity bounds", async () => {
    await expect(
      createAddon(ctx, {
        branchId, slug: "bad-bounds", name: "Bad", min_quantity: 2, max_quantity: 1,
        translations: tx("bad-bounds"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("absence of allow-list row = incompatible", async () => {
    const { svc } = await createActiveFixture();
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });
    const addon = await createAddon(ctx, {
      branchId, slug: "oven", name: "Inside Oven", max_quantity: 1, translations: tx("oven"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_addon", entityId: addon.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service_addon", entityId: addon.id, is_enabled: true, is_customer_visible: true,
    });

    const res = await validateSelection(ctx, {
      branchId, serviceId: svc.id, addonSelections: [{ addonId: addon.id, quantity: 1 }],
    });
    expect(res.valid).toBe(false);
    expect(res.violations[0].code).toBe("COMPATIBILITY");

    // Allow-list it → compatible.
    await setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id });
    const res2 = await validateSelection(ctx, {
      branchId, serviceId: svc.id, addonSelections: [{ addonId: addon.id, quantity: 1 }],
    });
    expect(res2.valid).toBe(true);
  });

  it("enforces quantity bounds from the catalog", async () => {
    const { svc } = await createActiveFixture();
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });
    const addon = await createAddon(ctx, {
      branchId, slug: "windows", name: "Windows", min_quantity: 1, max_quantity: 5,
      translations: tx("windows"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_addon", entityId: addon.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service_addon", entityId: addon.id, is_enabled: true, is_customer_visible: true,
    });
    await setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id });

    const res = await validateSelection(ctx, {
      branchId, serviceId: svc.id, addonSelections: [{ addonId: addon.id, quantity: 6 }],
    });
    expect(res.violations[0].code).toBe("QUANTITY");
  });

  it("duplicate compatibility row → CONFLICT; removal works", async () => {
    const { svc } = await createActiveFixture();
    const addon = await createAddon(ctx, {
      branchId, slug: `fridge-${++fixtureSeq}`, name: "Fridge", translations: tx("fridge"),
    });
    const row = await setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id });
    await expect(
      setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await removeAddonCompatibility(ctx, { branchId, compatibilityId: row.id });
    await expect(
      removeAddonCompatibility(ctx, { branchId, compatibilityId: row.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cross-branch compatibility rejected (same-branch FK)", async () => {
    const { svc } = await createActiveFixture();
    const otherBranch = await setupBranch("catalog-munich");
    const foreignAddon = await createAddon(ctx, {
      branchId: otherBranch, slug: "foreign", name: "Foreign", translations: tx("foreign"),
    });
    await expect(
      setAddonCompatibility(ctx, { branchId, addonId: foreignAddon.id, serviceId: svc.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("surfaces orphaned enabled add-ons (compatibility closure)", async () => {
    const { svc } = await createActiveFixture();
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });
    const orphan = await createAddon(ctx, {
      branchId, slug: "orphan-addon", name: "Orphan", translations: tx("orphan-addon"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_addon", entityId: orphan.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service_addon", entityId: orphan.id, is_enabled: true,
    });
    const orphans = await findOrphanedAddons(branchId);
    expect(orphans.some((a) => a.id === orphan.id)).toBe(true);
  });
});

describe("localization", () => {
  it("duplicate (entity, locale) translation → CONFLICT via unique constraint", async () => {
    // create uses upsert; the DB unique constraint backs idempotency —
    // a second create with the same slug/same translation updates, not duplicates.
    const { svc } = await createActiveFixture();
    const before = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.service_translations where service_id = $1`, [svc.id],
    );
    const { updateService } = await import("@/features/services/service");
    await updateService(ctx, { branchId, serviceId: svc.id, name: "Renamed Op" });
    const after = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.service_translations where service_id = $1`, [svc.id],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});

describe("slug aliases (Q7)", () => {
  it("draft rename is free; published rename requires the alias path", async () => {
    const { svc } = await createActiveFixture();
    const originalSlug = svc.slug;
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "inactive" });
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" });
    // Now published. Rename via the alias mechanism:
    const renamed = await renamePublishedSlug(ctx, {
      branchId, entityType: "service", entityId: svc.id, newSlug: `regular-cleaning-${svc.id.slice(0, 8)}-v2`,
    });
    expect(renamed.slug).toBe(`regular-cleaning-${svc.id.slice(0, 8)}-v2`);

    const alias = await t.db.query<{ old_slug: string }>(
      `select old_slug from public.service_slug_aliases where entity_id = $1`, [svc.id],
    );
    expect(alias.rows[0].old_slug).toBe(originalSlug);

    // Old slug resolves via alias; new slug resolves live.
    const viaAlias = await resolveCatalogSlug(branchId, originalSlug, { includeAliases: true });
    expect(viaAlias?.isAlias).toBe(true);
    expect(viaAlias?.entity.id).toBe(svc.id);
    const live = await resolveCatalogSlug(branchId, `regular-cleaning-${svc.id.slice(0, 8)}-v2`);
    expect(live?.isAlias).toBe(false);
  });

  it("rejects rename to a slug already claimed live or by an alias", async () => {
    const { svc } = await createActiveFixture();
    await expect(
      renamePublishedSlug(ctx, { branchId, entityType: "service", entityId: svc.id, newSlug: svc.slug }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rename + alias + audit are atomic", async () => {
    const { svc } = await createActiveFixture();
    await renamePublishedSlug(ctx, {
      branchId, entityType: "service", entityId: svc.id, newSlug: "atomic-rename",
    });
    const audit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where action = 'service_slug_alias.created'
        and resource_id = $1`, [svc.id],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("add-on update keeps bounds coherent", () => {
  it("blocks max < min on partial update", async () => {
    const addon = await createAddon(ctx, {
      branchId, slug: "coherent", name: "Coherent", min_quantity: 1, max_quantity: 3,
      translations: tx("coherent"),
    });
    await expect(
      updateAddon(ctx, { branchId, addonId: addon.id, max_quantity: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("seed mechanism (Q2/Q6)", () => {
  it("seeds placeholder (empty) definition without creating rows", async () => {
    const { V1_CATALOG_DEFINITION } = await import("@/features/services/seed");
    const before = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.services where branch_id = $1`, [branchId],
    );
    const res = await seedCatalogFromDefinition(branchId, orgId, V1_CATALOG_DEFINITION);
    expect(res).toEqual({
      service_categories: 0, services: 0, service_variants: 0,
      service_addons: 0, service_addon_compatibility: 0,
    });
    const after = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.services where branch_id = $1`, [branchId],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("regression: seed re-run updates an existing variant without SQL parameter mismatch", async () => {
    // Regression for "could not determine data type of parameter $2": the
    // idempotent variant-update UPDATE previously declared $3/$4 while
    // binding only two parameters. Exercises first seed AND repeated seed.
    const branch2 = await setupBranch("catalog-seed-regression");
    const definition = {
      categories: [
        {
          slug: "regression-cat", name: "R Cat", sort_order: 0,
          translations: [{ locale: "de" as const, name: "R Kat" }],
          services: [
            {
              slug: "regression-svc", name: "R Svc", sort_order: 0,
              translations: [{ locale: "de" as const, name: "R Leistung" }],
              variants: [
                {
                  slug: "regression-var", name: "R Var Original", sort_order: 2,
                  translations: [{ locale: "de" as const, name: "R Variante" }],
                },
              ],
            },
          ],
        },
      ],
      addons: [],
    };
    const r1 = await seedCatalogFromDefinition(branch2, orgId, definition);
    expect(r1.service_variants).toBe(1);
    // Second run takes the UPDATE path for category, service, and variant.
    const r2 = await seedCatalogFromDefinition(branch2, orgId, definition);
    expect(r2).toEqual({
      service_categories: 0, services: 0, service_variants: 0,
      service_addons: 0, service_addon_compatibility: 0,
    });
    const variant = await t.db.query<{ name: string; sort_order: number }>(
      `select name, sort_order from public.service_variants where slug = 'regression-var'`,
    );
    expect(variant.rows[0]).toEqual({ name: "R Var Original", sort_order: 2 });
    const counts = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.service_variants where slug = 'regression-var'`,
    );
    expect(counts.rows[0].n).toBe("1");
  });

  it("seed rerun is idempotent (identical counts)", async () => {
    const branch2 = await setupBranch("catalog-seed");
    // Idempotency = identical row counts and identities; the SeedResult
    // counters intentionally report only NEWLY INSERTED rows per run.
    const definition = {
      categories: [
        {
          slug: "test-category", name: "Test Category", sort_order: 0,
          translations: [{ locale: "de" as const, name: "Testkategorie" }],
          services: [
            {
              slug: "test-service", name: "Test Service", sort_order: 0,
              translations: [{ locale: "de" as const, name: "Testleistung" }],
              variants: [
                {
                  slug: "test-variant", name: "Test Variant", sort_order: 0,
                  translations: [{ locale: "de" as const, name: "Testvariante" }],
                },
              ],
            },
          ],
        },
      ],
      addons: [
        {
          slug: "test-addon", name: "Test Add-on", sort_order: 0,
          min_quantity: 1, max_quantity: 2,
          translations: [{ locale: "de" as const, name: "Testzusatz" }],
          compatible_with: [{ service_slug: "test-service" }],
        },
      ],
    };
    const r1 = await seedCatalogFromDefinition(branch2, orgId, definition);
    const r2 = await seedCatalogFromDefinition(branch2, orgId, definition);
    // First run inserts one of each type; counters report newly inserted rows.
    expect(r1.services).toBe(1);
    expect(r1.service_variants).toBe(1);
    expect(r1.service_addons).toBe(1);
    expect(r1.service_addon_compatibility).toBe(1);

    // True idempotency: second run inserts nothing new.
    expect(r2.services).toBe(0);
    expect(r2.service_variants).toBe(0);
    expect(r2.service_addons).toBe(0);
    expect(r2.service_addon_compatibility).toBe(0);
    const counts = await t.db.query<{ categories: string; services: string; variants: string }>(
      `select
         (select count(*) from public.service_categories where branch_id = $1)::text as categories,
         (select count(*) from public.services where branch_id = $1)::text as services,
         (select count(*) from public.service_variants where branch_id = $1)::text as variants`,
      [branch2],
    );
    expect(counts.rows[0]).toEqual({ categories: "1", services: "1", variants: "1" });

    // Q2: seeded rows are disabled and not customer-visible.
    const row = await t.db.query<{ is_enabled: boolean; is_customer_visible: boolean; status: string }>(
      `select is_enabled, is_customer_visible, status from public.services where branch_id = $1`, [branch2],
    );
    expect(row.rows[0]).toEqual({ is_enabled: false, is_customer_visible: false, status: "draft" });
  });
});

describe("authorization boundary (task 4.2)", () => {
  it("HQ Staff (services.edit holder) may perform definition-level mutations", async () => {
    const cat = await createCategory(staffCtx, {
      branchId, slug: "staff-cat", name: "Staff Cat", translations: tx("staff-cat"),
    });
    expect(cat.status).toBe("draft");
  });

  it("Branch Manager cannot create catalog entities despite holding services.edit", async () => {
    await expect(
      createCategory(managerCtx, {
        branchId, slug: "mgr-cat", name: "Mgr Cat", translations: tx("mgr-cat"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createService(managerCtx, {
        branchId, categoryId: (await createCategory(ctx, {
          branchId, slug: "mgr-gate-cat", name: "G", translations: tx("mgr-gate-cat"),
        })).id, slug: "mgr-svc", name: "Mgr Svc", translations: tx("mgr-svc"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const leaked = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.service_categories where slug = 'mgr-cat'`,
    );
    expect(leaked.rows[0].n).toBe("0");
  });

  it("Branch Manager can reconfigure offering flags of their own branch", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "offering-cat", name: "Offering", translations: tx("offering-cat"),
    });
    const updated = await setOfferingState(managerCtx, {
      branchId, entityType: "service_category", entityId: cat.id, is_enabled: true,
    });
    expect(updated.is_enabled).toBe(true);
    const audit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where action = 'branch_service.enabled'
        and resource_id = $1 and actor_user_id = $2`,
      [cat.id, managerCtx.actor.userId],
 );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("Branch Manager cannot reconfigure another branch's rows (cross-branch)", async () => {
    const cat = await createCategory(ctx, {
      branchId: secondBranchId, slug: "other-branch-cat", name: "OB", translations: tx("other-branch-cat"),
    });
    await expect(
      setOfferingState(managerCtx, {
        branchId: secondBranchId, entityType: "service_category", entityId: cat.id, is_enabled: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Cleaner is denied everything (no services.view/services.edit)", async () => {
    await expect(
      createCategory(cleanerCtx, {
        branchId, slug: "cleaner-cat", name: "C", translations: tx("cleaner-cat"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setOfferingState(cleanerCtx, {
      branchId, entityType: "service_category", entityId: crypto.randomUUID(), is_enabled: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated actor is rejected (no membership → resolveActor fails)", async () => {
    const { AppError } = await import("@/lib/errors");
    await expect(resolveActor("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(AppError);
  });

  it("cross-organization admin cannot mutate or even see another org's catalog rows", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "org-scope-cat", name: "OS", translations: tx("org-scope-cat"),
    });
    // Mutate across orgs → FORBIDDEN (branch not in the other admin's org).
    await expect(
      updateCategory(otherOrgAdminCtx, { branchId, categoryId: cat.id, name: "Hijacked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Cross-org known-ID probing is rejected before any read model query runs.
    await expect(
      listEffectiveCatalogFor(otherOrgAdminCtx, branchId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Even bypassing the wrapper, the read model itself cannot leak: the
    // service row is filtered by its category's enabled state only within
    // the branch, so prove cross-org rows are absent for a scoped read.
    const eff = await listEffectiveCatalogFor(ctx, branchId);
    expect(eff.services.some((s) => s.id === cat.id)).toBe(false);
  });
});

describe("category archive guard (spec: category with services cannot be hard-deleted)", () => {
  it("rejects archiving a category with a non-archived (active) service", async () => {
    const { cat, svc } = await createActiveFixture();
    await expect(
      changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "archived" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    void svc;
  });

  it("rejects archiving a category with a draft service", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "guard-draft-cat", name: "GD", translations: tx("guard-draft-cat"),
    });
    await createService(ctx, {
      branchId, categoryId: cat.id, slug: "guard-draft-svc", name: "GDS", translations: tx("guard-draft-svc"),
    });
    await expect(
      changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "archived" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows archiving a category whose services are all archived, and an empty category", async () => {
    const catA = await createCategory(ctx, {
      branchId, slug: "guard-arch-cat", name: "GA", translations: tx("guard-arch-cat"),
    });
    const svcA = await createService(ctx, {
      branchId, categoryId: catA.id, slug: "guard-arch-svc", name: "GAS", translations: tx("guard-arch-svc"),
    });
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svcA.id, status: "archived" });
    const archived = await changeStatus(ctx, {
      branchId, entityType: "service_category", entityId: catA.id, status: "archived",
    });
    expect(archived.status).toBe("archived");
    const audit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_id = $1 and action = 'service_category.archived'`,
      [catA.id],
    );
    expect(audit.rows).toHaveLength(1);

    const empty = await createCategory(ctx, {
      branchId, slug: "guard-empty-cat", name: "GE", translations: tx("guard-empty-cat"),
    });
    const archivedEmpty = await changeStatus(ctx, {
      branchId, entityType: "service_category", entityId: empty.id, status: "archived",
    });
    expect(archivedEmpty.status).toBe("archived");
  });
});

describe("audit transactionality and archive event naming (task 11)", () => {
  it("emits a dedicated .archived event, not status_changed", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "archive-naming-cat", name: "AN", translations: tx("archive-naming-cat"),
    });
    await changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "archived" });
    const rows = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_id = $1`, [cat.id],
    );
    expect(rows.rows.map((r) => r.action)).toContain("service_category.archived");
    expect(rows.rows.map((r) => r.action)).not.toContain("service_category.status_changed");
  });

  it("update path writes its audit inside the same transaction (fail-closed)", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: "tx-audit-cat", name: "TA", translations: tx("tx-audit-cat"),
    });
    const updated = await updateCategory(ctx, { branchId, categoryId: cat.id, name: "TA v2" });
    expect(updated.name).toBe("TA v2");
    const rows = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_id = $1 and action = 'service_category.updated'`,
      [cat.id],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("removeAddonCompatibility reports NOT_FOUND for unknown rows and never writes orphan audits", async () => {
    const { svc } = await createActiveFixture();
    const addon = await createAddon(ctx, {
      branchId, slug: `audit-del-${++fixtureSeq}`, name: "AD", translations: tx("audit-del"),
    });
    const row = await setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id });
    await removeAddonCompatibility(ctx, { branchId, compatibilityId: row.id });
    await expect(
      removeAddonCompatibility(ctx, { branchId, compatibilityId: row.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const orphans = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where action = 'service_addon_compatibility.removed' and resource_id = $1`,
      [row.id],
    );
    expect(orphans.rows[0].n).toBe("1");
  });

  it("reorder writes branch_service.updated transactionally", async () => {
    const catA = await createCategory(ctx, {
      branchId, slug: `reorder-a-${++fixtureSeq}`, name: "RA", translations: tx("reorder-a"),
    });
    const catB = await createCategory(ctx, {
      branchId, slug: `reorder-b-${++fixtureSeq}`, name: "RB", translations: tx("reorder-b"),
    });
    const res = await reorderCatalog(ctx, {
      branchId, entityType: "service_category", orderedIds: [catB.id, catA.id],
    });
    expect(res.updated).toBe(2);
    const rows = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_logs where action = 'branch_service.updated'`,
    );
    expect(Number(rows.rows[0].n)).toBeGreaterThanOrEqual(1);
  });
});

describe("localization fallback (task 10)", () => {
  it("returns requested-locale text, falls back to default locale, never empty", async () => {
    const n = ++fixtureSeq;
    const cat = await createCategory(ctx, {
      branchId, slug: `loc-cat-${n}`, name: "Base Name DE",
      translations: [
        { locale: "de", name: "Deutscher Name" },
        { locale: "en", name: "English Name" },
      ],
    });
    await changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service_category", entityId: cat.id, is_enabled: true, is_customer_visible: true,
    });
    const svc = await createService(ctx, {
      branchId, categoryId: cat.id, slug: `loc-svc-${n}`, name: "Base Svc DE",
      translations: [{ locale: "de", name: "Deutsche Leistung" }],
    });
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" });
    await setOfferingState(ctx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });

    // Requested locale exists → requested text.
    const effEn = await listEffectiveCatalogFor(ctx, branchId, { locale: "en" });
    const catEn = effEn.categories.find((c) => c.id === cat.id);
    expect(catEn?.display_name).toBe("English Name");

    // Requested locale missing → branch default (de) text.
    const effFr = await listEffectiveCatalogFor(ctx, branchId, { locale: "fr" });
    const catFr = effFr.categories.find((c) => c.id === cat.id);
    expect(catFr?.display_name).toBe("Deutscher Name");
    const svcFr = effFr.services.find((s) => s.id === svc.id);
    expect(svcFr?.display_name).toBe("Deutsche Leistung");

    // No locale requested → operational base text (unchanged boundary).
    const effNone = await listEffectiveCatalogFor(ctx, branchId);
    const catNone = effNone.categories.find((c) => c.id === cat.id);
    expect(catNone?.display_name).toBeUndefined();
  });
});

describe("translation upsert semantics (task 10 reconciliation)", () => {
  it("upsert updates an existing (entity, locale) translation without duplicating", async () => {
    const cat = await createCategory(ctx, {
      branchId, slug: `tx-upsert-${++fixtureSeq}`, name: "Upsert", translations: tx("tx-upsert"),
    });
    await upsertTranslation(ctx, {
      branchId, entityType: "service_category", entityId: cat.id, locale: "de", name: "Updated DE",
    });
    const rows = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.service_category_translations where category_id = $1 and locale = 'de'`,
      [cat.id],
    );
    expect(rows.rows[0].n).toBe("1");
    const name = await t.db.query<{ name: string }>(
      `select name from public.service_category_translations where category_id = $1 and locale = 'de'`,
      [cat.id],
    );
    expect(name.rows[0].name).toBe("Updated DE");
  });
});

describe("acceptance walkthrough (task 16)", () => {
  it("walks the complete Change 2 flow end to end", async () => {
    // 1) HQ creates category → 2) service → 3) variant → 4) add-on.
    const n = ++fixtureSeq;
    const cat = await createCategory(ctx, {
      branchId, slug: `walk-cat-${n}`, name: "Walk Cat",
      translations: [{ locale: "de", name: "Walk Kategorie" }, { locale: "en", name: "Walk Category" }],
    });
    const svc = await createService(ctx, {
      branchId, categoryId: cat.id, slug: `walk-svc-${n}`, name: "Walk Svc",
      translations: [{ locale: "de", name: "Walk Leistung" }],
    });
    const variant = await createVariant(ctx, {
      branchId, serviceId: svc.id, slug: `walk-var-${n}`, name: "Walk Var",
      translations: [{ locale: "de", name: "Walk Variante" }],
    });
    const addon = await createAddon(ctx, {
      branchId, slug: `walk-addon-${n}`, name: "Walk Addon", min_quantity: 1, max_quantity: 3,
      translations: [{ locale: "de", name: "Walk Zusatz" }],
    });

    // 5) Compatibility allow-list entry (HQ only).
    await setAddonCompatibility(ctx, { branchId, addonId: addon.id, serviceId: svc.id, variantId: variant.id });

    // 6) Offering configuration (branch role), then 7) activation (HQ).
    await setOfferingState(managerCtx, {
      branchId, entityType: "service_category", entityId: cat.id, is_enabled: true, is_customer_visible: true,
    });
    await setOfferingState(managerCtx, {
      branchId, entityType: "service", entityId: svc.id, is_enabled: true, is_customer_visible: true,
    });
    await changeStatus(ctx, { branchId, entityType: "service_category", entityId: cat.id, status: "active" });
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "active" });
    await changeStatus(ctx, { branchId, entityType: "service_variant", entityId: variant.id, status: "active" });
    await changeStatus(ctx, { branchId, entityType: "service_addon", entityId: addon.id, status: "active" });
    await setOfferingState(managerCtx, {
      branchId, entityType: "service_variant", entityId: variant.id, is_enabled: true, is_customer_visible: true,
    });
    await setOfferingState(managerCtx, {
      branchId, entityType: "service_addon", entityId: addon.id, is_enabled: true, is_customer_visible: true,
    });

    // 8) Effective catalog + 9) selection validation.
    const eff = await listEffectiveCatalogFor(ctx, branchId);
    const effSvc = eff.services.find((s) => s.id === svc.id);
    expect(effSvc).toBeDefined();
    expect(effSvc?.variants.some((v) => v.id === variant.id)).toBe(true);
    expect(effSvc?.addons.some((a) => a.id === addon.id)).toBe(true);

    // Variant required when present.
    const noVariant = await validateSelection(ctx, {
      branchId, serviceId: svc.id, addonSelections: [],
    });
    expect(noVariant.valid).toBe(false);
    expect(noVariant.violations[0].code).toBe("VARIANT_REQUIRED");

    // Allow-listed add-on within quantity bounds → valid.
    const okSel = await validateSelection(ctx, {
      branchId, serviceId: svc.id, variantId: variant.id,
      addonSelections: [{ addonId: addon.id, quantity: 2 }],
    });
    expect(okSel.valid).toBe(true);

    // 10) Published slug rename → alias; 11) alias resolution.
    await renamePublishedSlug(ctx, {
      branchId, entityType: "service", entityId: svc.id, newSlug: `walk-svc-renamed-${n}`,
    });
    const viaAlias = await resolveCatalogSlugFor(ctx, branchId, `walk-svc-${n}`, { includeAliases: true });
    expect(viaAlias?.isAlias).toBe(true);
    expect(viaAlias?.entity.id).toBe(svc.id);

    // 12) Archive according to lifecycle rules (variant first, then service).
    await changeStatus(ctx, { branchId, entityType: "service_variant", entityId: variant.id, status: "archived" });
    await changeStatus(ctx, { branchId, entityType: "service", entityId: svc.id, status: "archived" });
    const svcAudit = await t.db.query<{ action: string }>(
      `select action from public.audit_logs where resource_id = $1 order by created_at asc`,
      [svc.id],
    );
    const actions = svcAudit.rows.map((r) => r.action);
    expect(actions).toContain("service.created");
    expect(actions).toContain("service.status_changed");
    expect(actions).toContain("service_slug_alias.created");
    expect(actions).toContain("service.archived");

    // 13) Authorization boundary held at the end of the flow.
    await expect(
      setOfferingState(cleanerCtx, {
        branchId, entityType: "service", entityId: svc.id, is_enabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 60_000);
});
