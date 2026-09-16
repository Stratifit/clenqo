/**
 * Pricing Engine duration seam (Change 3, design §3 — S6).
 *
 * Scheduling NEVER calculates duration (S6, SCHEDULING_SYSTEM §81,
 * PRICING_ENGINE §13). The availability engine and hold service consume
 * authoritative minutes through this contract; the future Pricing Engine
 * change implements the real provider and deletes the placeholder below.
 * Exactly ONE duration authority may exist — this file is the seam, not a
 * second source of pricing rules.
 */

export interface DurationSelection {
  branchId: string;
  serviceId: string;
  variantId?: string;
  addons?: { addonId: string; quantity: number }[];
}

export interface DurationProvider {
  /** Authoritative estimated duration in whole minutes (≥ 1) — PRICING_ENGINE §14. */
  getEstimatedDuration(selection: DurationSelection): Promise<number>;
}

/**
 * PLACEHOLDER adapter (design §3): returns a fixed estimate until the
 * Pricing Engine change ships. Explicitly NOT a duration authority — no
 * catalog or pricing fields are read here. Delete when the real provider
 * arrives (Change 4+).
 */
export const placeholderDurationProvider: DurationProvider = {
  async getEstimatedDuration(): Promise<number> {
    return 60; // minutes — platform placeholder estimate
  },
};
