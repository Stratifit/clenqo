import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getAuthenticatedUserIdOrNull,
} from "@/lib/session/server";
import {
  resolveActor,
  hasPermission,
  type AuthContext,
} from "@/lib/authorization/server";
import { resolveAdminContext, ADMIN_CONTEXT_COOKIE, isValidContextEcho } from "@/features/admin/context";
import { listBranchesAction } from "@/features/branches/actions";
import { signOutAction } from "@/features/admin/authActions";
import ContextSelector from "./contextSelector";
import type { BranchRecord } from "@/features/branches/service";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Protected admin shell (Change 8, design §8/§10). Server-side guard:
 * unauthenticated renders redirect to /login (middleware is UX only — this
 * layout guard is the second layer; server actions + RLS remain authoritative).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userId = await getAuthenticatedUserIdOrNull();
  if (!userId) {
    redirect("/login?next=/admin");
  }

  const ctx: AuthContext = await resolveActor(userId);
  const cookieStore = await cookies();
  const echo = cookieStore.get(ADMIN_CONTEXT_COOKIE)?.value;
  const branchParam = isValidContextEcho(echo) ? echo : null;
  const adminCtx = await resolveAdminContext(ctx, branchParam).catch(() => null);

  const branchesResult = await listBranchesAction();
  const branches: BranchRecord[] = branchesResult.success ? branchesResult.data : [];

  const canViewBranches = hasPermission(ctx, "branches.view");
  const canViewEmployees = hasPermission(ctx, "employees.view");
  const canViewJobs = hasPermission(ctx, "jobs.view");
  const canViewBookings = hasPermission(ctx, "bookings.view");
  const canViewCustomers = hasPermission(ctx, "customers.view");
  const canCreateBranch = hasPermission(ctx, "branches.create");
  const canInvite = hasPermission(ctx, "users.invite");

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3 text-sm">
          <Link href="/admin" className="font-semibold text-[#07742F]">
            CLENQO Control Center
          </Link>
          {canViewBranches && (
            <Link href="/admin/branches" className="text-gray-600 hover:text-[#07742F]">
              Branches
            </Link>
          )}
          {canViewEmployees && (
            <Link href="/admin/employees" className="text-gray-600 hover:text-[#07742F]">
              Employees
            </Link>
          )}
          {canViewJobs && (
            <Link href="/admin/jobs" className="text-gray-600 hover:text-[#07742F]">
              Jobs
            </Link>
          )}
          {canViewBookings && (
            <Link href="/admin/bookings" className="text-gray-600 hover:text-[#07742F]">
              Bookings
            </Link>
          )}
          {canViewCustomers && (
            <Link href="/admin/customers" className="text-gray-600 hover:text-[#07742F]">
              Customers
            </Link>
          )}
          <div className="ml-auto flex items-center gap-3">
            {adminCtx && branches.length > 0 && (
              <ContextSelector
                branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                canUseAllBranches={adminCtx.branchContext.type === "org" || adminCtx.role === "hq_admin" || adminCtx.role === "hq_staff"}
                current={adminCtx.branchContext.type === "branch" ? adminCtx.branchContext.branchId : "all"}
              />
            )}
            <span className="text-xs text-gray-500">
              {ctx.actor.role}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      {children}
      {/* Quick-action affordances are exposed server-side; clients never see
          elevated capabilities they lack (canCreateBranch/canInvite gate them). */}
      {(!canCreateBranch || !canInvite) && null}
    </div>
  );
}
