/**
 * Booking input schemas (Change 5, task 3.1).
 *
 * Validation mirrors the migration 0011 CHECK constraints so invalid input
 * fails at the boundary with stable INVALID_INPUT errors before the
 * privileged client touches the database (API_STANDARDS §46; DATABASE.md §42:
 * JSONB never unstructured).
 *
 * Normative sources: design.md §1 (BD-1…BD-6, B-NEW-1, TD-1), §6–§9.
 * This file contains NO production business values.
 */
import { z } from "zod";
import { propertyDetailsSchema } from "@/features/pricing/schemas/pricing";

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

/** ISO date (YYYY-MM-DD). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
/** Absolute UTC instants for scheduled times (timestamptz). */
const utcInstant = z.string().datetime({ offset: true });

/** E.164 phone normalization (BD-4): trim, strip non-digits, force leading +. */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 2 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Email normalization (BD-4): trim + lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Customer (BD-4)
// ---------------------------------------------------------------------------

export const customerInputSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().min(3).max(254).email("A valid email address is required"),
  phone: z.string().trim().max(30).optional(),
  company: z.string().trim().max(200).optional(),
  preferred_language: z.string().trim().min(2).max(10).optional(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const updateCustomerSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().min(3).max(254).email().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  preferred_language: z.string().trim().min(2).max(10).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  contact_conflict_flag: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// ---------------------------------------------------------------------------
// Addresses (TD-4)
// ---------------------------------------------------------------------------

export const addressInputSchema = z.object({
  street: z.string().trim().min(1).max(200),
  house_number: z.string().trim().min(1).max(20),
  postal_code: z.string().trim().min(2).max(12),
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().length(2).transform((v) => v.toUpperCase()),
  access_instructions: z.string().trim().max(2000).optional(),
  label: z.string().trim().max(100).optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

// ---------------------------------------------------------------------------
// Cancellation policy configuration (BD-2)
// ---------------------------------------------------------------------------

export const CANCELLATION_TIERS_SCHEMA = z
  .array(
    z.object({
      /** Inclusive lower bound in hours of notice remaining. */
      min_hours: z.number().min(0),
      /** Exclusive upper bound in hours; null = open-ended. */
      max_hours: z.number().min(0).nullable(),
      /** Fee percentage 0–100. */
      percent: z.number().min(0).max(100),
    }),
  )
  .min(1)
  .refine(
    (tiers) =>
      tiers.every(
        (t, i) =>
          i === 0 ||
          (tiers[i - 1].max_hours !== null &&
            tiers[i - 1].max_hours === t.min_hours &&
            t.min_hours < (t.max_hours ?? Number.POSITIVE_INFINITY)),
      ),
    { message: "Tiers must form contiguous ascending bands from the lowest min_hours" },
  );

export const createCancellationPolicySchema = z.object({
  branch_id: z.string().uuid(),
  effective_from: isoDate,
  effective_until: isoDate.optional(),
  tiers: CANCELLATION_TIERS_SCHEMA,
});
export type CreateCancellationPolicyInput = z.infer<typeof createCancellationPolicySchema>;

export const publishCancellationPolicySchema = z.object({
  effective_from: isoDate.optional(),
  effective_until: isoDate.optional(),
});

// ---------------------------------------------------------------------------
// Service area (BD-6)
// ---------------------------------------------------------------------------

export const setServiceAreasSchema = z.object({
  branch_id: z.string().uuid(),
  postal_codes: z.array(z.string().trim().min(2).max(12)).max(1000),
});
export type SetServiceAreasInput = z.infer<typeof setServiceAreasSchema>;

// ---------------------------------------------------------------------------
// Confirmation (design §6) — customer-facing checkout
// ---------------------------------------------------------------------------

export const BOOKING_SOURCES = ["website", "dashboard", "phone", "admin", "api"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const confirmBookingSchema = z.object({
  branch_id: z.string().uuid(),
  service_id: z.string().uuid(),
  variant_id: z.string().uuid().optional(),
  addons: z
    .array(z.object({ addon_id: z.string().uuid(), quantity: z.number().int().min(1).max(100) }))
    .max(50)
    .optional(),
  property_details: propertyDetailsSchema.optional(),
  /** Requested absolute UTC start (must be an availability slot). */
  scheduled_start: utcInstant,
  /** Hold created during checkout (S1) — consumed in the transaction. */
  hold_id: z.string().uuid(),
  session_id: z.string().min(1).max(255),
  customer: customerInputSchema,
  /** TD-4: address snapshot captured at confirmation. */
  service_address: addressInputSchema,
  source: z.enum(BOOKING_SOURCES).default("website"),
  customer_notes: z.string().trim().max(2000).optional(),
  /** TD-2: the total the customer accepted (integer minor units). */
  accepted_total_minor: z.number().int().min(0),
  /** TD-5: caller-supplied idempotency key. */
  idempotency_key: z.string().min(8).max(255),
  booking_type: z
    .enum(["one_time", "recurring", "move_in", "move_out", "commercial", "airbnb"])
    .default("one_time"),
});
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

// ---------------------------------------------------------------------------
// Cancellation (design §7) + override (BD-2.4)
// ---------------------------------------------------------------------------

export const cancelBookingSchema = z.object({
  booking_id: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const overrideCancellationFeeSchema = z.object({
  booking_id: z.string().uuid(),
  final_fee_minor: z.number().int().min(0),
  reason: z.string().trim().min(3).max(1000),
});
export type OverrideCancellationFeeInput = z.infer<typeof overrideCancellationFeeSchema>;

// ---------------------------------------------------------------------------
// Rescheduling (design §8, BD-3)
// ---------------------------------------------------------------------------

export const requestRescheduleSchema = z.object({
  booking_id: z.string().uuid(),
  /** Target slot (must be a real availability slot satisfying S4 notice). */
  target_start: utcInstant,
  target_end: utcInstant,
  /** Hold on the target slot per TD-3.1 (customer flow). */
  hold_id: z.string().uuid().optional(),
  session_id: z.string().min(1).max(255).optional(),
  reason: z.string().trim().max(1000).optional(),
  /** BD-3.5a: the customer's accepted target total when the price rises. */
  accepted_target_total_minor: z.number().int().min(0).optional(),
  /**
   * TD-3.3 stale detection: the scheduled_start the request was BUILT from.
   * When presented, it must equal the booking's current scheduled_start or
   * the request is stale (optimistic-concurrency token).
   */
  expected_current_scheduled_start: utcInstant.optional(),
  /** TD-3.3: per-attempt idempotency key. */
  idempotency_key: z.string().min(8).max(255),
});
export type RequestRescheduleInput = z.infer<typeof requestRescheduleSchema>;

// ---------------------------------------------------------------------------
// Magic links (TD-3)
// ---------------------------------------------------------------------------

export const issueMagicLinkSchema = z.object({
  booking_number: z.string().trim().max(32),
  email: z.string().trim().min(3).max(254).email(),
});
export type IssueMagicLinkInput = z.infer<typeof issueMagicLinkSchema>;

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(32).max(255),
});
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
