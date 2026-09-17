/**
 * Pricing → Scheduling duration seam (P21 — the single duration authority).
 *
 * The scheduling `DurationProvider` contract stays the platform seam; this
 * adapter implements it from the Pricing rule engine, so quote calculation
 * and slot availability share exactly one duration computation (P21: no
 * second duration system may exist).
 */
import "server-only";
import type { DurationProvider, DurationSelection } from "@/features/scheduling/durationProvider";
import { query } from "@/lib/db/server";
import { computeDuration } from "./quote";
import { propertyDetailsSchema, type PropertyDetails } from "./schemas/pricing";

export interface PricingDurationSelection extends DurationSelection {
  /** P-D1: typed optional property details (Zod-validated at the boundary). */
  propertyDetails?: PropertyDetails;
  /**
   * The scheduled service date (YYYY-MM-DD) the P17 effective-window
   * selection evaluates. Availability callers pass the candidate slot's
   * date; when omitted, "today" in the branch timezone is used (§49).
   */
  scheduledDate?: string;
}

/** Branch-local calendar date (YYYY-MM-DD) for an instant (§50). */
export function branchLocalDate(instant: Date, timezone: string): string {
  // en-CA yields ISO-like YYYY-MM-DD deterministically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The real duration authority (P21). Scheduling actions wire this provider;
 * `placeholderDurationProvider` is deleted by this change.
 */
export function pricingDurationProvider(selection: PricingDurationSelection): DurationProvider {
  return {
    async getEstimatedDuration(): Promise<number> {
      const details = selection.propertyDetails
        ? (propertyDetailsSchema.parse(selection.propertyDetails) as PropertyDetails)
        : undefined;

      let scheduledDate = selection.scheduledDate;
      if (!scheduledDate) {
        // No explicit target date: "today" in the BRANCH timezone (§49 —
        // never silently the server's UTC date). Branch timezone comes from
        // the authoritative branches row.
        const tzRes = await query<{ timezone: string }>(
          `select timezone from public.branches where id = $1`,
          [selection.branchId],
        );
        const tz = tzRes.rows[0]?.timezone;
        if (!tz) scheduledDate = branchLocalDate(new Date(), "UTC");
        else scheduledDate = branchLocalDate(new Date(), tz);
      }

      const result = await computeDuration(
        selection.branchId,
        selection.serviceId,
        scheduledDate,
        details,
        selection.variantId,
      );
      return result.minutes;
    },
  };
}

export type { PropertyDetails };
