/**
 * Service catalog domain service (openspec/changes/create-service-catalog).
 *
 * Authorization (Q8): only `services.view` / `services.edit` from the
 * canonical catalog. HQ roles (org scope) may create/update/lifecycle
 * entities, manage compatibility and aliases; branch-scoped roles may only
 * reconfigure offering flags of their own branches
 * (docs/SERVICE_CATALOG.md §8.2–8.3, §18).
 *
 * Decisions encoded:
 *   Q2  every created row is disabled + not customer-visible; missing or
 *       disabled offering = NOT OFFERED; no implicit enablement exists.
 *   Q3  compatibility = explicit allow-list rows only.
 *   Q4  categories are first-class entities (category_id FK).
 *   Q5  no pricing data is read or written by this module.
 *   Q7  internal IDs immutable; published slugs frozen; renames go through
 *     the audited alias mechanism (atomic slug update + alias insert).
 *   Q9  branch_id NOT NULL everywhere; organization from authenticated ctx.
 *
 * Audit: every mutation writes its `resource.action` event inside the same
 * transaction (fail-closed, AUDIT_SYSTEM §50/§101). Telemetry is emitted
 * outside transactions and is diagnostic only.
 */
import "server-only";
import {
  changeStatusSchema,
  createAddonSchema,
  createCategorySchema,
  createServiceSchema,
  createVariantSchema,
  normalizeSlug,
  removeCompatibilitySchema,
  renameSlugSchema,
  reorderCatalogSchema,
  setCompatibilitySchema,
  setOfferingStateSchema,
  updateAddonSchema,
  updateCategorySchema,
  updateServiceSchema,
  updateVariantSchema,
  upsertTranslationSchema,
  validateSelectionSchema,
  type CatalogEntityType,
  type ChangeStatusInput,
  type CreateAddonInput,
  type CreateCategoryInput,
  type CreateServiceInput,
  type CreateVariantInput,
  type RemoveCompatibilityInput,
  type RenameSlugInput,
  type ReorderCatalogInput,
  type SetCompatibilityInput,
  type SetOfferingStateInput,
  type UpdateAddonInput,
  type UpdateCategoryInput,
  type UpdateServiceInput,
  type UpdateVariantInput,
  type UpsertTranslationInput,
  type ValidateSelectionInput,
} from "./schemas/catalog";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { metrics } from "@/lib/observability/logger";

// ---------------------------------------------------------------------
// Table/alias plumbing per entity type
// ---------------------------------------------------------------------

const ENTITIES = {
  service_category: {
    table: "service_categories",
    idCol: "category_id",
    pkCol: "id",
    translationTable: "service_category_translations",
    auditPrefix: "service_category",
    aliasType: null,
  },
  service: {
    table: "services",
    idCol: "service_id",
    pkCol: "id",
    translationTable: "service_translations",
    auditPrefix: "service",
    aliasType: "service" as const,
  },
  service_variant: {
    table: "service_variants",
    idCol: "variant_id",
    pkCol: "id",
    translationTable: "service_variant_translations",
    auditPrefix: "service_variant",
    aliasType: "service_variant" as const,
  },
  service_addon: {
    table: "service_addons",
    idCol: "addon_id",
    pkCol: "id",
    translationTable: "service_addon_translations",
    auditPrefix: "service_addon",
    aliasType: "service_addon" as const,
  },
} as const;

function entityOf(t: CatalogEntityType) {
  return ENTITIES[t];
}

/** Convert a 23505 unique-violation into a stable CONFLICT error. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/** Parse validation failures into the stable INVALID_INPUT shape. */
function parseOrThrow<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T; error?: { issues: { path: (string | number | symbol)[]; message: string }[] } } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error!.issues) {
      const key = issue.path.join(".") || "_root";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new AppError(ErrorCode.INVALID_INPUT, "Invalid catalog input.", fieldErrors);
  }
  return parsed.data as T;
}

/**
 * Branch scope: HQ roles operate org-wide; branch roles must hold an
 * explicit membership_branches row for the target branch (and it must be a
 * branch of their organization).
 *
 * The branch must belong to the actor's organization — checked against the
 * authoritative membership, never a client-supplied organization_id.
 */
export async function assertBranchScope(ctx: AuthContext, branchId: string): Promise<void> {
  requireOrganizationAccess(ctx, ctx.actor.organizationId);
  const res = await query<{ exists: boolean }>(
    `select exists(
       select 1 from public.branches b
        where b.id = $1 and b.organization_id = $2
     ) as exists`,
    [branchId, ctx.actor.organizationId],
  );
  if (res.rows[0]?.exists !== true) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch is not part of your organization.");
  }
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }
}

/**
 * Role boundary for definition-level (master catalog) mutations (Q8:
 * permission vocabulary stays services.view/services.edit; the ROLE decides
 * whether a services.edit holder may perform definition mutations).
 *
 * docs/SECURITY.md §9 grants Branch Manager "local services" management
 * (offering configuration); spec.md "Authorization uses the existing
 * permission catalog" forbids branch-scoped users from creating/deleting
 * catalog entities or changing lifecycle states — that authority belongs to
 * HQ roles (docs/SECURITY.md §7–8).
 */
