/**
 * Booking cancellation-fee engine (Change 5, task 7.1; BD-2).
 *
 * Pure arithmetic over the IMMUTABLE booking pricing snapshot (BD-2.2):
 * fee = tier percent × snapshot total (tax included, tips excluded),
 * half-up rounded to the currency minor unit, exactly once. The current
 * Pricing Engine is NEVER invoked on historical bookings — the stored
 * snapshot is authoritative; Pricing owns its creation/preservation,
 * Booking applies policy to it.
 */
import { applyPercentage } from "@/features/pricing/money";
import type { CancellationTier } from "./configuration";

/**
 * Extract the authoritative booking total (minor units) from a stored
 * pricing snapshot: tax included, tips excluded (BD-2.2). Snapshot totals
 * are decimal strings per the P14 transport convention; tips never exist
 * as a pricing stage in V1 (no tip stage → nothing to exclude), asserted
 * defensively.
 */
export function snapshotTotalMinor(snapshot: {
  result?: Record<string, string>;
  total?: string;
}): bigint {
  const total = snapshot.result?.total ?? snapshot.total;
  if (typeof total !== "string") {
    throw new Error("Booking pricing snapshot is missing the authoritative total.");
  }
  const value = BigInt(Math.round(Number(total) * 100));
  if (value < 0n) throw new Error("Snapshot total must be non-negative.");
  return value;
}

/** Half-up fee computation: percent × total, one rounding, minor units. */
export function computeCancellationFee(totalMinor: bigint, tierPercent: number): bigint {
  if (tierPercent === 0) return 0n;
  return applyPercentage(totalMinor, Math.round(tierPercent * 100));
}

/**
 * Resolve the applicable tier from a policy snapshot for a notice measured
 * in hours until scheduled_start. Bands are [min, max): exactly 24h → the
 * 0% band, exactly 12h → 25%, exactly 2h → 50% (BD-2 boundary record).
 * Notice < 0 (post-start) is never tiered — BD-2.5 prohibits customer
 * cancellation there outright.
 */
export function tierForNoticeHours(
  tiers: CancellationTier[],
  noticeHours: number,
): CancellationTier | null {
  if (noticeHours < 0) return null;
  for (const tier of tiers) {
    const upper = tier.max_hours ?? Number.POSITIVE_INFINITY;
    if (noticeHours >= tier.min_hours && noticeHours < upper) return tier;
  }
  return null;
}
