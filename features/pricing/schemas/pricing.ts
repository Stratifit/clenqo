/**
 * Pricing Engine input/configuration schemas (Change 4A, tasks 3.1–3.2).
 *
 * Validation mirrors the migration 0010 CHECK constraints so invalid input
 * fails at the boundary with stable INVALID_INPUT errors before the
 * privileged client touches the database (API_STANDARDS §46: JSONB never
 * unstructured; DATABASE.md §42).
 *
 * Normative source: approved decision record P1–P22
 * (openspec/changes/create-pricing-engine/design.md §1).
 *
 * BUSINESS-VALUE RULE (P3): this file contains NO production money values —
 * every numeric default below is a NON-PRODUCTION platform structural
 * default (e.g. the quantity defaults mirror the catalog tables), and all
 * rates/percentages are supplied at runtime via configuration. Tests use
 * explicit non-production fixtures.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Property details (P-D1) — typed optional duration inputs
// ---------------------------------------------------------------------------

/**
 * The property factors the platform recognizes today (BOOKING_SYSTEM §11).
 * `propertyType` is a free operational label (V1 has no property_type
 * entity); numeric factors are counts/areas used by duration rules.
 */
export const propertyDetailsSchema = z
  .object({
    propertyType: z.string().min(1).max(100).optional(),
    rooms: z.number().int().min(0).max(1000).optional(),
    bathrooms: z.number().int().min(0).max(1000).optional(),
    floorAreaSqm: z.number().min(0).max(1_000_000).optional(),
    floors: z.number().int().min(0).max(200).optional(),
    condition: z.enum(["light", "medium", "heavy"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "propertyDetails must not be empty",
  });
export type PropertyDetails = z.infer<typeof propertyDetailsSchema>;

// ---------------------------------------------------------------------------
// Rule configuration payloads (per rule_type — discriminated by Zod)
// ---------------------------------------------------------------------------

export const DURATION_FACTORS = [
  "base",
  "rooms",
  "bathrooms",
  "floorAreaSqm",
  "floors",
  "condition",
] as const;
export type DurationFactor = (typeof DURATION_FACTORS)[number];

/** P-D1: duration rules DECLARE which factors they consume. */
export const durationRuleConfigSchema = z.object({
  consumed_factors: z.array(z.enum(DURATION_FACTORS)).min(1),
  /** Structural defaults in minutes (platform placeholders — P3). */
  base_minutes: z.number().int().min(0).optional(),
  per_room_minutes: z.number().int().min(0).optional(),
  per_bathroom_minutes: z.number().int().min(0).optional(),
  per_sqm_minutes: z.number().min(0).optional(),
  per_floor_minutes: z.number().int().min(0).optional(),
  condition_minutes: z.record(z.enum(["light", "medium", "heavy"]), z.number().int().min(0)).optional(),
});
export type DurationRuleConfig = z.infer<typeof durationRuleConfigSchema>;

/** P4: difficulty is explicit per-service configuration. */
export const difficultyRuleConfigSchema = z.object({
  level: z.enum(["light", "medium", "heavy"]),
  /** Multiplier applied to the base — supplied only via approved values (P3). */
  multiplier: z.number().min(0),
});
export type DifficultyRuleConfig = z.infer<typeof difficultyRuleConfigSchema>;

/** P5/P5b: surcharge kinds + model; stacking is declared explicitly. */
export const SURCHARGE_KINDS = ["sunday", "night", "emergency", "holiday"] as const;
export type SurchargeKind = (typeof SURCHARGE_KINDS)[number];

export const surchargeRuleConfigSchema = z.object({
  kind: z.enum(SURCHARGE_KINDS),
  model: z.enum(["percentage", "fixed"]),
  /** Value supplied only via approved configuration (P3) — no default. */
  value: z.number().min(0),
  stacking: z.enum(["highest_only", "additive"]),
});
export type SurchargeRuleConfig = z.infer<typeof surchargeRuleConfigSchema>;

export const baseRateRuleConfigSchema = z.object({
  model: z.enum(["hourly"]),
  /** Non-negative rate in currency minor units (P14) — no default. */
  hourly_rate_minor: z.number().int().min(0),
});
export type BaseRateRuleConfig = z.infer<typeof baseRateRuleConfigSchema>;

export const addonPriceRuleConfigSchema = z.object({
  model: z.enum(["fixed", "per_unit", "percentage"]),
  /** Value in minor units (fixed/per_unit) or percent (percentage). */
  value: z.number().min(0),
  /** Fixed add-on duration contribution in minutes (PRICING §20). */
  duration_minutes: z.number().int().min(0).optional(),
});
export type AddonPriceRuleConfig = z.infer<typeof addonPriceRuleConfigSchema>;

export const minimumChargeRuleConfigSchema = z.object({
  minimum_minor: z.number().int().min(0),
});
export const minimumDurationRuleConfigSchema = z.object({
  minimum_minutes: z.number().int().min(0),
});

/** Discriminated rule payloads keyed by rule_type (migration 0010 CHECK). */
export const RULE_TYPES = [
  "base_rate",
  "duration_rule",
  "difficulty",
  "addon_price",
  "surcharge",
  "minimum_charge",
  "minimum_duration",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const ruleConfigurationSchema = z.union([
  baseRateRuleConfigSchema,
  durationRuleConfigSchema,
  difficultyRuleConfigSchema,
  addonPriceRuleConfigSchema,
  surchargeRuleConfigSchema,
  minimumChargeRuleConfigSchema,
  minimumDurationRuleConfigSchema,
]);

/**
 * STRICT per-rule_type configuration pairing: the raw input carries
 * `rule_type` next to a configuration blob, and the blob must match THAT
 * type's payload schema — validated without a lossy union pass. (A plain
 * z.union would silently accept a surcharge payload against the addon_price
 * schema in Zod 4 — subset matching — and strip `kind`/`stacking`, so the
 * pairing must be done with a raw pre-parse switch, not a union.)
 */
export const createRuleSchema = z
  .object({
    version_id: z.string().uuid(),
    rule_type: z.enum(RULE_TYPES),
    service_id: z.string().uuid().optional(),
    service_variant_id: z.string().uuid().optional(),
    service_addon_id: z.string().uuid().optional(),
    min_value: z.number().optional(),
    max_value: z.number().optional(),
    configuration: z.record(z.string(), z.unknown()),
  })
  .refine((v) => !(v.service_variant_id && !v.service_id), {
    message: "service_variant_id requires service_id",
  });
export type CreateRuleInput = z.infer<typeof createRuleSchema> & {
  configuration: Record<string, unknown>;
};

/**
 * Per-rule_type payload validation: configuration must match the rule's
 * type (the DB stores a jsonb blob; the domain enforces the pairing).
 */
export function validateRuleConfiguration(
  ruleType: RuleType,
  configuration: unknown,
): Record<string, unknown> {
  const schemaByType: Record<RuleType, z.ZodTypeAny> = {
    base_rate: baseRateRuleConfigSchema,
    duration_rule: durationRuleConfigSchema,
    difficulty: difficultyRuleConfigSchema,
    addon_price: addonPriceRuleConfigSchema,
    surcharge: surchargeRuleConfigSchema,
    minimum_charge: minimumChargeRuleConfigSchema,
    minimum_duration: minimumDurationRuleConfigSchema,
  };
  const parsed = schemaByType[ruleType].safeParse(configuration);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration for rule_type ${ruleType}: ${
        parsed.error?.issues.map((i) => i.message).join("; ") ?? "invalid"
      }`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Quote input (§3 design / API_STANDARDS §27 shape; P13 stateless)
// ---------------------------------------------------------------------------

export const calculateQuoteSchema = z.object({
  branch_id: z.string().uuid(),
  service_id: z.string().uuid(),
  variant_id: z.string().uuid().optional(),
  addons: z
    .array(
      z.object({
        addon_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(100).optional(),
      }),
    )
    .optional(),
  /** P-D1: typed optional property details for duration rules. */
  property_details: propertyDetailsSchema.optional(),
  /** ISO date (YYYY-MM-DD) of the scheduled service date (§49). */
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
});
export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>;

// ---------------------------------------------------------------------------
// Configuration CRUD schemas
// ---------------------------------------------------------------------------

export const createProfileSchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  currency: z.string().length(3),
  sort_order: z.number().int().min(0).optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  sort_order: z.number().int().min(0).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createVersionSchema = z.object({
  profile_id: z.string().uuid(),
  version_number: z.number().int().min(1).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  /** Open end omitted = effective until superseded (P17). */
  effective_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional(),
  /** P7 structure; a rate here is only ever an approved business value. */
  tax_rate_percent: z.number().min(0).max(100).optional(),
  tax_jurisdiction: z.string().max(100).optional(),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

export const publishVersionSchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional(),
  effective_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional(),
});
export type PublishVersionInput = z.infer<typeof publishVersionSchema>;

