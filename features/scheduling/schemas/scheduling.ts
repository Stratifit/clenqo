/**
 * Scheduling & availability input schemas (Change 3, tasks 5.x).
 *
 * Validation mirrors the migration 0009 CHECK constraints so invalid input
 * fails at the boundary with stable INVALID_INPUT errors before the
 * privileged client ever touches the database (API_STANDARDS §46:
 * JSONB never unstructured; DATABASE.md §42).
 *
 * Normative source: docs/SCHEDULING_SYSTEM.md §84–86 (S1–S18 decision
 * record). Business values below are the APPROVED seed defaults — per-branch
 * configurable afterwards (S2b, S4, S5, S6b, S7b, S12, S1b).
 */
import { z } from "zod";

/** S9: the four approved exception types. */
export const SCHEDULE_EXCEPTION_TYPES = [
  "closed",
  "reduced_hours",
  "blackout",
  "holiday_override",
] as const;
export type ScheduleExceptionType = (typeof SCHEDULE_EXCEPTION_TYPES)[number];

/** A branch-local wall-clock interval, `HH:MM` 24h. S13: must not wrap. */
const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24h) branch-local time");
const intervalShape = z
  .object({ start: wallClock, end: wallClock })
  .refine((v) => v.end > v.start, {
    message: "end_time must be after start_time (no overnight intervals, S13)",
    path: ["end"],
  });
export const timeIntervalsSchema = z
  .array(intervalShape)
  .min(1, "At least one interval is required");
export type TimeInterval = z.infer<typeof intervalShape>;

/** Weekday 0–6, 0 = Sunday (matches migration 0009 and JS getDay()). */
export const weekdaySchema = z.number().int().min(0).max(6);

// ---------------------------------------------------------------------------
// Branch scheduling configuration (S3/S4/S5/S6b/S7b/S12/S1b)
// ---------------------------------------------------------------------------

export const updateSchedulingConfigSchema = z
  .object({
    minimum_notice_minutes: z.number().int().min(0).optional(),
    maximum_advance_days: z.number().int().min(1).max(730).optional(),
    slot_grid_minutes: z
      .number()
      .int()
      .min(5)
      .refine((v) => 60 % v === 0, "Slot grid must divide evenly into one hour (S3)")
      .optional(),
    operational_buffer_minutes: z.number().int().min(0).optional(),
    travel_buffer_minutes: z.number().int().min(0).optional(),
    concurrency_cap: z.number().int().min(1).optional(),
    customer_horizon_days: z.number().int().min(1).max(365).optional(),
    hold_ttl_minutes: z.number().int().min(1).optional(),
  })
  .refine(
    (v) =>
      v.customer_horizon_days === undefined ||
      v.maximum_advance_days === undefined ||
      v.customer_horizon_days <= v.maximum_advance_days,
    { message: "customer_horizon_days must not exceed maximum_advance_days (S12)" },
  );
export type UpdateSchedulingConfigInput = z.infer<typeof updateSchedulingConfigSchema>;

// ---------------------------------------------------------------------------
// Branch operating hours (S2) — effective-dated weekly template
// ---------------------------------------------------------------------------

export const upsertOperatingHoursSchema = z.object({
  weekday: weekdaySchema,
  intervals: timeIntervalsSchema,
  /** ISO date the template version takes effect (YYYY-MM-DD). */
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
});
export type UpsertOperatingHoursInput = z.infer<typeof upsertOperatingHoursSchema>;

/** Effective-dating update: history immutable (S2); only the open end moves. */
export const closeOperatingHoursSchema = z.object({
  /** New effective date — the previous version closes the day before. */
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  /** Omit intervals to close the weekday entirely (no rows = closed day). */
  intervals: timeIntervalsSchema.optional(),
});
export type CloseOperatingHoursInput = z.infer<typeof closeOperatingHoursSchema>;

// ---------------------------------------------------------------------------
// Branch schedule exceptions (S9/S9b) — typed, manual V1 source
// ---------------------------------------------------------------------------

export const createScheduleExceptionSchema = z
  .object({
    exception_type: z.enum(SCHEDULE_EXCEPTION_TYPES),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
    /** Required for reduced_hours; rejected otherwise (typed model, S9). */
    intervals: timeIntervalsSchema.optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.start_date <= v.end_date, {
    message: "start_date must be on or before end_date",
    path: ["end_date"],
  })
  .refine((v) => v.exception_type !== "reduced_hours" || v.intervals !== undefined, {
    message: "reduced_hours exceptions require replacement intervals (S9)",
    path: ["intervals"],
  });
export type CreateScheduleExceptionInput = z.infer<typeof createScheduleExceptionSchema>;

export const deleteScheduleExceptionSchema = z.object({
  exception_id: z.string().uuid(),
});
export type DeleteScheduleExceptionInput = z.infer<typeof deleteScheduleExceptionSchema>;

// ---------------------------------------------------------------------------
// Service scheduling rules (S18) — per-service windows only, never pricing
// ---------------------------------------------------------------------------

export const upsertServiceSchedulingRuleSchema = z
  .object({
    service_id: z.string().uuid(),
    /** Omit = every day the branch is open (migration 0009: NULL weekday). */
    weekday: weekdaySchema.optional(),
    /** Single window; omit both times to inherit the branch operating window. */
    start_time: wallClock.optional(),
    end_time: wallClock.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => (v.start_time === undefined) === (v.end_time === undefined), {
    message: "start_time and end_time must be provided together",
  })
  .refine(
    (v) => v.start_time === undefined || v.end_time === undefined || v.end_time > v.start_time,
    { message: "end_time must be after start_time (no overnight intervals, S13)", path: ["end_time"] },
  );
export type UpsertServiceSchedulingRuleInput = z.infer<typeof upsertServiceSchedulingRuleSchema>;

// ---------------------------------------------------------------------------
// Slot holds (S1/S1b) — creation from a booking session
// ---------------------------------------------------------------------------

export const createSlotHoldSchema = z.object({
  branch_id: z.string().uuid(),
  service_id: z.string().uuid(),
  /** Variant may refine duration; the interval stays authoritative (S6). */
  variant_id: z.string().uuid().optional(),
  /** Absolute UTC instants (timestamptz), e.g. 2027-03-28T01:30:00Z. */
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  session_id: z.string().min(1).max(255),
  idempotency_key: z.string().min(1).max(255),
});
export type CreateSlotHoldInput = z.infer<typeof createSlotHoldSchema>;

export const consumeSlotHoldSchema = z.object({
  hold_id: z.string().uuid(),
  session_id: z.string().min(1).max(255),
  booking_id: z.string().uuid(),
});
export type ConsumeSlotHoldInput = z.infer<typeof consumeSlotHoldSchema>;

// ---------------------------------------------------------------------------
// Availability request validation (SCHEDULING_SYSTEM §60 — server-side Zod
// validation; §25 customer-safe result shape).
// ---------------------------------------------------------------------------

export const availabilityRequestSchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  /** Query horizon length in days; clamped by branch config (S12). */
  days: z.number().int().min(1).max(90).optional(),
});
export type AvailabilityRequestInput = z.infer<typeof availabilityRequestSchema>;

export const releaseSlotHoldSchema = z.object({
  hold_id: z.string().uuid(),
  session_id: z.string().min(1).max(255),
});
export type ReleaseSlotHoldInput = z.infer<typeof releaseSlotHoldSchema>;
