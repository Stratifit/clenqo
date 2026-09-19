/**
 * Admin context resolution (Change 8, design §5; C8-1; BD-A3).
 *
 * SECURITY: branch context is a UI/navigation preference — NEVER an
 * authorization claim. Every server request re-validates the selected
 * branch against `membership_branches`; any unauthorized/stale context
 * fails closed. Authorization always derives from server-resolved
 * membership + canonical permissions + RLS (design §13).
 *
 * V1 single-organization model: organization identity comes from the
 * existing `resolveActor` (oldest active membership — authoritative for
 * V1; multi-organization is a documented future capability).
 */
import "server-only";
import { hasBranchScope, requireOrganizationAccess, type AuthContext } from "@/lib/authorization/server";
import { AppError, ErrorCode } from "@/lib/errors";
export { ADMIN_CONTEXT_COOKIE, isValidContextEcho } from "./contextShared";

export type BranchContext = { type: "org" } | { type: "branch"; branchId: string };

export interface AdminContext {
  organizationId: string;
  role: AuthContext["actor"]["role"];
  branchContext: BranchContext;
}

const HQ_ROLES: ReadonlySet<AuthContext["actor"]["role"]> = new Set(["hq_admin", "hq_staff"]);

/**
 * Resolve the effective admin context for a request.
 *
 * - `null` / `"all"` → organization-wide context. HQ Admin/HQ Staff only
 *   (BD-A3): Branch Managers fail closed — they can never escape their
 *   `membership_branches` scope.
 * - `<branchId>` → branch context. Verified: the branch must exist within
 *   the actor's organization AND `hasBranchScope` must pass; otherwise
 *   FORBIDDEN.
 */
export async function resolveAdminContext(
  ctx: AuthContext,
  branchParam: string | null | undefined,
): Promise<AdminContext> {
  const { actor } = ctx;
  await requireOrganizationAccess(ctx, actor.organizationId);

  if (branchParam === null || branchParam === undefined || branchParam === "" || branchParam === "all") {
    if (!HQ_ROLES.has(actor.role)) {
      // BD-A3: Branch Managers cannot use All Branches.
      throw new AppError(ErrorCode.FORBIDDEN, "Organization-wide context requires HQ role.");
    }
    return { organizationId: actor.organizationId, role: actor.role, branchContext: { type: "org" } };
  }

  // Branch context: validate existence + scope on EVERY request.
  const { query } = await import("@/lib/db/server");
  const res = await query<{ organization_id: string }>(
    `select organization_id from public.branches where id = $1`,
    [branchParam],
  );
  const branch = res.rows[0];
  if (!branch || branch.organization_id !== actor.organizationId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch not accessible.");
  }
  if (!(await hasBranchScope(ctx, branchParam))) {
    throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
  }
  return {
    organizationId: actor.organizationId,
    role: actor.role,
    branchContext: { type: "branch", branchId: branchParam },
  };
}
