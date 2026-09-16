/**
 * Branch activation — a distinct authorized operation (BRANCH_SYSTEM §19).
 * Gate: `branches.activate` permission + provisioning `ready` + the documented
 * readiness checklist (§45, §74–75). Services/pricing/hours/notifications are
 * Phase-1 follow-ons and are intentionally reported as missing here —
 * activation therefore cannot succeed until those capabilities ship
 * (spec: "Activation blocked when requirements missing").
 */
import { requirePermission, requireOrganizationAccess, hasBranchScope, type AuthContext } from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { logger, metrics } from "@/lib/observability/logger";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { getBranchById, type BranchRecord } from "./service";

export interface ReadinessItem {
  requirement: string;
  satisfied: boolean;
  note?: string;
}

/**
 * Mandatory configuration per BRANCH_SYSTEM §74. Items owned by future
 * Phase-1 changes are evaluated against current data and will list as
 * missing until implemented — the checklist must reflect real state.
 */
export async function evaluateReadiness(branch: BranchRecord): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = [];

  items.push({ requirement: "branch_profile", satisfied: true });
  items.push({ requirement: "website", satisfied: branch.provisioning_status === "ready" });
  items.push({ requirement: "locales", satisfied: branch.provisioning_status === "ready" });

  const services = await query<{ count: string }>(
    `select count(*)::text as count from public.services where branch_id = $1 and status = 'active'`,
    [branch.id],
  ).catch(() => ({ rows: [{ count: "0" }], rowCount: 1 }));
  items.push({
    requirement: "services",
    satisfied: Number(services.rows[0]?.count ?? 0) > 0,
    note: "services domain ships in a later Phase-1 change",
  });

  const pricing = await query<{ count: string }>(
    `select count(*)::text as count from public.pricing_profiles where branch_id = $1 and status = 'active'`,
    [branch.id],
  ).catch(() => ({ rows: [{ count: "0" }], rowCount: 1 }));
  items.push({
    requirement: "pricing",
    satisfied: Number(pricing.rows[0]?.count ?? 0) > 0,
    note: "pricing domain ships in a later Phase-1 change",
  });

  // Operating hours now have a real data model (Change 3, S2): at least one
  // effective-dated weekly interval must exist for the branch.
  const hours = await query<{ count: string }>(
    `select count(*)::text as count
     from public.branch_operating_hours
     where branch_id = $1
       and effective_from <= current_date
       and (effective_until is null or effective_until >= current_date)`,
    [branch.id],
  ).catch(() => ({ rows: [{ count: "0" }], rowCount: 1 }));
  items.push({
    requirement: "operating_hours",
    satisfied: Number(hours.rows[0]?.count ?? 0) > 0,
  });
  items.push({ requirement: "service_area", satisfied: Boolean(branch.service_area) });
  items.push({ requirement: "manager", satisfied: await hasAssignedManager(branch), note: "assign via membership_branches" });
  items.push({ requirement: "notification_configuration", satisfied: false, note: "notifications domain ships later" });

  return items;
}

async function hasAssignedManager(branch: BranchRecord): Promise<boolean> {
  try {
    const res = await query<{ exists: boolean }>(
      `select exists(
         select 1
         from public.membership_branches mb
         join public.memberships m on m.id = mb.membership_id
         where mb.branch_id = $1 and m.role = 'branch_manager' and m.status = 'active'
       ) as exists`,
      [branch.id],
    );
    return res.rows[0]?.exists === true;
  } catch {
    return false;
  }
}

export interface ActivationCheckResult {
  eligible: boolean;
  missing: string[];
  items: ReadinessItem[];
}

/** Evaluate the checklist without activating. */
export async function checkActivationReadiness(
  ctx: AuthContext,
  branchId: string,
): Promise<ActivationCheckResult> {
  requirePermission(ctx, "branches.view");
  requireOrganizationAccess(ctx, ctx.actor.organizationId);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }
  const branch = await getBranchById(branchId);
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");

  const items = await evaluateReadiness(branch);
  const missing = items.filter((i) => !i.satisfied).map((i) => i.requirement);
  const provisioningReady = branch.provisioning_status === "ready";
  return {
    eligible: provisioningReady && missing.length === 0,
    missing: provisioningReady ? missing : ["provisioning_ready", ...missing],
    items,
  };
}

/**
 * Activate the branch. Refuses when provisioning is not ready or mandatory
 * configuration is missing; audits `branch.activated` transactionally with
 * the status change.
 */
export async function activateBranch(
  ctx: AuthContext,
  branchId: string,
): Promise<BranchRecord> {
  requirePermission(ctx, "branches.activate");
  requireOrganizationAccess(ctx, ctx.actor.organizationId);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }

  const branch = await getBranchById(branchId);
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");

  if (branch.status === "active") return branch; // idempotent

  if (branch.provisioning_status !== "ready") {
    throw new AppError(
      ErrorCode.BRANCH_INACTIVE,
      "Branch provisioning must be ready before activation.",
    );
  }

  const { eligible, missing } = await checkActivationReadiness(ctx, branchId);
  if (!eligible) {
    throw new AppError(
      ErrorCode.BRANCH_INACTIVE,
      `Activation requirements not met: ${missing.join(", ")}`,
    );
  }

  const activated = await withTransaction(async (tx) => {
    const res = await tx.query<BranchRecord>(
      `update public.branches
          set status = 'active', activated_at = now(), updated_at = now()
        where id = $1 and status in ('ready', 'suspended')
        returning *`,
      [branchId],
    );
    if (res.rows.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, "Branch status changed concurrently.");
    }
    await writeAuditEvent(
      {
        action: "branch.activated", organizationId: branch.organization_id,
        branchId, actorUserId: ctx.actor.userId, resourceType: "branch",
        resourceId: branchId, requestId: ctx.requestId ?? null,
        metadata: {},
      },
      tx,
    );
    return res.rows[0];
  });

  metrics.increment("branch_activated");
  logger.info("branch_activated", {
    organizationId: branch.organization_id, branchId, requestId: ctx.requestId ?? null,
  });
  return activated;
}
