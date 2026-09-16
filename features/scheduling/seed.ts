/**
 * Idempotent scheduling seed (Change 3, task 11.1).
 *
 * Applies, per branch, with natural-key upserts (rerun ⇒ identical row
 * counts and values — same guarantees as Change 1 provisioning):
 *   - S2b default operating hours: Mon–Fri 08:00–18:00, Sat 09:00–14:00,
 *     Sun closed (no rows for weekday 0).
 *   - Platform default scheduling configuration (S3/S4/S5/S6b/S7b/S12/S1b).
 *     The configuration row is normally seeded together with the hours on
 *     first provisioning; the upsert here guarantees it for pre-existing
 *     branches and keeps values at §86 defaults only when absent.
 *
 * NO business catalog content is invented here (Q6 boundary preserved) —
 * only the approved §86 default values.
 */
import "server-only";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";

/** §86 approved defaults (S2b + configuration block). */
export const DEFAULT_OPERATING_HOURS: Record<number, { start: string; end: string }[]> = {
  1: [{ start: "08:00", end: "18:00" }], // Mon
  2: [{ start: "08:00", end: "18:00" }], // Tue
  3: [{ start: "08:00", end: "18:00" }], // Wed
  4: [{ start: "08:00", end: "18:00" }], // Thu
  5: [{ start: "08:00", end: "18:00" }], // Fri
  6: [{ start: "09:00", end: "14:00" }], // Sat
  // 0 = Sunday: closed — no rows (S2).
};

export interface SeedResult {
  branchesProcessed: number;
  hoursRowsInserted: number;
  configRowsInserted: number;
}

/**
 * Seed defaults for every branch (or a specific one). Idempotent: hours rows
 * use `on conflict do nothing` on the natural key
 * (branch_id, weekday, interval_index, effective_from); the configuration
 * row uses `on conflict (branch_id) do nothing` so branch-customized values
 * are never overwritten.
 */
export async function seedSchedulingDefaults(branchId?: string): Promise<SeedResult> {
  const branches = branchId
    ? (
        await query<{ id: string }>(`select id from public.branches where id = $1`, [branchId])
      ).rows
    : (await query<{ id: string }>(`select id from public.branches`)).rows;
  if (branchId && branches.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  }

  let hoursRowsInserted = 0;
  let configRowsInserted = 0;
  const effectiveFrom = "2026-01-01"; // platform default effective date

  for (const branch of branches) {
    await withTransaction(async (tx) => {
      // Configuration singleton (defaults via the table DEFAULTs = §86).
      const cfg = await tx.query<{ inserted: boolean }>(
        `insert into public.branch_scheduling_configuration (organization_id, branch_id)
         select b.organization_id, b.id
         from public.branches b where b.id = $1
         on conflict (branch_id) do nothing
         returning (xmax = 0) as inserted`,
        [branch.id],
      );
      if (cfg.rows[0]?.inserted) configRowsInserted += 1;

      // Weekly template (S2b). Closed days get no rows.
      for (const [weekdayStr, intervals] of Object.entries(DEFAULT_OPERATING_HOURS)) {
        const weekday = Number(weekdayStr);
        for (let i = 0; i < intervals.length; i++) {
          const res = await tx.query<{ inserted: boolean }>(
            `insert into public.branch_operating_hours
               (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
             select b.organization_id, b.id, $2, $3, $4::time, $5::time, $6::date
             from public.branches b where b.id = $1
             on conflict (branch_id, weekday, interval_index, effective_from) do nothing
             returning (xmax = 0) as inserted`,
            [branch.id, weekday, i, intervals[i].start, intervals[i].end, effectiveFrom],
          );
          if (res.rows[0]?.inserted) hoursRowsInserted += 1;
        }
      }

      // Seed provenance is audited once per branch per run that changed
      // nothing silently: the audit event records the seed execution.
      await writeAuditEvent(
        {
          action: "scheduling.seeded",
          organizationId: (
            await tx.query<{ organization_id: string }>(
              `select organization_id from public.branches where id = $1`,
              [branch.id],
            )
          ).rows[0].organization_id,
          branchId: branch.id,
          actorType: "system",
          resourceType: "branch_scheduling_configuration",
          resourceId: branch.id,
          metadata: { source: "seedSchedulingDefaults", effective_from: effectiveFrom },
        },
        tx,
      );
    });
  }

  return {
    branchesProcessed: branches.length,
    hoursRowsInserted,
    configRowsInserted,
  };
}
