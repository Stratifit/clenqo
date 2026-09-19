import Link from "next/link";
import { cookies } from "next/headers";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, hasPermission } from "@/lib/authorization/server";
import { resolveAdminContext, ADMIN_CONTEXT_COOKIE, isValidContextEcho } from "@/features/admin/context";
import { listBranchesAction } from "@/features/branches/actions";
import { listEmployeesAction, listJobsAction } from "@/features/worker/actions";
import { listBookingsAction } from "@/features/booking/actions";
import type { BranchRecord } from "@/features/branches/service";

export const dynamic = "force-dynamic";

/**
 * `/admin` operational dashboard (BD-A2, design §9): organization identity,
 * branch overview with lifecycle/provisioning state and failures, operational
 * counts from existing domain queries, quick actions, current user/role/
 * context. NO analytics metrics — those belong to future Reporting/Quality.
 * Individual query failures degrade to per-card error states.
 */
export default async function AdminDashboardPage() {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  const cookieStore = await cookies();
  const echo = cookieStore.get(ADMIN_CONTEXT_COOKIE)?.value;
  const branchParam = isValidContextEcho(echo) ? echo : null;
  const adminCtx = await resolveAdminContext(ctx, branchParam);
  const isOrgContext = adminCtx.branchContext.type === "org";
  const branchFilter = adminCtx.branchContext.type === "branch" ? adminCtx.branchContext.branchId : undefined;

  const branchesResult = await listBranchesAction();
  const branches: BranchRecord[] = branchesResult.success
    ? branchesResult.data.filter((b) => !branchFilter || b.id === branchFilter)
    : [];

  const [employees, jobs, bookings] = await Promise.allSettled([
    listEmployeesAction({}),
    listJobsAction(branchFilter ? { branch_id: branchFilter, limit: 200 } : { limit: 200 }),
    branchFilter ? listBookingsAction({ branchId: branchFilter, limit: 200 }) : Promise.resolve(null),
  ]);

  const employeeCount = employees.status === "fulfilled" && employees.value.success ? employees.value.data.length : null;
  const jobCount = jobs.status === "fulfilled" && jobs.value.success ? jobs.value.data.length : null;
  const bookingCount =
    bookings.status === "fulfilled" && bookings.value && bookings.value.success ? bookings.value.data.length : null;

  const canCreateBranch = hasPermission(ctx, "branches.create");
  const canInvite = hasPermission(ctx, "users.invite");
  const activeBranches = branches.filter((b) => b.status === "active").length;
  const failedProvisioning = branches.filter((b) => b.provisioning_status === "failed");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Control Center</h1>
        <p className="text-sm text-gray-500">
          {isOrgContext ? "All Branches" : "Branch context"} · {ctx.actor.role}
        </p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Branches" value={branches.length} detail={`${activeBranches} active`} />
        <StatCard label="Bookings" value={bookingCount} />
        <StatCard label="Jobs" value={jobCount} />
        <StatCard label="Employees" value={employeeCount} />
      </section>

      {failedProvisioning.length > 0 && (
        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{failedProvisioning.length}</strong> branch(es) with provisioning failures —{" "}
          {failedProvisioning.map((b) => b.name).join(", ")}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Quick actions</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {canCreateBranch && (
            <Link
              href="/admin/branches/new"
              className="rounded-lg bg-[#07742F] px-3 py-2 text-xs font-medium text-white hover:bg-[#055c24]"
            >
              New branch
            </Link>
          )}
          <Link
            href="/admin/branches"
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage branches
          </Link>
          {canInvite && (
            <span className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500">
              Invite users: available via API actions (UI in a later change)
            </span>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-700">Branches</h2>
        {branches.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No branches yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {branches.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link href={`/admin/branches/${b.id}`} className="font-medium text-[#07742F] hover:underline">
                  {b.name}
                </Link>
                <span className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">{b.status}</span>
                  <span className="rounded bg-gray-50 px-2 py-0.5 text-gray-600">
                    provisioning: {b.provisioning_status}
                  </span>
                  {b.provisioning_error && (
                    <span className="text-red-600" title={b.provisioning_error}>
                      error
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value === null ? "—" : value}</p>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </div>
  );
}