export function requireHqActor(ctx: AuthContext): void {
  if (ctx.actor.role !== "hq_admin" && ctx.actor.role !== "hq_staff") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Definition-level catalog changes require an HQ role.",
    );
  }
}

/** Fetch one entity row, enforcing organization membership. */
export interface CatalogRow {
  id: string;
  organization_id: string;
  branch_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "inactive" | "archived";
  sort_order: number;
  is_enabled: boolean;
  is_customer_visible: boolean;
  published_at: Date | null;
  category_id?: string;
  service_id?: string;
  min_quantity?: number;
  max_quantity?: number;
  [key: string]: unknown;
}

async function getEntityRow(
  entityType: CatalogEntityType,
  organizationId: string,
  branchId: string,
  entityId: string,
): Promise<CatalogRow> {
  const e = entityOf(entityType);
  const res = await query<CatalogRow>(
    `select * from public.${e.table} where id = $1 and branch_id = $2 and organization_id = $3`,
    [entityId, branchId, organizationId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Catalog entry not found.");
  return row;
}


/** Org-scope wrapper: organization is resolved from the authenticated context. */
async function withOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  void organizationId;
  return fn();
}

// =====================================================================
// Category operations
// =====================================================================

export async function createCategory(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<CreateCategoryInput>(createCategorySchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const slug = normalizeSlug(input.slug);

  return await withOrg(orgId, async () => {
    try {
      return await withTransaction(async (tx) => {
        const res = await tx.query<CatalogRow>(
          `insert into public.service_categories
             (organization_id, branch_id, slug, name, description, sort_order, status)
           values ($1, $2, $3, $4, $5, $6, 'draft')
           returning *`,
          [orgId, input.branchId, slug, input.name, input.description ?? null, input.sort_order ?? 0],
        );
        const row = res.rows[0];
        await writeTranslations(tx, "service_category_translations", "category_id", row.id, input.translations);
        await writeAuditEvent(
          {
            action: "service_category.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service_category", resourceId: row.id,
            requestId: ctx.requestId ?? null, metadata: { slug },
          },
          tx,
        );
        // Q2: created rows are disabled + not customer-visible (DB defaults) —
        // the row above never sets is_enabled/is_customer_visible.
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "A category with this slug already exists on this branch.");
      }
      throw err;
    }
  });
}

export async function updateCategory(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<UpdateCategoryInput>(updateCategorySchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  return await withOrg(orgId, async () => {
    await getEntityRow("service_category", orgId, input.branchId, input.categoryId);
    // Audit is transactional with the state change (fail-closed).
    return await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.service_categories
            set name = coalesce($2, name),
                description = coalesce($3, description),
                sort_order = coalesce($4, sort_order),
                updated_at = now()
          where id = $1
          returning *`,
        [input.categoryId, input.name ?? null, input.description ?? null, input.sort_order ?? null],
      );
      await writeAuditEvent({
        action: "service_category.updated", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: "service_category", resourceId: input.categoryId,
        requestId: ctx.requestId ?? null, metadata: { fields: Object.keys(input).filter((k) => !["branchId", "categoryId"].includes(k)) },
      }, tx);
      return res.rows[0];
    });
  });
}

// =====================================================================
// Service operations (Q4: category_id FK required)
// =====================================================================

export async function createService(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<CreateServiceInput>(createServiceSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const slug = normalizeSlug(input.slug);

  return await withOrg(orgId, async () => {
    try {
      return await withTransaction(async (tx) => {
        // Invariant: the category must belong to the same branch/org.
        const cat = await tx.query<{ id: string }>(
          `select id from public.service_categories where id = $1 and branch_id = $2 and organization_id = $3`,
          [input.categoryId, input.branchId, orgId],
        );
        if (cat.rows.length === 0) {
          throw new AppError(ErrorCode.INVALID_INPUT, "Category does not exist on this branch.");
        }
        const res = await tx.query<CatalogRow>(
          `insert into public.services
             (organization_id, branch_id, category_id, slug, name, description, sort_order, status)
           values ($1, $2, $3, $4, $5, $6, $7, 'draft')
           returning *`,
          [orgId, input.branchId, input.categoryId, slug, input.name, input.description ?? null, input.sort_order ?? 0],
        );
        const row = res.rows[0];
        await writeTranslations(tx, "service_translations", "service_id", row.id, input.translations);
        await writeAuditEvent(
          {
            action: "service.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service", resourceId: row.id,
            requestId: ctx.requestId ?? null, metadata: { slug, category_id: input.categoryId },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "A service with this slug already exists on this branch.");
      }
      throw err;
    }
  });
}

export async function updateService(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<UpdateServiceInput>(updateServiceSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  return await withOrg(orgId, async () => {
    await getEntityRow("service", orgId, input.branchId, input.serviceId);
    if (input.categoryId) {
      const cat = await query(
        `select id from public.service_categories where id = $1 and branch_id = $2 and organization_id = $3`,
        [input.categoryId, input.branchId, orgId],
      );
      if (cat.rows.length === 0) {
        throw new AppError(ErrorCode.INVALID_INPUT, "Category does not exist on this branch.");
      }
    }
    // Audit is transactional with the state change (fail-closed).
    return await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.services
            set category_id = coalesce($2, category_id),
                name = coalesce($3, name),
                description = coalesce($4, description),
                sort_order = coalesce($5, sort_order),
                updated_at = now()
          where id = $1
          returning *`,
        [input.serviceId, input.categoryId ?? null, input.name ?? null, input.description ?? null, input.sort_order ?? null],
      );
      await writeAuditEvent({
        action: "service.updated", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: "service", resourceId: input.serviceId,
        requestId: ctx.requestId ?? null, metadata: { fields: Object.keys(input).filter((k) => !["branchId", "serviceId"].includes(k)) },
      }, tx);
      return res.rows[0];
    });
  });
}

