/**
 * Server-side authorization (SECURITY.md; PROJECT_STRUCTURE.md §32).
 *
 * Chain: authentication → role → permission → organization scope → branch
 * scope. The active branch context in the UI is never treated as
 * authorization (API_STANDARDS.md §9). Authorization failures are thrown as
 * AppError so the server action layer maps them to stable error codes.
 */
import "server-only";
import { query } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  ROLE_PERMISSIONS,
  type Permission,
} from "@/lib/permissions";

export type Role = "hq_admin" | "hq_staff" | "branch_manager" | "cleaner";

export interface Actor {
  userId: string;
  membershipId: string;
  organizationId: string;
  role: Role;
}

export interface AuthContext {
  actor: Actor;
  /** Permissions granted at organization scope by the actor's role. */
  orgPermissions: ReadonlySet<Permission>;
  /** Correlation ID propagated through the request (API_STANDARDS.md §42). */
  requestId?: string;
}

/** Resolve the current actor from a Supabase Auth user id. */
export async function resolveActor(userId: string): Promise<AuthContext> {
  const res = await query<{
    membership_id: string;
    organization_id: string;
    role: Role;
  }>(
    `select id as membership_id, organization_id, role
     from public.memberships
     where user_id = $1 and status = 'active'
     order by created_at asc
     limit 1`,
    [userId],
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "No active organization membership.",
    );
  }

  const grants = ROLE_PERMISSIONS[row.role];
  if (!grants) {
    throw new AppError(ErrorCode.FORBIDDEN, "Unknown role.");
  }

  return {
    actor: {
      userId,
      membershipId: row.membership_id,
      organizationId: row.organization_id,
      role: row.role,
    },
    orgPermissions: grants,
  };
}

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  return ctx.orgPermissions.has(permission);
}

/**
 * Assert the actor holds the permission. Throws FORBIDDEN otherwise.
 * Must be called server-side before any domain logic runs.
 */
export function requirePermission(
  ctx: AuthContext,
  permission: Permission,
): void {
  if (!hasPermission(ctx, permission)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Missing required permission: ${permission}.`,
    );
  }
}

/**
 * Assert the actor's organization matches the resource organization.
 * The organization context is resolved from the authenticated membership —
 * never from the request body.
 */
export function requireOrganizationAccess(
  ctx: AuthContext,
  organizationId: string,
): void {
  if (ctx.actor.organizationId !== organizationId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Cross-organization access denied.");
  }
}

/**
 * Branch-scope check for branch-scoped roles: HQ roles have organization-wide
 * scope; branch roles require an explicit membership_branches row.
 */
export async function hasBranchScope(
  ctx: AuthContext,
  branchId: string,
): Promise<boolean> {
  if (ctx.actor.role === "hq_admin" || ctx.actor.role === "hq_staff") {
    return true; // organization-wide scope
  }
  const res = await query<{ exists: boolean }>(
    `select exists(
       select 1 from public.membership_branches mb
       where mb.membership_id = $1 and mb.branch_id = $2
     ) as exists`,
    [ctx.actor.membershipId, branchId],
  );
  return res.rows[0]?.exists === true;
}
