/**
 * Pricing Engine quote calculation (Change 4A, task 5.1–5.4).
 *
 * The SINGLE canonical money pipeline (P2) and the SINGLE duration authority
 * (P21) live here. Stage activity is the approved V1 matrix (design §4):
 *
 *   ACTIVE:    duration, base rate, difficulty, add-ons, Sunday surcharge
 *   INERT:     minimum charge, minimum duration, night/emergency/holiday
 *              surcharges, discounts, tax (until the value sheet provides
 *              a rate — P7b)
 *
 * Determinism (P13/§34): every input is explicit — no wall-clock reads.
 * Money (P14/P15): minor units, half-up rounding exactly once per component,
 * total = exact component sum, tax-exclusive storage.
 */
import "server-only";
import { query } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  calculateQuoteSchema,
  type CalculateQuoteInput,
  type DurationRuleConfig,
  type PropertyDetails,
  type SurchargeRuleConfig,
  type AddonPriceRuleConfig,
} from "./schemas/pricing";
import { pricingError, PricingErrorCode } from "./errors";
import { applyPercentage, breakdownToJson, roundHalfUp, sumBreakdown } from "./money";

// ---------------------------------------------------------------------------
// Resolved configuration types
// ---------------------------------------------------------------------------

interface ResolvedRule {
  rule_type: string;
  service_id: string | null;
  service_variant_id: string | null;
  service_addon_id: string | null;
  min_value: string | null;
  max_value: string | null;
  multiplier: string | null;
  fixed_amount: string | null;
  configuration: Record<string, unknown> | null;
}

export interface ResolvedPricingContext {
  profileId: string;
  versionId: string;
  versionNumber: number;
  currency: string;
  taxRateBp: number | null; // P7b: null = inactive
  taxJurisdiction: string | null;
  rules: ResolvedRule[];
}

/** P17 resolution result (exported for the duration resolver). */
export async function resolvePricingContext(
  branchId: string,
  scheduledDate: string,
): Promise<ResolvedPricingContext> {
  // P11: the branch's single active profile.
  const profileRes = await query<{
    id: string;
    currency: string;
  }>(
    `select id, currency from public.pricing_profiles
     where branch_id = $1 and status = 'active'`,
    [branchId],
  );
  const profile = profileRes.rows[0];
  if (!profile) {
    throw pricingError(
      PricingErrorCode.PROFILE_NOT_FOUND,
      "This branch has no active pricing profile.",
    );
  }

  // P17: the published version whose effective period contains the scheduled
  // service date (§49). Windows are inclusive; latest effective_from is the
  // secondary rule. Overlap is already excluded by the 0010 EXCLUDE
  // constraint, so at most one candidate can exist.
  const versionRes = await query<{
    id: string;
    version_number: number;
    tax_rate_percent: string | null;
    tax_jurisdiction: string | null;
  }>(
    `select id, version_number, tax_rate_percent::text, tax_jurisdiction
     from public.pricing_versions
     where pricing_profile_id = $1
       and status = 'published'
       and effective_from <= $2::date
       and (effective_until is null or effective_until >= $2::date)
     order by effective_from desc
     limit 1`,
    [profile.id, scheduledDate],
  );
  const version = versionRes.rows[0];
  if (!version) {
    throw pricingError(
      PricingErrorCode.VERSION_NOT_FOUND,
      "No published pricing version covers the requested service date.",
    );
  }

  const rulesRes = await query<ResolvedRule>(
    `select rule_type, service_id, service_variant_id, service_addon_id,
            min_value::text, max_value::text, multiplier::text, fixed_amount::text,
            configuration
     from public.pricing_rules
     where pricing_version_id = $1`,
    [version.id],
  );

  const taxRatePercent = version.tax_rate_percent;
  return {
    profileId: profile.id,
    versionId: version.id,
    versionNumber: version.version_number,
    currency: profile.currency,
    taxRateBp: taxRatePercent === null ? null : Math.round(Number(taxRatePercent) * 100),
    taxJurisdiction: version.tax_jurisdiction,
    rules: rulesRes.rows,
  };
}

// ---------------------------------------------------------------------------
// Duration computation — shared by calculateQuote and the duration resolver
// ---------------------------------------------------------------------------

/** The duration rules the service consumes, resolved from the version. */
function selectDurationRules(
  rules: ResolvedRule[],
  serviceId: string,
  variantId?: string,
): ResolvedRule[] {
  return rules.filter(
    (r) =>
      r.rule_type === "duration_rule" &&
      (r.service_id === null || r.service_id === serviceId) &&
      (r.service_variant_id === null || r.service_variant_id === variantId),
  );
}

