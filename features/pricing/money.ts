/**
 * Decimal-safe money arithmetic (P14/P15; PRICING_ENGINE §15, §31).
 *
 * Representation: JavaScript bigint in currency MINOR UNITS (P14) — never
 * binary floating point for authoritative money (§31). Rounding: half-up,
 * applied exactly once per component; the total is the exact component sum
 * (sum invariant). Percentage application: rational arithmetic
 * (value × pct / 10 000) with a single half-up rounding at the end.
 */

/** Half-up rounding of a rational num/den (both non-negative) to an integer. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("roundHalfUp: zero denominator");
  // For non-negative rationals: floor((num + den/2) / den).
  const twice = num * 2n + den;
  return twice / (den * 2n);
}

/** Convert a decimal string ("12.50") to minor units (bigint). */
export function parseMinor(decimal: string): bigint {
  const m = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!m) throw new Error(`Invalid decimal money value: ${decimal}`);
  const sign = decimal.startsWith("-") ? -1n : 1n;
  const whole = BigInt(m[1]);
  const frac = m[2] ?? "";
  const fracMinor = frac.length === 0 ? 0n : BigInt(frac.padEnd(2, "0"));
  return sign * (whole * 100n + fracMinor);
}

/** Format minor units to a decimal string for display/snapshot. */
export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = `${whole}.${frac.toString().padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * Apply a basis-point-style percentage (e.g. 25% → 2500) to a minor-unit
 * amount with ONE half-up rounding. `pctBp` is percent × 100 (integer).
 */
export function applyPercentage(minor: bigint, pctBp: number): bigint {
  if (!Number.isInteger(pctBp) || pctBp < 0) {
    throw new Error(`Invalid percentage: ${pctBp}`);
  }
  return roundHalfUp(minor * BigInt(pctBp), 10_000n);
}

/**
 * A quote's monetary breakdown (minor units). Invariant (P14): total ===
 * base + addons + surcharges − discounts + tax, exactly, always.
 */
export interface MoneyBreakdown {
  base: bigint;
  addons: bigint;
  surcharges: bigint;
  discounts: bigint;
  tax: bigint;
  /** subtotal = base + addons + surcharges − discounts (net, tax-exclusive). */
  subtotal: bigint;
  /** total = subtotal + tax (gross). */
  total: bigint;
}

export function sumBreakdown(parts: {
  base: bigint;
  addons: bigint;
  surcharges: bigint;
  discounts: bigint;
  tax: bigint;
}): MoneyBreakdown {
  const subtotal = parts.base + parts.addons + parts.surcharges - parts.discounts;
  return { ...parts, subtotal, total: subtotal + parts.tax };
}

/** Serialize a breakdown for the snapshot/JSON (strings preserve precision). */
export function breakdownToJson(b: MoneyBreakdown): Record<string, string> {
  return {
    base: formatMinor(b.base),
    addons: formatMinor(b.addons),
    surcharges: formatMinor(b.surcharges),
    discounts: formatMinor(b.discounts),
    tax: formatMinor(b.tax),
    subtotal: formatMinor(b.subtotal),
    total: formatMinor(b.total),
  };
}

export const MINOR_UNIT_FACTOR = 100n;
