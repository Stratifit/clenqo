/**
 * Booking seed (Change 5, task 5.3) — provisioning-integrated, IDEMPOTENT,
 * structure-only, mirroring `seedSchedulingDefaults` (Change 3) and
 * `seedPricingDefaults` (Change 4A).
 *
 * Seeds per branch:
 *   - the DEFAULT cancellation policy (BD-2.3): the documented platform
 *     default tiers 24+ → 0% / 12–24 → 25% / 2–12 → 50% / <2h → 100%.
 *     These are ALREADY-APPROVED business values (BD-2 decision record and
 *     the BD-2 documentation commit) — not new values. The policy is seeded
 *     as `published` effective from the platform default date so a branch
 *     is immediately bookable.
 *   - NO service areas (BD-6: branch-managed content — an empty allowlist
 *     is the truthful "not configured" state, not an invented value).
 *   - NO pricing values, NO catalog content, NO customers.
 *
 * Re-running changes nothing (natural-key upserts + status guard).
 */
import "server-only";
import { query, withTransaction } from "@/lib/db/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { AppError, ErrorCode } from "@/lib/errors";

export const BOOKING_SEED_EFFECTIVE_FROM = "2026-01-01";

/**
 * BD-2 documented default tiers (approved business values — verbatim),
 * stored as ascending contiguous bands [min_hours, max_hours).
 */
export const DEFAULT_CANCELLATION_TIERS = [
  { min_hours: 0, max_hours: 2, percent: 100 },
  { min_hours: 2, max_hours: 12, percent: 50 },
  { min_hours: 12, max_hours: 24, percent: 25 },
  { min_hours: 24, max_hours: null, percent: 0 },
];

export interface BookingSeedResult {
  branchesProcessed: number;
  policiesInserted: number;
}

export async function seedBookingDefaults(branchId?: string): Promise<BookingSeedResult> {
  const branches = branchId
    ? (
        await query<{ id: string; organization_id: string }>(
          `select id, organization_id from public.branches where id = $1`,
          [branchId],
        )
      ).rows
    : (await query<{ id: string; organization_id: string }>(`select id, organization_id from public.branches`)).rows;
  if (branchId && branches.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  }

  let policiesInserted = 0;

  for (const branch of branches) {
    await withTransaction(async (tx) => {
      // One seed policy per branch: natural identity (branch, version 1).
      // Insert only when version 1 does not exist yet (rerun ⇒ no-op).
      const res = await tx.query<{ inserted: boolean }>(
        `insert into public.branch_cancellation_policies
           (organization_id, branch_id, version_number, status, effective_from, effective_until, tiers)
         select b.organization_id, b.id, 1, 'published', $2::date, null, $3::jsonb
         from public.branches b where b.id = $1
         on conflict (branch_id, version_number) do nothing
         returning (xmax = 0) as inserted`,
        [branch.id, BOOKING_SEED_EFFECTIVE_FROM, JSON.stringify(DEFAULT_CANCELLATION_TIERS)],
      );
      if (res.rows[0]?.inserted) policiesInserted += 1;

      await writeAuditEvent(
        {
          action: "booking.seeded",
          organizationId: branch.organization_id,
          branchId: branch.id,
          actorType: "system",
          resourceType: "branch_cancellation_policies",
          resourceId: branch.id,
          metadata: {
            source: "seedBookingDefaults",
            effective_from: BOOKING_SEED_EFFECTIVE_FROM,
            default_policy: true,
          },
        },
        tx,
      );
    });
  }

  return { branchesProcessed: branches.length, policiesInserted };
}
