"use server";

/**
 * Server Actions for the service catalog (API_STANDARDS.md §4: thin —
 * authenticate → authorize → validate → domain service → typed result).
 * No business logic lives here; all logic is in features/services/service.ts.
 */
import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
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
  updateService,
  updateVariant,
  upsertTranslation,
  validateSelection,
  type CatalogRow,
  type CompatibilityRow,
  type EffectiveCatalog,
  type SelectionViolation,
  type SlugResolution,
} from "./service";
import { seedCatalogFromDefinition, type CatalogDefinition, type SeedResult } from "./seed";

async function currentContext(): Promise<AuthContext> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  ctx.requestId = randomUUID();
  return ctx;
}

function run<T>(fn: (ctx: AuthContext) => Promise<T>): Promise<Result<T>> {
  return (async () => {
    try {
      const ctx = await currentContext();
      return ok(await fn(ctx), ctx.requestId);
    } catch (err) {
      const appErr = toAppError(err);
      return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
    }
  })();
}

// -- Category ------------------------------------------------------------
export async function createCategoryAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => createCategory(ctx, input));
}
export async function updateCategoryAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => updateCategory(ctx, input));
}

// -- Service -------------------------------------------------------------
export async function createServiceAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => createService(ctx, input));
}
export async function updateServiceAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => updateService(ctx, input));
}

// -- Variant -------------------------------------------------------------
export async function createVariantAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => createVariant(ctx, input));
}
export async function updateVariantAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => updateVariant(ctx, input));
}

// -- Add-on --------------------------------------------------------------
export async function createAddonAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => createAddon(ctx, input));
}
export async function updateAddonAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => updateAddon(ctx, input));
}

// -- Lifecycle -----------------------------------------------------------
export async function changeStatusAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => changeStatus(ctx, input));
}

// -- Branch offering configuration (Q2) ----------------------------------
export async function setOfferingStateAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => setOfferingState(ctx, input));
}
export async function reorderCatalogAction(input: unknown): Promise<Result<{ updated: number }>> {
  return run((ctx) => reorderCatalog(ctx, input));
}

// -- Compatibility (Q3) --------------------------------------------------
export async function setAddonCompatibilityAction(input: unknown): Promise<Result<CompatibilityRow>> {
  return run((ctx) => setAddonCompatibility(ctx, input));
}
export async function removeAddonCompatibilityAction(input: unknown): Promise<Result<void>> {
  return run((ctx) => removeAddonCompatibility(ctx, input));
}
export async function findOrphanedAddonsAction(
  branchId: string,
): Promise<Result<CatalogRow[]>> {
  return run(async (ctx) => {
    const { requirePermission, hasBranchScope } = await import("@/lib/authorization/server");
    requirePermission(ctx, "services.view");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    if (!(await hasBranchScope(ctx, branchId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
    return findOrphanedAddons(branchId);
  });
}

// -- Localization --------------------------------------------------------
export async function upsertTranslationAction(input: unknown): Promise<Result<void>> {
  return run((ctx) => upsertTranslation(ctx, input));
}

// -- Slug alias handling (Q7) --------------------------------------------
export async function renamePublishedSlugAction(input: unknown): Promise<Result<CatalogRow>> {
  return run((ctx) => renamePublishedSlug(ctx, input));
}
export async function resolveCatalogSlugAction(
  branchId: string,
  slug: string,
  includeAliases = false,
): Promise<Result<SlugResolution | null>> {
  return run(async (ctx) => {
    const { requirePermission, hasBranchScope } = await import("@/lib/authorization/server");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    requirePermission(ctx, "services.view");
    if (!(await hasBranchScope(ctx, branchId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
    return resolveCatalogSlug(branchId, slug, { includeAliases });
  });
}

// -- Effective catalog / selection validation ----------------------------
export async function listEffectiveCatalogAction(
  branchId: string,
  opts: { locale?: string; customerVisibleOnly?: boolean } = {},
): Promise<Result<EffectiveCatalog>> {
  return run(async (ctx) => {
    const { requirePermission, hasBranchScope } = await import("@/lib/authorization/server");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    requirePermission(ctx, "services.view");
    if (!(await hasBranchScope(ctx, branchId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
    return listEffectiveCatalog(branchId, opts);
  });
}

export async function validateSelectionAction(
  input: unknown,
): Promise<Result<{ valid: boolean; violations: SelectionViolation[] }>> {
  return run((ctx) => validateSelection(ctx, input));
}

// -- Seed (structure only; V1 content pending business approval, Q6) ------
export async function seedCatalogAction(
  branchId: string,
  definition: CatalogDefinition,
): Promise<Result<SeedResult>> {
  return run(async (ctx) => {
    const { requireOrganizationAccess, requirePermission, hasBranchScope } =
      await import("@/lib/authorization/server");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    requirePermission(ctx, "services.edit");
    // Seeding is a definition-level mutation → HQ role only (design §11).
    const { requireHqActor } = await import("./service");
    requireHqActor(ctx);
    requireOrganizationAccess(ctx, ctx.actor.organizationId);
    if (!(await hasBranchScope(ctx, branchId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
    return seedCatalogFromDefinition(branchId, ctx.actor.organizationId, definition);
  });
}
