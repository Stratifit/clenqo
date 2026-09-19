import Link from "next/link";
import { listCustomersAction } from "@/features/booking/actions";
import { requireAdminPageContext } from "../pageContext";

export const dynamic = "force-dynamic";

/**
 * `/admin/customers` — staff customer list (Change 9, design §10; BD-B2/B4).
 * Org-scoped per the existing customer model; server-side search via
 * `listCustomersAction`. The contact-conflict flag renders as a passive
 * indicator only — NO dedup workflow exists in this surface (BD-B4).
 */

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; conflicts?: string }>;
}) {
  const params = await searchParams;
  const { adminCtx } = await requireAdminPageContext("customers.view");
  const search = params.q?.trim() ?? "";
  const conflictsOnly = params.conflicts === "1";

  const result = await listCustomersAction({
    organizationId: adminCtx.organizationId,
    ...(search ? { search } : {}),
    ...(conflictsOnly ? { conflictsOnly: true } : {}),
  });

  const rows = result.success ? result.data : [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-gray-500">
          Organization scope ({adminCtx.role}) · conflict flags are informational only
        </p>
      </header>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2" aria-label="Customer filters">
        <label htmlFor="q" className="text-xs text-gray-600">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Name, email or phone"
          className="min-w-48 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" name="conflicts" value="1" defaultChecked={conflictsOnly} />
          Conflicts only
        </label>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          Apply
        </button>
      </form>

      {result.success ? (
        rows.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            No customers match the current filters.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Phone
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Flag
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-[#07742F] hover:underline">
                        {c.first_name} {c.last_name}
                      </Link>
                      {c.company && <span className="ml-2 text-xs text-gray-400">{c.company}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{c.email_normalized}</td>
                    <td className="px-4 py-2 text-gray-600">{c.phone_e164 ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{c.status}</span>
                    </td>
                    <td className="px-4 py-2">
                      {c.contact_conflict_flag ? (
                        <span
                          className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                          title="Backend contact-matching indicator (display only)"
                        >
                          conflict
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
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
    </main>
  );
}