// =====================================================================
// Variant operations
// =====================================================================

export async function createVariant(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<CreateVariantInput>(createVariantSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const slug = normalizeSlug(input.slug);

  return await withOrg(orgId, async () => {
    try {
      return await withTransaction(async (tx) => {
        const svc = await tx.query<{ id: string }>(
          `select id from public.services where id = $1 and branch_id = $2 and organization_id = $3`,
          [input.serviceId, input.branchId, orgId],
        );
        if (svc.rows.length === 0) {
          throw new AppError(ErrorCode.INVALID_INPUT, "Service does not exist on this branch.");
        }
        const res = await tx.query<CatalogRow>(
          `insert into public.service_variants
             (organization_id, branch_id, service_id, slug, name, description, sort_order, status)
           values ($1, $2, $3, $4, $5, $6, $7, 'draft')
           returning *`,
          [orgId, input.branchId, input.serviceId, slug, input.name, input.description ?? null, input.sort_order ?? 0],
        );
        const row = res.rows[0];
        await writeTranslations(tx, "service_variant_translations", "variant_id", row.id, input.translations);
        await writeAuditEvent(
          {
            action: "service_variant.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service_variant", resourceId: row.id,
            requestId: ctx.requestId ?? null, metadata: { slug, service_id: input.serviceId },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "A variant with this slug already exists for this service.");
      }
      throw err;
    }
  });
}

export async function updateVariant(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<UpdateVariantInput>(updateVariantSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  return await withOrg(orgId, async () => {
    await getEntityRow("service_variant", orgId, input.branchId, input.variantId);
    // Audit is transactional with the state change (fail-closed).
    return await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.service_variants
            set name = coalesce($2, name),
                description = coalesce($3, description),
                sort_order = coalesce($4, sort_order),
                updated_at = now()
          where id = $1
          returning *`,
        [input.variantId, input.name ?? null, input.description ?? null, input.sort_order ?? null],
      );
      await writeAuditEvent({
        action: "service_variant.updated", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: "service_variant", resourceId: input.variantId,
        requestId: ctx.requestId ?? null, metadata: { fields: Object.keys(input).filter((k) => !["branchId", "variantId"].includes(k)) },
      }, tx);
      return res.rows[0];
    });
  });
}

// =====================================================================
// Add-on operations (Q5: no pricing fields exist)
// =====================================================================

export async function createAddon(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<CreateAddonInput>(createAddonSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const slug = normalizeSlug(input.slug);

  return await withOrg(orgId, async () => {
    try {
      return await withTransaction(async (tx) => {
        const res = await tx.query<CatalogRow>(
          `insert into public.service_addons
             (organization_id, branch_id, slug, name, description, sort_order,
              min_quantity, max_quantity, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
           returning *`,
          [orgId, input.branchId, slug, input.name, input.description ?? null,
           input.sort_order ?? 0, input.min_quantity ?? 1, input.max_quantity ?? 1],
        );
        const row = res.rows[0];
        await writeTranslations(tx, "service_addon_translations", "addon_id", row.id, input.translations);
        await writeAuditEvent(
          {
            action: "service_addon.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service_addon", resourceId: row.id,
            requestId: ctx.requestId ?? null,
            metadata: { slug, min_quantity: input.min_quantity ?? 1, max_quantity: input.max_quantity ?? 1 },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "An add-on with this slug already exists on this branch.");
      }
      throw err;
    }
  });
}

export async function updateAddon(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<UpdateAddonInput>(updateAddonSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  return await withOrg(orgId, async () => {
    await getEntityRow("service_addon", orgId, input.branchId, input.addonId);
    // Cross-check combined bounds when only one side changes.
    const current = await query<{ min_quantity: number; max_quantity: number }>(
      `select min_quantity, max_quantity from public.service_addons where id = $1`, [input.addonId],
    );
    const min = input.min_quantity ?? current.rows[0].min_quantity;
    const max = input.max_quantity ?? current.rows[0].max_quantity;
    if (min < 1 || max < min) {
      throw new AppError(ErrorCode.INVALID_INPUT, "max_quantity must be >= min_quantity >= 1.");
    }
    // Audit is transactional with the state change (fail-closed).
    return await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.service_addons
            set name = coalesce($2, name),
                description = coalesce($3, description),
                sort_order = coalesce($4, sort_order),
                min_quantity = $5,
                max_quantity = $6,
                updated_at = now()
          where id = $1
          returning *`,
        [input.addonId, input.name ?? null, input.description ?? null, input.sort_order ?? null, min, max],
      );
      await writeAuditEvent({
        action: "service_addon.updated", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: "service_addon", resourceId: input.addonId,
        requestId: ctx.requestId ?? null,
        metadata: { fields: Object.keys(input).filter((k) => !["branchId", "addonId"].includes(k)) },
      }, tx);
      return res.rows[0];
    });
  });
}

// =====================================================================
// Lifecycle (§6 design) — draft → active → inactive → archived (terminal)
// =====================================================================

const STATUS_TABLES: Record<CatalogEntityType, string> = {
  service_category: "service_categories",
  service: "services",
  service_variant: "service_variants",
  service_addon: "service_addons",
};

export async function changeStatus(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<ChangeStatusInput>(changeStatusSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const table = STATUS_TABLES[input.entityType];

  return await withOrg(orgId, async () => {
    const row = await getEntityRow(input.entityType, orgId, input.branchId, input.entityId);
    const from = row.status;

    if (from === "archived") {
      throw new AppError(ErrorCode.INVALID_INPUT, "Archived entries are terminal.");
    }
    if (from === input.status) {
      return row; // idempotent no-op
    }

    // Archive guard (spec: "Category with services cannot be hard-deleted"):
    // a category can only be archived when no non-archived services remain
    // attached to it.
    if (input.entityType === "service_category" && input.status === "archived") {
      const attached = await query<{ n: string }>(
        `select count(*)::text as n from public.services
          where category_id = $1 and organization_id = $2 and status <> 'archived'`,
        [input.entityId, orgId],
      );
      if (Number(attached.rows[0]?.n ?? "0") > 0) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "Category still has non-archived services; move or archive them first.",
        );
      }
    }

    // Activation preconditions.
    if (input.status === "active") {
      if (input.entityType === "service") {
        const cat = await query<{ status: string }>(
          `select status from public.service_categories where id = $1 and organization_id = $2`,
          [row.category_id as string, orgId],
        );
        if (cat.rows[0]?.status !== "active") {
          throw new AppError(ErrorCode.INVALID_INPUT, "Category must be active before its services can activate.");
        }
      }
      if (input.entityType === "service_variant") {
        const svc = await query<{ status: string }>(
          `select status from public.services where id = $1 and organization_id = $2`,
          [row.service_id as string, orgId],
        );
        if (svc.rows[0]?.status !== "active") {
          throw new AppError(ErrorCode.INVALID_INPUT, "Parent service must be active before variants can activate.");
        }
      }
      const hasDefault = await query<{ exists: boolean }>(
        `select exists(
           select 1 from public.${entityOf(input.entityType).translationTable} t
           where t.${entityOf(input.entityType).idCol} = $1
             and t.locale = (select locale from public.branches where id = $2 and organization_id = $3)
         ) as exists`,
        [input.entityId, input.branchId, orgId],
      );
      if (!hasDefaultLocaleRow(hasDefault.rows[0]?.exists === true, input.entityId, input.branchId)) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          "A default-locale translation is required before activation.",
        );
      }
    }

    const isPublication = from === "draft" && input.status === "active";
    const isArchive = input.status === "archived";
    const updated = await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.${table}
            set status = $2,
                published_at = case when $3 and published_at is null then now() else published_at end,
                updated_at = now()
          where id = $1
          returning *`,
        [input.entityId, input.status, isPublication],
      );
      // Design §8: dedicated `.archived` events (in addition to status_changed
      // for regular transitions); archive is a terminal, specially-named event.
      await writeAuditEvent(
        {
          action: isArchive
            ? `${entityOf(input.entityType).auditPrefix}.archived`
            : `${entityOf(input.entityType).auditPrefix}.status_changed`,
          organizationId: orgId, branchId: input.branchId,
          actorUserId: ctx.actor.userId, resourceType: input.entityType, resourceId: input.entityId,
          requestId: ctx.requestId ?? null,
          metadata: isArchive ? { from } : { from, to: input.status },
        },
        tx,
      );
      return res.rows[0];
    });
    return updated;
  });
}

/** Default-locale translation check, tolerating branches with unusual locale rows. */
function hasDefaultLocaleRow(exists: boolean, entityId: string, branchId: string): boolean {
  void entityId;
  void branchId;
  return exists;
}

// =====================================================================
// Branch offering configuration (Q2) — explicit opt-in/opt-out only
// =====================================================================

export async function setOfferingState(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  const input = parseOrThrow<SetOfferingStateInput>(setOfferingStateSchema, raw);
  // Branch roles may reconfigure their own branches; this is the one
  // operation branch scope is allowed to perform (docs/SERVICE_CATALOG §8.2).
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const table = STATUS_TABLES[input.entityType];

  return await withOrg(orgId, async () => {
    const row = await getEntityRow(input.entityType, orgId, input.branchId, input.entityId);
    // Audit is transactional with the state change (fail-closed).
    return await withTransaction(async (tx) => {
      const res = await tx.query<CatalogRow>(
        `update public.${table}
            set is_enabled = coalesce($2, is_enabled),
                is_customer_visible = coalesce($3, is_customer_visible),
                updated_at = now()
          where id = $1
          returning *`,
        [input.entityId, input.is_enabled ?? null, input.is_customer_visible ?? null],
      );
      const enabled = input.is_enabled ?? row.is_enabled;
      await writeAuditEvent({
        action: enabled ? "branch_service.enabled" : "branch_service.disabled",
        organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: input.entityType, resourceId: input.entityId,
        requestId: ctx.requestId ?? null,
        metadata: {
          is_enabled: input.is_enabled ?? null,
          is_customer_visible: input.is_customer_visible ?? null,
        },
      }, tx);
      return res.rows[0];
    });
  });
}

export async function reorderCatalog(ctx: AuthContext, raw: unknown): Promise<{ updated: number }> {
  requirePermission(ctx, "services.edit");
  const input = parseOrThrow<ReorderCatalogInput>(reorderCatalogSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const table = STATUS_TABLES[input.entityType];
  const pkCol = entityOf(input.entityType).pkCol;

  return await withOrg(orgId, async () => {
    // Audit is transactional with the state change (fail-closed).
    const updated = await withTransaction(async (tx) => {
      let count = 0;
      for (let i = 0; i < input.orderedIds.length; i++) {
        const res = await tx.query(
          `update public.${table} set sort_order = $2, updated_at = now()
            where ${pkCol} = $1 and branch_id = $3 and organization_id = $4`,
          [input.orderedIds[i], i, input.branchId, orgId],
        );
        count += res.rowCount;
      }
      await writeAuditEvent({
        action: "branch_service.updated", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: input.entityType, resourceId: null,
        requestId: ctx.requestId ?? null, metadata: { reorder_count: count },
      }, tx);
      return count;
    });
    return { updated };
  });
}

// =====================================================================
// Compatibility (Q3) — explicit allow-list join rows
// =====================================================================

export interface CompatibilityRow {
  id: string;
  service_addon_id: string;
  service_id: string;
  service_variant_id: string | null;
  branch_id: string;
}

export async function setAddonCompatibility(ctx: AuthContext, raw: unknown): Promise<CompatibilityRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<SetCompatibilityInput>(setCompatibilitySchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  return await withOrg(orgId, async () => {
    try {
      return await withTransaction(async (tx) => {
        const res = await tx.query<CompatibilityRow>(
          `insert into public.service_addon_compatibility
             (organization_id, branch_id, service_addon_id, service_id, service_variant_id)
           values ($1, $2, $3, $4, $5)
           returning *`,
          [orgId, input.branchId, input.addonId, input.serviceId, input.variantId ?? null],
        );
        const row = res.rows[0];
        await writeAuditEvent(
          {
            action: "service_addon_compatibility.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service_addon_compatibility", resourceId: row.id,
            requestId: ctx.requestId ?? null,
            metadata: { addon: input.addonId, service: input.serviceId, variant: input.variantId ?? null },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "This compatibility row already exists.");
      }
      // Composite same-branch FK violations surface as invalid input.
      if (
        typeof err === "object" && err !== null && "code" in err &&
        (err as { code?: string }).code === "23503"
      ) {
        throw new AppError(
          ErrorCode.INVALID_INPUT,
          "Compatibility participants must exist on the same branch.",
        );
      }
      throw err;
    }
  });
}

export async function removeAddonCompatibility(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<RemoveCompatibilityInput>(removeCompatibilitySchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;

  await withOrg(orgId, async () => {
    // Audit is transactional with the state change (fail-closed).
    await withTransaction(async (tx) => {
      const res = await tx.query(
        `delete from public.service_addon_compatibility where id = $1 and branch_id = $2 and organization_id = $3`,
        [input.compatibilityId, input.branchId, orgId],
      );
      if (res.rowCount === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, "Compatibility row not found.");
      }
      await writeAuditEvent({
        action: "service_addon_compatibility.removed", organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: "service_addon_compatibility",
        resourceId: input.compatibilityId, requestId: ctx.requestId ?? null, metadata: {},
      }, tx);
    });
  });
}

/**
 * Compatibility closure check (spec: orphaned enabled add-ons are surfaced,
 * never silently hidden): enabled add-ons with no allow-list row against any
 * enabled+active service of the branch.
 */
export async function findOrphanedAddons(branchId: string): Promise<CatalogRow[]> {
  const res = await query<CatalogRow>(
    `select a.* from public.service_addons a
      where a.branch_id = $1 and a.is_enabled and a.status = 'active'
        and not exists (
          select 1 from public.service_addon_compatibility c
          join public.services s on s.id = c.service_id
          where c.service_addon_id = a.id
            and c.branch_id = a.branch_id
            and s.is_enabled and s.status = 'active'
        )`,
    [branchId],
  );
  return res.rows;
}

// =====================================================================
// Translations — (entity_id, locale) unique; default locale is fallback
// =====================================================================

type TranslationInput = { locale: string; name: string; description?: string };

async function writeTranslations(
  tx: TransactionClient,
  table: string,
  idCol: string,
  entityId: string,
  translations: TranslationInput[],
): Promise<void> {
  for (const t of translations) {
    await tx.query(
      `insert into public.${table} (${idCol}, locale, name, description)
       values ($1, $2, $3, $4)
       on conflict (${idCol}, locale) do update
         set name = excluded.name, description = excluded.description, updated_at = now()`,
      [entityId, t.locale, t.name, t.description ?? null],
    );
  }
}

export async function upsertTranslation(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<UpsertTranslationInput>(upsertTranslationSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const e = entityOf(input.entityType);

  await withOrg(orgId, async () => {
    await getEntityRow(input.entityType, orgId, input.branchId, input.entityId);
    await withTransaction(async (tx) => {
      await writeTranslations(tx, e.translationTable, e.idCol, input.entityId, [
        { locale: input.locale, name: input.name, description: input.description },
      ]);
      await writeAuditEvent({
        action: `${e.auditPrefix}.updated`, organizationId: orgId, branchId: input.branchId,
        actorUserId: ctx.actor.userId, resourceType: input.entityType, resourceId: input.entityId,
        requestId: ctx.requestId ?? null, metadata: { translation_locale: input.locale },
      }, tx);
    });
  });
}

// =====================================================================
// Slug rename (Q7) — atomic: slug update + alias insert + audit
// =====================================================================

export async function renamePublishedSlug(ctx: AuthContext, raw: unknown): Promise<CatalogRow> {
  requirePermission(ctx, "services.edit");
  requireHqActor(ctx);
  const input = parseOrThrow<RenameSlugInput>(renameSlugSchema, raw);
  await assertBranchScope(ctx, input.branchId);
  const orgId = ctx.actor.organizationId;
  const e = ENTITIES[input.entityType];
  if (!e.aliasType) {
    // Categories are not customer-facing slugs in the routing namespace; they
    // are not addressable by the alias mechanism (rename = normal update).
    throw new AppError(ErrorCode.INVALID_INPUT, "Categories do not use the slug-alias mechanism.");
  }
  const newSlug = normalizeSlug(input.newSlug);

  return await withOrg(orgId, async () => {
    const row = await getEntityRow(input.entityType, orgId, input.branchId, input.entityId);

    if (row.slug === newSlug) {
      throw new AppError(ErrorCode.CONFLICT, "New slug equals the current slug.");
    }
    if (!row.published_at) {
      // Draft: free rename, no alias needed. Audit is transactional (fail-closed).
      return await withTransaction(async (tx) => {
        const res = await tx.query<CatalogRow>(
          `update public.${e.table} set slug = $2, updated_at = now() where id = $1 returning *`,
          [input.entityId, newSlug],
        );
        await writeAuditEvent({
          action: `${e.auditPrefix}.updated`, organizationId: orgId, branchId: input.branchId,
          actorUserId: ctx.actor.userId, resourceType: input.entityType, resourceId: input.entityId,
          requestId: ctx.requestId ?? null, metadata: { slug_renamed_to: newSlug, draft: true },
        }, tx);
        return res.rows[0];
      });
    }

    // Published: slug is frozen; the only path is the audited alias.
    // No chains/loops: the old slug must not already be claimed by another
    // alias of the same entity type + branch (uq_service_slug_aliases), and
    // the alias must not point at a differently-typed row (entity_type).
    try {
      return await withTransaction(async (tx) => {
        // The new slug must not collide with a *live* slug or an existing alias.
        const live = await tx.query(
          `select 1 from public.${e.table} where branch_id = $1 and slug = $2 and id <> $3`,
          [input.branchId, newSlug, input.entityId],
        );
        if (live.rows.length > 0) {
          throw new AppError(ErrorCode.CONFLICT, "New slug is already used by another entry on this branch.");
        }
        const aliasTaken = await tx.query(
          `select 1 from public.service_slug_aliases
            where branch_id = $1 and entity_type = $2 and old_slug = $3`,
          [input.branchId, e.aliasType, newSlug],
        );
        if (aliasTaken.rows.length > 0) {
          throw new AppError(ErrorCode.CONFLICT, "New slug is already reserved by an alias on this branch.");
        }

        const res = await tx.query<CatalogRow>(
          `update public.${e.table} set slug = $2, updated_at = now() where id = $1 returning *`,
          [input.entityId, newSlug],
        );
        await tx.query(
          `insert into public.service_slug_aliases
             (organization_id, branch_id, entity_type, entity_id, old_slug)
           values ($1, $2, $3, $4, $5)`,
          [orgId, input.branchId, e.aliasType, input.entityId, row.slug],
        );
        await writeAuditEvent(
          {
            action: "service_slug_alias.created", organizationId: orgId, branchId: input.branchId,
            actorUserId: ctx.actor.userId, resourceType: "service_slug_alias",
            resourceId: input.entityId, requestId: ctx.requestId ?? null,
            metadata: { entity_type: e.aliasType, old_slug: row.slug, new_slug: newSlug },
          },
          tx,
        );
        return res.rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, "Slug is already claimed on this branch.");
      }
      throw err;
    }
  });
}

export interface SlugResolution {
  entity: CatalogRow;
  entityType: SlugAliasEntityType;
  isAlias: boolean;
  aliasSlug: string | null;
}

type SlugAliasEntityType = "service" | "service_variant" | "service_addon";

/**
 * Resolve a customer-facing slug against live entries first, then published
 * aliases (Q7). Consumers never observe a broken reference.
 */
export async function resolveCatalogSlug(
  branchId: string,
  slug: string,
  opts: { includeAliases?: boolean } = {},
): Promise<SlugResolution | null> {
  const normalized = normalizeSlug(slug);

  for (const t of ["service", "service_variant", "service_addon"] as const) {
    const e = ENTITIES[t];
    const res = await query<CatalogRow>(
      `select * from public.${e.table} where branch_id = $1 and slug = $2`,
      [branchId, normalized],
    );
    if (res.rows[0]) {
      return { entity: res.rows[0], entityType: t, isAlias: false, aliasSlug: null };
    }
  }

  if (!opts.includeAliases) return null;

  const alias = await query<{
    entity_type: SlugAliasEntityType;
    entity_id: string;
    old_slug: string;
  }>(
    `select entity_type, entity_id, old_slug from public.service_slug_aliases
      where branch_id = $1 and old_slug = $2`,
    [branchId, normalized],
  );
  if (!alias.rows[0]) return null;

  const e = ENTITIES[alias.rows[0].entity_type];
  const res = await query<CatalogRow>(
    `select * from public.${e.table} where id = $1 and branch_id = $2`,
    [alias.rows[0].entity_id, branchId],
  );
  if (!res.rows[0]) return null;
  return {
    entity: res.rows[0],
    entityType: alias.rows[0].entity_type,
    isAlias: true,
    aliasSlug: alias.rows[0].old_slug,
  };
}

// =====================================================================
// Effective catalog read model (booking/CMS/search consume this)
// =====================================================================

export interface EffectiveCatalog {
  categories: CatalogRow[];
  services: (CatalogRow & { variants: CatalogRow[]; addons: CatalogRow[] })[];
  standaloneAddons: CatalogRow[];
}

/**
 * Full bookability conjunction (docs/SERVICE_CATALOG §12/§23-3):
 * category active+enabled (for services) ∧ entity active ∧ is_enabled ∧
 * (customer-visible when requested). Opt-in gate enforced here (Q2).
 *
 * Localization (LOCALIZATION.md §11): when a locale is requested, rows carry
 * `display_name` / `display_description` = requested-locale translation,
 * falling back to the branch default-locale translation and then to the
 * operational base text — never an empty string when default-locale text
 * exists. No pricing/availability logic is added here.
 */
export async function listEffectiveCatalog(
  branchId: string,
  opts: { locale?: string; customerVisibleOnly?: boolean } = {},
): Promise<EffectiveCatalog> {
  const vis = opts.customerVisibleOnly ? "and x.is_customer_visible" : "";

  // Branch default locale (fallback target) — resolved from the branch row.
  const defaultLocale = opts.locale
    ? (
        await query<{ locale: string }>(
          `select locale from public.branches where id = $1`,
          [branchId],
        )
      ).rows[0]?.locale ?? null
    : null;

  /**
   * Translation projection: requested locale first, then branch default,
   * then the operational base columns (name/description are default-locale
   * operational text — the final safety net against empty rendering).
   */
  const txProjection = (
    alias: string,
    translationTable: string,
    fkCol: string,
  ): { join: string; cols: string } => {
    if (!opts.locale || !defaultLocale) return { join: "", cols: "" };
    return {
      join:
        `left join public.${translationTable} t_req on t_req.${fkCol} = ${alias}.id and t_req.locale = $req_locale\n` +
        `left join public.${translationTable} t_def on t_def.${fkCol} = ${alias}.id and t_def.locale = $def_locale`,
      cols:
        `, coalesce(t_req.name, t_def.name, ${alias}.name) as display_name\n` +
        `, coalesce(t_req.description, t_def.description, ${alias}.description) as display_description`,
    };
  };
  const params: unknown[] = [branchId];
  const reqLocaleIdx = opts.locale ? params.push(opts.locale) : null; // $req_locale
  const defLocaleIdx = opts.locale && defaultLocale ? params.push(defaultLocale) : null; // $def_locale
  const replaceLocaleParams = (sql: string): string =>
    sql
      .replace(/\$req_locale/g, reqLocaleIdx !== null ? `$${reqLocaleIdx}` : "NULL")
      .replace(/\$def_locale/g, defLocaleIdx !== null ? `$${defLocaleIdx}` : "NULL");

  const catProj = txProjection("x", "service_category_translations", "category_id");
  const categories = (
    await query<CatalogRow>(
      replaceLocaleParams(
        `select x.*${catProj.cols} from public.service_categories x
          ${catProj.join}
          where x.branch_id = $1 and x.status = 'active' and x.is_enabled ${vis}
          order by x.sort_order asc`,
      ),
      params,
    )
  ).rows;

  const svcProj = txProjection("s", "service_translations", "service_id");
  const svcVis = opts.customerVisibleOnly ? "and s.is_customer_visible" : "";
  const serviceRows = (
    await query<CatalogRow>(
      replaceLocaleParams(
        `select s.*${svcProj.cols} from public.services s
          ${svcProj.join}
          where s.branch_id = $1 and s.status = 'active' and s.is_enabled ${svcVis}
            and exists (
              select 1 from public.service_categories c
              where c.id = s.category_id and c.status = 'active' and c.is_enabled
            )
          order by s.sort_order asc`,
      ),
      params,
    )
  ).rows;

  const varProj = txProjection("v", "service_variant_translations", "variant_id");
  const varVis = opts.customerVisibleOnly ? "and v.is_customer_visible" : "";
  const variantRows = serviceRows.length
    ? (
        await query<CatalogRow>(
          replaceLocaleParams(
            `select v.*${varProj.cols} from public.service_variants v
              ${varProj.join}
              where v.branch_id = $1 and v.status = 'active' and v.is_enabled ${varVis}
              order by v.sort_order asc`,
          ),
          params,
        )
      ).rows
    : [];

  // Add-ons: enabled + active + allow-listed against at least one effective
  // service/variant (Q3 absence = incompatible).
  const addonProj = txProjection("a", "service_addon_translations", "addon_id");
  const addonVis = opts.customerVisibleOnly ? "and a.is_customer_visible" : "";
  // `select distinct` + ORDER BY sort_order is rejected when the projection
  // adds translation columns; dedupe via exists() instead of DISTINCT.
  const addonRows = (
    await query<CatalogRow>(
      replaceLocaleParams(
        `select a.*${addonProj.cols} from public.service_addons a
          ${addonProj.join}
          where a.branch_id = $1 and a.status = 'active' and a.is_enabled ${addonVis}
            and exists (
              select 1 from public.service_addon_compatibility c
              where c.service_addon_id = a.id
                and (
                  (c.service_id in (select id from public.services
                                     where branch_id = $1 and status = 'active' and is_enabled)
                   and c.service_variant_id is null)
                  or c.service_variant_id in (
                       select id from public.service_variants
                        where branch_id = $1 and status = 'active' and is_enabled)
                )
            )
          order by a.sort_order asc`,
      ),
      params,
    )
  ).rows;

  const services = serviceRows.map((s) => ({
    ...s,
    variants: variantRows.filter((v) => v.service_id === s.id),
    addons: addonRows,
  }));

  return { categories, services, standaloneAddons: addonRows };
}

// =====================================================================
// Selection validation (booking-boundary primitive; pure — no pricing,
// no availability)
// =====================================================================

export interface SelectionViolation {
  code: "NOT_EFFECTIVE" | "COMPATIBILITY" | "QUANTITY" | "VARIANT_REQUIRED";
  message: string;
  addonId?: string;
}

export async function validateSelection(
  ctx: AuthContext,
  raw: unknown,
): Promise<{ valid: boolean; violations: SelectionViolation[] }> {
  requirePermission(ctx, "services.view");
  const input = parseOrThrow<ValidateSelectionInput>(validateSelectionSchema, raw);
  await assertBranchScope(ctx, input.branchId);

  const violations: SelectionViolation[] = [];
  const catalog = await listEffectiveCatalog(input.branchId);

  const service = catalog.services.find((s) => s.id === input.serviceId);
  if (!service) {
    return { valid: false, violations: [{ code: "NOT_EFFECTIVE", message: "Service is not offered." }] };
  }

  if (service.variants.length > 0 && !input.variantId) {
    violations.push({ code: "VARIANT_REQUIRED", message: "This service requires variant selection." });
  }
  if (input.variantId && !service.variants.some((v) => v.id === input.variantId)) {
    violations.push({ code: "NOT_EFFECTIVE", message: "Selected variant is not offered." });
  }

  for (const sel of input.addonSelections) {
    const addon = catalog.standaloneAddons.find((a) => a.id === sel.addonId);
    if (!addon) {
      violations.push({
        code: "COMPATIBILITY", message: "Add-on is not compatible with the selection.", addonId: sel.addonId,
      });
      continue;
    }
    // Variant-granular allow-list: a row with a variant_id only covers that
    // variant; with no variant selected, only service-wide rows (NULL) apply.
    const compatible = await query<{ exists: boolean }>(
      `select exists(
         select 1 from public.service_addon_compatibility
          where service_addon_id = $1
            and branch_id = $2
            and (service_variant_id is null or service_variant_id = $3)
            and service_id = $4
       ) as exists`,
      [sel.addonId, input.branchId, input.variantId ?? null, input.serviceId],
    );
    if (compatible.rows[0]?.exists !== true) {
      violations.push({
        code: "COMPATIBILITY", message: "Add-on is not compatible with the selection.", addonId: sel.addonId,
      });
      continue;
    }
    if (sel.quantity < (addon.min_quantity ?? 1) || sel.quantity > (addon.max_quantity ?? 1)) {
      violations.push({
        code: "QUANTITY",
        message: `Quantity must be between ${addon.min_quantity ?? 1} and ${addon.max_quantity ?? 1}.`,
        addonId: sel.addonId,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------
// Counters/telemetry helper (no business meaning)
// ---------------------------------------------------------------------
export async function countCatalogRows(branchId: string): Promise<Record<string, number>> {
  const res = await query<{ service_categories: string; services: string; service_variants: string; service_addons: string }>(
    `select
       (select count(*) from public.service_categories where branch_id = $1)::text as service_categories,
       (select count(*) from public.services where branch_id = $1)::text as services,
       (select count(*) from public.service_variants where branch_id = $1)::text as service_variants,
       (select count(*) from public.service_addons where branch_id = $1)::text as service_addons`,
    [branchId],
  );
  const r = res.rows[0];
  void metrics;
  return {
    service_categories: Number(r.service_categories),
    services: Number(r.services),
    service_variants: Number(r.service_variants),
    service_addons: Number(r.service_addons),
  };
}
