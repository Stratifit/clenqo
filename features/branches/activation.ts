/**
 * Branch activation — a distinct authorized operation (BRANCH_SYSTEM §19).
 * Gate: `branches.activate` permission + provisioning `ready` + the documented
 * readiness checklist (§45, §74–75). Items not yet configured are reported
 * as missing — activation cannot succeed until configuration exists.
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
  /** BD-A4: advisory items never block activation (notification delivery
   *  does not exist yet); displayed as "recommended, not required". */
  advisory?: boolean;
}

/**
 * Mandatory configuration per BRANCH_SYSTEM §74. Items owned by later
 * Phase-1 changes are evaluated against current data and will list as
 * missing until configured — the checklist must reflect real state.
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
    note: "activate at least one service (catalog domain, Change 2)",
  });

  // Pricing now has a real data model (Change 4A, P18): the per-branch seed
  // provisions a structure-only draft profile; activation requires an ACTIVE
  // profile with a published version (business configuration, P3).
  const pricing = await query<{ count: string }>(
    `select count(*)::text as count from public.pricing_profiles
     where branch_id = $1 and status = 'active'
       and exists (
         select 1 from public.pricing_versions v
         where v.pricing_profile_id = pricing_profiles.id and v.status = 'published'
       )`,
    [branch.id],
  ).catch(() => ({ rows: [{ count: "0" }], rowCount: 1 }));
  items.push({
    requirement: "pricing",
    satisfied: Number(pricing.rows[0]?.count ?? 0) > 0,
    note: "configure + publish pricing per branch (business value sheet pending, P3/P7b)",
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
  items.push({ requirement: "notification_configuration", satisfied: false, advisory: true, note: "notifications domain ships later — recommended, not required" });

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
  /** BD-A4: advisory items that are unmet — never blocking. */
  advisoryMissing: string[];
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
  const mandatoryMissing = items.filter((i) => !i.satisfied && !i.advisory).map((i) => i.requirement);
  const advisoryMissing = items.filter((i) => !i.satisfied && i.advisory).map((i) => i.requirement);
  return {
    // BD-A4: advisory items never block eligibility (provisioning-ready is
    // still a hard precondition enforced by activateBranch itself).
    eligible: mandatoryMissing.length === 0,
    missing: mandatoryMissing,
    advisoryMissing,
    items,
  };
}

/**
 * Activate the branch (BD-A4). Refuses when provisioning is not ready or
 * mandatory configuration is missing; audits `branch.activated` transactionally
 * with the status change. When the only unmet items are advisory, an explicit
 * override (actor + reason, audited `admin.activation_override`) is required.
 */
export async function activateBranch(
  ctx: AuthContext,
  branchId: string,
  opts?: { overrideReason?: string },
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
    // Mandatory (BD-A4): provisioning-ready is never overridable.
    throw new AppError(
      ErrorCode.BRANCH_INACTIVE,
      "Activation requirements not met: provisioning_ready",
    );
  }

  const { eligible, missing, advisoryMissing } = await checkActivationReadiness(ctx, branchId);

  if (!eligible) {
    // BD-A4: mandatory failures can never be overridden.
    throw new AppError(
      ErrorCode.BRANCH_INACTIVE,
      `Activation requirements not met: ${missing.join(", ")}`,
    );
  }

  // Advisory-only gaps require an explicit audited override.
  if (advisoryMissing.length > 0) {
    const reason = opts?.overrideReason?.trim();
    if (!reason) {
      throw new AppError(
        ErrorCode.BRANCH_INACTIVE,
        `Advisory requirements unmet (override required): ${advisoryMissing.join(", ")}`,
      );
    }
    await writeAuditEvent({
      action: "admin.activation_override",
      organizationId: branch.organization_id,
      branchId,
      actorUserId: ctx.actor.userId,
      resourceType: "branch",
      resourceId: branchId,
      requestId: ctx.requestId ?? null,
      metadata: { overridden_items: advisoryMissing, reason },
    });
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