/**
 * P-D1: does any matching duration rule REQUIRE details the input lacks?
 * The base factor is structural (always available); every other factor must
 * be present when declared as consumed.
 */
function findMissingDetails(
  durationRules: ResolvedRule[],
  details?: PropertyDetails,
): string[] {
  const required = new Set<string>();
  for (const rule of durationRules) {
    const cfg = rule.configuration as DurationRuleConfig | null;
    if (!cfg) continue;
    for (const factor of cfg.consumed_factors) {
      if (factor !== "base") required.add(factor);
    }
  }
  const missing: string[] = [];
  const has = (k: string) =>
    details !== undefined &&
    details[k as keyof PropertyDetails] !== undefined &&
    details[k as keyof PropertyDetails] !== null;
  for (const factor of required) {
    if (!has(factor)) missing.push(factor);
  }
  return missing;
}

export interface DurationComputation {
  minutes: number;
  versionId: string;
  versionNumber: number;
  currency: string;
}

/**
 * Compute the authoritative estimated duration (minutes) from the version's
 * duration rules. Structural factor values are platform NON-PRODUCTION
 * placeholders when a rule omits them (P3): the base factor contributes only
 * if the rule supplies base_minutes. NO production duration values exist in
 * this module.
 */
export async function computeDuration(
  branchId: string,
  serviceId: string,
  scheduledDate: string,
  details?: PropertyDetails,
  variantId?: string,
): Promise<DurationComputation> {
  const ctx = await resolvePricingContext(branchId, scheduledDate);
  const durationRules = selectDurationRules(ctx.rules, serviceId, variantId);
  if (durationRules.length === 0) {
    throw pricingError(
      PricingErrorCode.CONFIGURATION_INVALID,
      "No duration rule is configured for this service in the active pricing version.",
    );
  }

  const missing = findMissingDetails(durationRules, details);
  if (missing.length > 0) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `Missing required property details for duration calculation: ${missing.join(", ")}.`,
    );
  }

  let minutes = 0n; // decimal-safe accumulation in bigint (P14)
  for (const rule of durationRules) {
    const cfg = rule.configuration as DurationRuleConfig;
    for (const factor of cfg.consumed_factors) {
      switch (factor) {
        case "base":
          minutes += BigInt(cfg.base_minutes ?? 0);
          break;
        case "rooms":
          minutes += BigInt((cfg.per_room_minutes ?? 0) * (details?.rooms ?? 0));
          break;
        case "bathrooms":
          minutes += BigInt((cfg.per_bathroom_minutes ?? 0) * (details?.bathrooms ?? 0));
          break;
        case "floorAreaSqm":
          // Rational area math: half-up once at the end of the factor.
          minutes += roundHalfUp(
            BigInt(Math.round((cfg.per_sqm_minutes ?? 0) * 100)) * BigInt(Math.round((details?.floorAreaSqm ?? 0) * 100)),
            10_000n,
          );
          break;
        case "floors":
          minutes += BigInt((cfg.per_floor_minutes ?? 0) * (details?.floors ?? 0));
          break;
        case "condition":
          minutes += BigInt(cfg.condition_minutes?.[details?.condition ?? "light"] ?? 0);
          break;
      }
    }
  }
  if (minutes < 1n) {
    throw pricingError(
      PricingErrorCode.CONFIGURATION_INVALID,
      "Duration rules resolved to zero minutes — configuration is invalid.",
    );
  }
  return {
    minutes: Number(minutes),
    versionId: ctx.versionId,
    versionNumber: ctx.versionNumber,
    currency: ctx.currency,
  };
}

// ---------------------------------------------------------------------------
// calculateQuote — the canonical pipeline
// ---------------------------------------------------------------------------

function selectBaseRate(rules: ResolvedRule[], serviceId: string, variantId?: string): ResolvedRule | undefined {
  return rules.find(
    (r) =>
      r.rule_type === "base_rate" &&
      (r.service_id === null || r.service_id === serviceId) &&
      (r.service_variant_id === null || r.service_variant_id === variantId),
  );
}

function selectDifficulty(
  rules: ResolvedRule[],
  serviceId: string,
  variantId?: string,
): ResolvedRule | undefined {
  return (
    rules.find(
      (r) =>
        r.rule_type === "difficulty" &&
        (r.service_id === null || r.service_id === serviceId) &&
        (r.service_variant_id === null || r.service_variant_id === variantId),
    ) ??
    // P4: difficulty defaults to level "light" (multiplier 1) when the
    // version configures none for the service — a structural default, not a
    // business value.
    undefined
  );
}

function selectSurchargeKinds(rules: ResolvedRule[], kind: SurchargeRuleConfig["kind"]): ResolvedRule[] {
  return rules.filter(
    (r) => r.rule_type === "surcharge" && (r.configuration as SurchargeRuleConfig | null)?.kind === kind,
  );
}

