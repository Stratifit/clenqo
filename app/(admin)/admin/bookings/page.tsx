import Link from "next/link";
import { listBookingsAction } from "@/features/booking/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../pageContext";

export const dynamic = "force-dynamic";

/**
 * `/admin/bookings` — branch-scoped staff booking list (Change 9, design §4;
 * BD-B1). Consumes `listBookingsAction` exclusively (server-enforced org
 * access + `hasBranchScope` + result cap); status/search filters ride the
 * existing server capabilities via URL params. No cross-branch aggregation:
 * the page requires a resolved branch context (see pageContext.ts).
 */

const STATUS_FILTERS = [
  "all",
  "pending",
  "confirmed",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { ctx, adminCtx, branchId } = await requireBookingPageContext("bookings.view");
  const canCreate = hasPermission(ctx, "bookings.create");

  const status = params.status && STATUS_FILTERS.includes(params.status as (typeof STATUS_FILTERS)[number]) ? params.status : "all";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 100;

  const result = await listBookingsAction({
    branchId,
    ...(status !== "all" ? { status } : {}),
    ...(search ? { search } : {}),
    // Cap: fetch up to the page window; server clamps to its own 500 limit.
    limit: Math.min(page * pageSize, 500),
  });

  const rows = result.success ? result.data : [];
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const hasMore = rows.length > page * pageSize;
  const branchName = adminCtx.branchContext.type === "branch" ? adminCtx.branchContext.branchId : null;

  const qs = (over: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status: status !== "all" ? status : undefined, q: search || undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return sp.toString();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bookings</h1>
          <p className="text-sm text-gray-500">
            Branch context: <span className="font-mono text-xs">{branchName}</span>
          </p>
        </div>
        {canCreate && (
          <Link
            href={`/admin/bookings/new?branch=${branchId}`}
            className="rounded-lg bg-[#07742F] px-3 py-2 text-xs font-medium text-white hover:bg-[#055c24]"
          >
            New booking
          </Link>
        )}
      </header>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2" aria-label="Booking filters">
        <label htmlFor="status" className="text-xs text-gray-600">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={status}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Booking number or customer"
          className="min-w-48 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          Apply
        </button>
      </form>

      {result.success ? (
        visible.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            {rows.length === 0 ? "No bookings match the current filters for this branch." : "No further bookings."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Booking
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Scheduled
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Total
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="font-medium text-[#07742F] hover:underline"
                      >
                        {b.booking_number}
                      </Link>
                      <span className="ml-2 text-xs text-gray-400">{b.booking_type}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{b.status}</span>
                      {(b.amount_owed_minor ?? 0) > 0 && (
                        <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                          owed {formatMoney(b.amount_owed_minor ?? 0, b.currency)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {new Date(b.scheduled_start).toLocaleString("en-GB", { timeZone: b.timezone })}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatMoney(b.total, b.currency)}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{b.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <p className="mt-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {result.error.message}
        </p>
      )}

      {(page > 1 || hasMore) && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={`/admin/bookings?${qs({ page: String(page - 1) })}`} className="text-[#07742F] hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={`/admin/bookings?${qs({ page: String(page + 1) })}`} className="text-[#07742F] hover:underline">
              Next →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
