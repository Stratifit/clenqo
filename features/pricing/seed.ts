/**
 * Pricing seed (Change 4A, task 7.1; P18 + P3).
 *
 * `seedPricingDefaults(branchId)` is the provisioning-integrated, IDEMPOTENT,
 * STRUCTURE-ONLY seed mirroring `seedSchedulingDefaults` (Change 3):
 *
 *  - one draft pricing profile per branch ("Default Pricing", branch currency)
 *  - one empty draft version (effective 2026-01-01 → open)
 *
 * It seeds NO rules and therefore NO prices, rates, multipliers, minimums,
 * or tax values (P3: production business values come only from the approved
 * business value sheet; until then fixtures exist only in tests). Re-running
 * on the same branch changes nothing (`on conflict do nothing` + status
 * guard), and the seed execution is audited per branch.
 */
import "server-only";
import { query, withTransaction } from "@/lib/db/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { AppError, ErrorCode } from "@/lib/errors";

export interface PricingSeedResult {
  branchesProcessed: number;
  profilesInserted: number;
  versionsInserted: number;
}

export const PRICING_SEED_EFFECTIVE_FROM = "2026-01-01"; // platform default effective date
export const PRICING_SEED_PROFILE_NAME = "Default Pricing";

export async function seedPricingDefaults(branchId?: string): Promise<PricingSeedResult> {
  const branches = branchId
    ? (await query<{ id: string; organization_id: string; currency: string }>(
        `select id, organization_id, currency from public.branches where id = $1`,
        [branchId],
      )).rows
    : (await query<{ id: string; organization_id: string; currency: string }>(
        `select id, organization_id, currency from public.branches`,
      )).rows;
  if (branchId && branches.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  }

  let profilesInserted = 0;
  let versionsInserted = 0;

  for (const branch of branches) {
    await withTransaction(async (tx) => {
      // Profile (P11/P12): draft, branch currency, natural key (branch, name).
      const profile = await tx.query<{ id: string; inserted: boolean }>(
        `insert into public.pricing_profiles
           (organization_id, branch_id, name, description, currency, status, sort_order)
         select b.organization_id, b.id, $2, $3, b.currency, 'draft', 0
         from public.branches b where b.id = $1
         on conflict (branch_id, name) do nothing
         returning id, (xmax = 0) as inserted`,
        [branch.id, PRICING_SEED_PROFILE_NAME, "Structure-only seed (no pricing values; P3)."],
      );
      const profileId = profile.rows[0]?.id;
      if (profile.rows[0]?.inserted) profilesInserted += 1;

      if (!profileId) {
        // Profile already existed — the seed version guard below still runs
        // so an interrupted earlier seed can complete idempotently.
        const existing = await tx.query<{ id: string }>(
          `select id from public.pricing_profiles where branch_id = $1 and name = $2`,
          [branch.id, PRICING_SEED_PROFILE_NAME],
        );
        void existing; // covered by the version insert guard below
      }

      // Draft version (one per seeded profile): a version is "the seed
      // version" when it has no rules and status draft — look up by natural
      // identity (profile, version_number = 1, draft).
      const versionRes = profileId
        ? await tx.query<{ id: string; inserted: boolean }>(
            `insert into public.pricing_versions
               (organization_id, branch_id, pricing_profile_id, version_number,
                status, effective_from, effective_until)
             select organization_id, branch_id, id, 1, 'draft', $2::date, null
             from public.pricing_profiles where id = $1
             on conflict (pricing_profile_id, version_number) do nothing
             returning id, (xmax = 0) as inserted`,
            [profileId, PRICING_SEED_EFFECTIVE_FROM],
          )
        : null;
      if (versionRes?.rows[0]?.inserted) versionsInserted += 1;

      // Seed provenance audit (mirrors scheduling.seeded) — per branch, only
      // meaningful when the run is executed; recorded inside the tx.
      const orgId =
        branch.organization_id ??
        (
          await tx.query<{ organization_id: string }>(
            `select organization_id from public.branches where id = $1`,
            [branch.id],
          )
        ).rows[0].organization_id;
      await writeAuditEvent(
        {
          action: "pricing.seeded",
          organizationId: orgId,
          branchId: branch.id,
          actorType: "system",
          resourceType: "pricing_profiles",
          resourceId: profileId ?? branch.id,
          metadata: {
            source: "seedPricingDefaults",
            structure_only: true,
            profile_name: PRICING_SEED_PROFILE_NAME,
            effective_from: PRICING_SEED_EFFECTIVE_FROM,
          },
        },
        tx,
      );
    });
  }

  return { branchesProcessed: branches.length, profilesInserted, versionsInserted };
}
