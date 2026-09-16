/**
 * Service catalog input validation (openspec/changes/create-service-catalog
 * tasks 5.1; API_STANDARDS.md §12). Server-authoritative: the domain service
 * runs these schemas; clients never widen them.
 *
 * Reuses the branch slug rules (grammar, reserved segments) and the
 * platform-supported locale list — no new vocabularies.
 */
import { z } from "zod";
import { SUPPORTED_LOCALES, normalizeSlug, RESERVED_SLUGS } from "@/features/branches/schemas/create-branch";

export type CatalogEntityType = "service_category" | "service" | "service_variant" | "service_addon";

/** Entity types addressable by the slug-alias mechanism (Q7). */
export const SLUG_ALIAS_ENTITY_TYPES = ["service", "service_variant", "service_addon"] as const;
export type SlugAliasEntityType = (typeof SLUG_ALIAS_ENTITY_TYPES)[number];

const catalogSlugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters")
  .max(63, "Slug must be at most 63 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase URL-safe segments")
  .refine((s) => !RESERVED_SLUGS.includes(s as (typeof RESERVED_SLUGS)[number]), {
    message: "Slug uses a reserved path segment",
  });

const localeSchema = z.enum(SUPPORTED_LOCALES);

const nameSchema = z.string().trim().min(1, "Name is required").max(200);

const descriptionSchema = z.string().trim().max(4000).optional();

/** Both create and update operations carry the branch context explicitly. */
const branchContext = {
  branchId: z.string().uuid("branchId must be a UUID"),
};

// ---------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------

export const createCategorySchema = z
  .object({
    ...branchContext,
    slug: catalogSlugSchema,
    name: nameSchema,
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
    translations: z
      .array(z.object({ locale: localeSchema, name: nameSchema, description: descriptionSchema }))
      .min(1, "At least the default-locale translation is required"),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    ...branchContext,
    categoryId: z.string().uuid(),
    name: nameSchema.optional(),
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

export const createServiceSchema = z
  .object({
    ...branchContext,
    categoryId: z.string().uuid("categoryId must be a UUID"),
    slug: catalogSlugSchema,
    name: nameSchema,
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
    translations: z
      .array(z.object({ locale: localeSchema, name: nameSchema, description: descriptionSchema }))
      .min(1, "At least the default-locale translation is required"),
  })
  .strict();

export const updateServiceSchema = z
  .object({
    ...branchContext,
    serviceId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    name: nameSchema.optional(),
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export const changeStatusSchema = z
  .object({
    ...branchContext,
    entityType: z.enum(["service_category", "service", "service_variant", "service_addon"]),
    entityId: z.string().uuid(),
    status: z.enum(["active", "inactive", "archived"]),
  })
  .strict();

// ---------------------------------------------------------------------
// Variant
// ---------------------------------------------------------------------

export const createVariantSchema = z
  .object({
    ...branchContext,
    serviceId: z.string().uuid(),
    slug: catalogSlugSchema,
    name: nameSchema,
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
    translations: z
      .array(z.object({ locale: localeSchema, name: nameSchema, description: descriptionSchema }))
      .min(1),
  })
  .strict();

export const updateVariantSchema = z
  .object({
    ...branchContext,
    variantId: z.string().uuid(),
    name: nameSchema.optional(),
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

// ---------------------------------------------------------------------
// Add-on — NO pricing fields (Q5)
// ---------------------------------------------------------------------

export const createAddonSchema = z
  .object({
    ...branchContext,
    slug: catalogSlugSchema,
    name: nameSchema,
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
    min_quantity: z.number().int().min(1).max(1000).optional(),
    max_quantity: z.number().int().min(1).max(1000).optional(),
    translations: z
      .array(z.object({ locale: localeSchema, name: nameSchema, description: descriptionSchema }))
      .min(1),
  })
  .strict()
  .refine((d) => (d.max_quantity ?? 1) >= (d.min_quantity ?? 1), {
    message: "max_quantity must be >= min_quantity",
    path: ["max_quantity"],
  });

export const updateAddonSchema = z
  .object({
    ...branchContext,
    addonId: z.string().uuid(),
    name: nameSchema.optional(),
    description: descriptionSchema,
    sort_order: z.number().int().min(0).max(100000).optional(),
    min_quantity: z.number().int().min(1).max(1000).optional(),
    max_quantity: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (d) => d.min_quantity === undefined || d.max_quantity === undefined || d.max_quantity >= d.min_quantity,
    { message: "max_quantity must be >= min_quantity", path: ["max_quantity"] },
  );

// ---------------------------------------------------------------------
// Compatibility (Q3 — explicit allow-list)
// ---------------------------------------------------------------------

export const setCompatibilitySchema = z
  .object({
    ...branchContext,
    addonId: z.string().uuid(),
    serviceId: z.string().uuid(),
    /** Omitted/undefined = allow-listed for all variants of the service. */
    variantId: z.string().uuid().optional(),
  })
  .strict();

export const removeCompatibilitySchema = z
  .object({
    ...branchContext,
    compatibilityId: z.string().uuid(),
  })
  .strict();

// ---------------------------------------------------------------------
// Branch offering configuration (Q2 — explicit opt-in only)
// ---------------------------------------------------------------------

export const setOfferingStateSchema = z
  .object({
    ...branchContext,
    entityType: z.enum(["service_category", "service", "service_variant", "service_addon"]),
    entityId: z.string().uuid(),
    is_enabled: z.boolean().optional(),
    is_customer_visible: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.is_enabled !== undefined || d.is_customer_visible !== undefined, {
    message: "At least one of is_enabled / is_customer_visible is required",
  });

export const reorderCatalogSchema = z
  .object({
    ...branchContext,
    entityType: z.enum(["service_category", "service", "service_variant", "service_addon"]),
    /** Entity IDs in their new display order. */
    orderedIds: z.array(z.string().uuid()).min(1).max(1000),
  })
  .strict();

// ---------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------

export const upsertTranslationSchema = z
  .object({
    ...branchContext,
    entityType: z.enum(["service_category", "service", "service_variant", "service_addon"]),
    entityId: z.string().uuid(),
    locale: localeSchema,
    name: nameSchema,
    description: descriptionSchema,
  })
  .strict();

// ---------------------------------------------------------------------
// Slug rename (Q7)
// ---------------------------------------------------------------------

export const renameSlugSchema = z
  .object({
    ...branchContext,
    entityType: z.enum(SLUG_ALIAS_ENTITY_TYPES),
    entityId: z.string().uuid(),
    newSlug: catalogSlugSchema,
  })
  .strict();

// ---------------------------------------------------------------------
// Selection validation (booking-boundary primitive; no pricing/availability)
// ---------------------------------------------------------------------

export const validateSelectionSchema = z
  .object({
    ...branchContext,
    serviceId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    addonSelections: z
      .array(z.object({ addonId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }))
      .max(100)
      .default([]),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type CreateAddonInput = z.infer<typeof createAddonSchema>;
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;
export type SetCompatibilityInput = z.infer<typeof setCompatibilitySchema>;
export type RemoveCompatibilityInput = z.infer<typeof removeCompatibilitySchema>;
export type SetOfferingStateInput = z.infer<typeof setOfferingStateSchema>;
export type ReorderCatalogInput = z.infer<typeof reorderCatalogSchema>;
export type UpsertTranslationInput = z.infer<typeof upsertTranslationSchema>;
export type RenameSlugInput = z.infer<typeof renameSlugSchema>;
export type ValidateSelectionInput = z.infer<typeof validateSelectionSchema>;

export { normalizeSlug, SUPPORTED_LOCALES };
