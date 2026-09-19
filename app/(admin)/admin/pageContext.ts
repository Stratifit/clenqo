import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, hasPermission, type AuthContext } from "@/lib/authorization/server";
import {
  resolveAdminContext,
  ADMIN_CONTEXT_COOKIE,
  isValidContextEcho,
  type AdminContext,
} from "@/features/admin/context";

/**
 * Change 9 shared server context for the bookings/customers pages (design
 * §3): the SAME resolution chain the Change 8 layout/dashboard uses —
 * authenticated user → actor → server-resolved admin context from the
 * `?branch=` + cookie echo (revalidated against `membership_branches` on
 * every request). Pages never derive scope client-side.
 *
 * BD-B1: booking pages additionally require a resolved BRANCH context —
 * under the org-wide "All Branches" context the caller is redirected back
 * with a selection prompt rather than issuing an unscoped query.
 */
export async function requireAdminPageContext(permission?: Parameters<typeof hasPermission>[1]): Promise<{
  ctx: AuthContext;
  adminCtx: AdminContext;
}> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  if (permission && !hasPermission(ctx, permission)) {
    redirect("/admin?denied=" + encodeURIComponent(permission));
  }
  const cookieStore = await cookies();
  const echo = cookieStore.get(ADMIN_CONTEXT_COOKIE)?.value;
  const branchParam = isValidContextEcho(echo) ? echo : null;
  const adminCtx = await resolveAdminContext(ctx, branchParam);
  return { ctx, adminCtx };
}

/** Resolve the context and additionally require a specific branch (BD-B1). */
export async function requireBookingPageContext(permission?: Parameters<typeof hasPermission>[1]): Promise<{
  ctx: AuthContext;
  adminCtx: AdminContext;
  branchId: string;
}> {
  const resolved = await requireAdminPageContext(permission);
  if (resolved.adminCtx.branchContext.type !== "branch") {
    // No All-Branches aggregation: bookings always render one branch.
    redirect("/admin?selectBranch=bookings");
  }
  return { ...resolved, branchId: resolved.adminCtx.branchContext.branchId };
}