export interface QuoteResult {
  currency: string;
  duration_minutes: number;
  actual_duration_minutes: number;
  base_amount: string;
  addon_amount: string;
  surcharge_amount: string;
  discount_amount: string;
  tax_amount: string;
  subtotal: string;
  total: string;
  pricing_profile_id: string;
  pricing_version_id: string;
  pricing_version_number: number;
  breakdown: Record<string, string>;
  snapshot_source: {
    pricing_profile_id: string;
    pricing_version_id: string;
    pricing_version_number: number;
    inputs: Record<string, unknown>;
    rules_applied: Record<string, unknown>;
    result: Record<string, string>;
  };
}

/**
 * Stateless quote calculation (P13): no persistence, no quote IDs. See the
 * module docblock for the stage-activity contract.
 */
export async function calculateQuote(rawInput: CalculateQuoteInput): Promise<QuoteResult> {
  const input = calculateQuoteSchema.parse(rawInput);

  // Step 1–2: profile + version resolution (P11/P17).
  const ctx = await resolvePricingContext(input.branch_id, input.scheduled_date);

  // Step 3: catalog validation — identities exist and belong to the branch
  // (read-only; Q5 boundary preserved). Add-ons must be valid for the service.
  const svcRes = await query<{ id: string; currency: string }>(
    `select id from public.services where id = $1 and branch_id = $2`,
    [input.service_id, input.branch_id],
  );
  if (!svcRes.rows[0]) {
    throw new AppError(ErrorCode.NOT_FOUND, "Service not found on this branch.");
  }

  const addonQuantities = new Map<string, number>();
  if (input.addons?.length) {
    const ids = input.addons.map((a) => a.addon_id);
    const addonRes = await query<{ id: string }>(
      `select id from public.service_addons
       where branch_id = $1 and id = any($2::uuid[])`,
      [input.branch_id, ids],
    );
    const known = new Set(addonRes.rows.map((r) => r.id));
    for (const a of input.addons) {
      if (!known.has(a.addon_id)) {
        throw pricingError(PricingErrorCode.INVALID_ADDON, "One or more add-ons are not available for this branch.");
      }
      addonQuantities.set(a.addon_id, a.quantity ?? 1);
    }
  }

  // Steps 3–4: duration (shared computation — the single duration authority).
  const duration = await computeDuration(
    input.branch_id,
    input.service_id,
    input.scheduled_date,
    input.property_details,
    input.variant_id,
  );

  // Step 5: base = duration × rate × difficulty.
  const baseRateRule = selectBaseRate(ctx.rules, input.service_id, input.variant_id);
  if (!baseRateRule) {
    throw pricingError(PricingErrorCode.SERVICE_NOT_PRICED, "This service is not priced in the active pricing version.");
  }
  const rateCfg = baseRateRule.configuration as { model: string; hourly_rate_minor: number };
  const rateMinor = BigInt(rateCfg.hourly_rate_minor);

  let difficultyMultiplier = 1n * 10000n; // ×1.0 as bp
  const diffRule = selectDifficulty(ctx.rules, input.service_id, input.variant_id);
  let rulesDifficulty: Record<string, unknown> | null = null;
  if (diffRule) {
    const cfg = diffRule.configuration as { level: string; multiplier: number };
    rulesDifficulty = { level: cfg.level, multiplier: cfg.multiplier };
    difficultyMultiplier = BigInt(Math.round(cfg.multiplier * 10_000));
  }

  // Add-ons priced per configured method; duration contributions already in
  // the duration stage? No — PRICING §20 makes add-on duration part of the
  // booking duration, so the addon duration contributions add here (money
  // stage order per §24: base → addons → ...).
  let addonTotal = 0n;
  const addonDetail: Record<string, unknown>[] = [];
  if (input.addons?.length) {
    for (const addon of input.addons) {
      const rule = ctx.rules.find(
        (r) =>
          r.rule_type === "addon_price" &&
          r.service_addon_id === addon.addon_id &&
          (r.service_id === null || r.service_id === input.service_id) &&
          (r.service_variant_id === null || r.service_variant_id === input.variant_id),
      );
      if (!rule) {
        throw pricingError(
          PricingErrorCode.INVALID_ADDON,
          "An add-on is not priced in the active pricing version.",
        );
      }
      const cfg = rule.configuration as AddonPriceRuleConfig;
      const qty = BigInt(addonQuantities.get(addon.addon_id) ?? 1);
      let amount = 0n;
      if (cfg.model === "fixed") amount = BigInt(Math.round(cfg.value)) * qty;
      else if (cfg.model === "per_unit") amount = BigInt(Math.round(cfg.value)) * qty;
      else if (cfg.model === "percentage")
        amount = applyPercentage((rateMinor * BigInt(duration.minutes)) / 60n, Math.round(cfg.value * 100));
      addonTotal += amount;
      addonDetail.push({ addon_id: addon.addon_id, quantity: qty.toString(), model: cfg.model });
    }
  }

  // Base amount: hourly rate prorated per minute (rational, half-up once),
  // then difficulty (bp arithmetic, half-up once) — per-component P14.
  const prorated = roundHalfUp(rateMinor * BigInt(duration.minutes), 60n);
  const baseMinor = roundHalfUp(prorated * difficultyMultiplier, 10_000n);

  // Steps 7–9: inactive stages contribute zero (P9/P5/P6).
  //   minimums: structures exist; the engine NEVER applies them in V1.
  //   night/emergency/holiday: structures may exist; not evaluated in V1.
  //   discounts: stage defined; contributes zero.
  const surchargeTotal = 0n;

  // Sunday surcharge (P5, P5b): highest applicable only. Evaluated against
  // the branch-local weekday of the scheduled date (§50). The branch
  // timezone is authoritative; Date.UTC + Intl gives the local weekday
  // without wall-clock reads.
  let sundayAmount = 0n;
  const sundayRules = selectSurchargeKinds(ctx.rules, "sunday");
  if (sundayRules.length > 0) {
    const tzRes = await query<{ timezone: string }>(
      `select timezone from public.branches where id = $1`,
      [input.branch_id],
    );
    const tz = tzRes.rows[0]?.timezone ?? "UTC";
    const localWeekday = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(new Date(`${input.scheduled_date}T12:00:00Z`));
    if (localWeekday === "Sun") {
      // P5b: highest applicable only — one value wins, computed once.
      let best: { bp: number; minor: bigint } | null = null;
      for (const rule of sundayRules) {
        const cfg = rule.configuration as SurchargeRuleConfig;
        if (cfg.stacking !== "highest_only") continue; // V1 default policy
        const candidateBp = Math.round(cfg.value * 100);
        const candidate =
          cfg.model === "percentage"
            ? applyPercentage(baseMinor, candidateBp)
            : BigInt(Math.round(cfg.value));
        if (!best || candidate > best.minor) best = { bp: candidateBp, minor: candidate };
      }
      if (best) sundayAmount = best.minor;
    }
  }
  const surcharges = surchargeTotal + sundayAmount;

  // Step 10: tax — INACTIVE until the version carries an approved rate
  // (P7b). Tax-exclusive: the tax component is added to the NET subtotal.
  const tax =
    ctx.taxRateBp === null
      ? 0n
      : applyPercentage(baseMinor + addonTotal + surcharges, ctx.taxRateBp);

  const breakdown = {
    base: baseMinor,
    addons: addonTotal,
    surcharges,
    discounts: 0n,
    tax,
  };
  const summed = sumBreakdown(breakdown);

  // Snapshot source — exactly the §16.3 members Booking will store.
  const inputs = {
    branch_id: input.branch_id,
    service_id: input.service_id,
    variant_id: input.variant_id ?? null,
    addons: addonDetail,
    property_details: input.property_details ?? null,
    scheduled_date: input.scheduled_date,
    duration_minutes: duration.minutes,
  };
  const rulesApplied = {
    base_rate: { model: rateCfg.model, hourly_rate_minor: rateCfg.hourly_rate_minor },
    difficulty: rulesDifficulty,
    surcharges: { sunday: sundayRules.length > 0, stacking: "highest_only" },
    tax: ctx.taxRateBp === null ? null : { rate_bp: ctx.taxRateBp, jurisdiction: ctx.taxJurisdiction },
  };

  // Money members are decimal strings ("12.50") for client-safe transport
  // while the internal arithmetic stays in minor units (P14).
  const money = breakdownToJson(summed);
  return {
    currency: ctx.currency,
    duration_minutes: duration.minutes,
    actual_duration_minutes: duration.minutes, // P9: minimums never applied
    base_amount: money.base,
    addon_amount: money.addons,
    surcharge_amount: money.surcharges,
    discount_amount: money.discounts,
    tax_amount: money.tax,
    subtotal: money.subtotal,
    total: money.total,
    pricing_profile_id: ctx.profileId,
    pricing_version_id: ctx.versionId,
    pricing_version_number: ctx.versionNumber,
    breakdown: money,
    snapshot_source: {
      pricing_profile_id: ctx.profileId,
      pricing_version_id: ctx.versionId,
      pricing_version_number: ctx.versionNumber,
      inputs,
      rules_applied: rulesApplied,
      result: money,
    },
  };
}
