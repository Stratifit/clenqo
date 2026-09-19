import Link from "next/link";
import {
  getCustomerAction,
  listCustomerAddressesAction,
  listBookingsAction,
} from "@/features/booking/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireAdminPageContext } from "../../pageContext";
import CustomerEditForm from "./CustomerEditForm";
import AddressManager from "./AddressManager";

export const dynamic = "force-dynamic";

/**
 * `/admin/customers/[id]` — staff customer detail (Change 9, design §11;
 * BD-B2): staff-authorized contact data + addresses + booking history
 * restricted to branches within the actor's accessible scope (fail-closed).
 * Editing via `updateCustomerAction` behind `customers.edit`; the conflict
 * flag is display-only (BD-B4). The BD-C1 cleaner minimization is a cleaner-
 * surface rule and does not apply to this staff surface.
 */

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, adminCtx } = await requireAdminPageContext("customers.view");
  const canEdit = hasPermission(ctx, "customers.edit");
  const canViewBookings = hasPermission(ctx, "bookings.view");

  const result = await getCustomerAction(id);
  if (!result.success) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {result.error.message}
        </p>
        <Link href="/admin/customers" className="mt-4 inline-block text-sm text-[#07742F] hover:underline">
          ← Back to customers
        </Link>
      </main>
    );
  }
  const customer = result.data;

  // Fail-closed tenant check: the customer must belong to the actor's org.
  if (customer.organization_id !== adminCtx.organizationId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          This customer belongs to a different organization.
        </p>
        <Link href="/admin/customers" className="mt-4 inline-block text-sm text-[#07742F] hover:underline">
          ← Back to customers
        </Link>
      </main>
    );
  }

  const [addresses, history] = await Promise.allSettled([
    listCustomerAddressesAction(customer.id),
    canViewBookings ? listBranchScopedHistory(adminCtx) : Promise.resolve(null),
  ]);

  async function listBranchScopedHistory(a: typeof adminCtx) {
    // History = the customer's bookings across branches the actor can access.
    // listBookingsAction requires a branchId (BD-B1) — iterate the actor's
    // authorized branches from the context selector source.
    const { listBranchesAction } = await import("@/features/branches/actions");
    const branches = await listBranchesAction();
    if (!branches.success) return null;
    const scoped = branches.data.filter(
      (b) => a.branchContext.type === "org" || a.branchContext.branchId === b.id,
    );
    const results = await Promise.allSettled(
      scoped.map((b) => listBookingsAction({ branchId: b.id, search: customer.email_normalized, limit: 50 })),
    );
    return results.flatMap((r) => (r.status === "fulfilled" && r.value.success ? r.value.data : []));
  }

  const addressRows =
    addresses.status === "fulfilled" && addresses.value.success ? addresses.value.data : null;
  const historyRows = history.status === "fulfilled" ? history.value : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {customer.first_name} {customer.last_name}
            {customer.company ? <span className="ml-2 text-sm text-gray-500">{customer.company}</span> : null}
            <span className="ml-3 align-middle rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700">
              {customer.status}
            </span>
            {customer.contact_conflict_flag && (
              <span
                className="ml-2 align-middle rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900"
                title="Backend contact-matching indicator (display only)"
              >
                conflict
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {customer.email_normalized}
            {customer.phone_e164 ? ` · ${customer.phone_e164}` : ""}
            {customer.preferred_language ? ` · ${customer.preferred_language}` : ""}
          </p>
        </div>
        <Link href="/admin/customers" className="text-sm text-[#07742F] hover:underline">
          ← Customers
        </Link>
      </header>

      <CustomerEditForm
        customer={{
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email_normalized,
          phone: customer.phone_e164,
          company: customer.company,
          preferred_language: customer.preferred_language,
          notes: customer.notes,
          status: customer.status === "inactive" ? "inactive" : "active",
        }}
        canEdit={canEdit}
      />

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Addresses</h2>
        <AddressManager
          customerId={customer.id}
          initialAddresses={addressRows ?? []}
          canEdit={canEdit}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Booking history (authorized branches)</h2>
        {historyRows === null ? (
          <p className="mt-2 text-sm text-gray-400">Booking history unavailable.</p>
        ) : historyRows.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No bookings in your authorized branches.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {historyRows.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link href={`/admin/bookings/${b.id}`} className="font-medium text-[#07742F] hover:underline">
                  {b.booking_number}
                </Link>
                <span className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">{b.status}</span>
                  <span className="text-gray-500">
                    {new Date(b.scheduled_start).toLocaleString("en-GB", { timeZone: b.timezone })}
                  </span>
                  <span>{formatMoney(b.total, b.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
