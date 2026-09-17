/**
 * Pricing Engine duration seam (Change 3 — S6; wired to the real authority
 * in Change 4A — P21).
 *
 * Scheduling NEVER calculates duration (S6, SCHEDULING_SYSTEM §81,
 * PRICING_ENGINE §13). The availability engine and hold service consume
 * authoritative minutes through this contract; the REAL provider is
 * implemented by features/pricing/durationProvider (P21 — the single
 * duration authority). Exactly ONE duration authority may exist — this file
 * is the seam, not a second source of pricing rules.
 */
import type { PropertyDetails } from "@/features/pricing/schemas/pricing";

export interface DurationSelection {
  branchId: string;
  serviceId: string;
  variantId?: string;
  addons?: { addonId: string; quantity: number }[];
  /**
   * P-D1 (Change 4A): typed optional property details consumed by the
   * pricing duration rules; validated by the pricing boundary Zod schema.
   */
  propertyDetails?: PropertyDetails;
  /**
   * Change 4A: the scheduled service date (YYYY-MM-DD) the pricing
   * effective-window selection evaluates; omitted = branch-local today.
   */
  scheduledDate?: string;
}

export interface DurationProvider {
  /** Authoritative estimated duration in whole minutes (≥ 1) — PRICING_ENGINE §14. */
  getEstimatedDuration(selection: DurationSelection): Promise<number>;
}
