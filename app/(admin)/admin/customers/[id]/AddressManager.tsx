"use client";

/**
 * Address manager (Change 9, design §13): list/create/delete via the
 * existing customer-address actions and `addressInputSchema`. Mutations
 * require `customers.edit` (server-enforced; the form is disabled without).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCustomerAddressAction,
  deleteCustomerAddressAction,
} from "@/features/booking/actions";
import type { CustomerAddress } from "@/features/booking/addresses";
import type { Result } from "@/lib/errors";

const EMPTY = { label: "", street: "", house_number: "", postal_code: "", city: "", country: "de", access_instructions: "" };

export default function AddressManager({
  customerId,
  initialAddresses,
  canEdit,
}: {
  customerId: string;
  initialAddresses: CustomerAddress[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [addresses, setAddresses] = useState<CustomerAddress[]>(initialAddresses);
  const [form, setForm] = useState({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onCreate() {
    setBusy(true);
    setMessage(null);
    try {
      const res: Result<CustomerAddress> = await createCustomerAddressAction({
        customerId,
        address: {
          street: form.street,
          house_number: form.house_number,
          postal_code: form.postal_code,
          city: form.city,
          country: form.country,
          ...(form.label ? { label: form.label } : {}),
          ...(form.access_instructions ? { access_instructions: form.access_instructions } : {}),
        },
      });
      if (res.success) {
        setAddresses((a) => [...a, res.data]);
        setForm({ ...EMPTY });
        setShowForm(false);
        setMessage({ kind: "ok", text: "Address added." });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(addressId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await deleteCustomerAddressAction(addressId);
      if (res.success) {
        setAddresses((a) => a.filter((x) => x.id !== addressId));
        setMessage({ kind: "ok", text: "Address removed." });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {addresses.length === 0 && <p className="text-sm text-gray-500">No addresses on file.</p>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {addresses.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>
              {a.label && <span className="mr-2 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{a.label}</span>}
              {a.street} {a.house_number}, {a.postal_code} {a.city} ({a.country})
              {a.access_instructions && (
                <span className="block text-xs text-gray-400">access: {a.access_instructions}</span>
              )}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => onDelete(a.id)}
                disabled={busy}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
        >
          Add address
        </button>
      )}
      {canEdit && showForm && (
        <fieldset className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-3" disabled={busy}>
          {(
            [
              ["label", "Label", false],
              ["street", "Street *", true],
              ["house_number", "House number *", true],
              ["postal_code", "Postal code *", true],
              ["city", "City *", true],
              ["country", "Country (2-letter) *", true],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`addr-form-${field}`} className="block text-xs text-gray-600">
                {label}
              </label>
              <input
                id={`addr-form-${field}`}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
          <div className="sm:col-span-3">
            <label htmlFor="addr-form-access" className="block text-xs text-gray-600">
              Access instructions
            </label>
            <input
              id="addr-form-access"
              value={form.access_instructions}
              onChange={(e) => setForm({ ...form, access_instructions: e.target.value })}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="sm:col-span-3 flex gap-2">
            <button
              type="button"
              onClick={onCreate}
              disabled={busy}
              className="rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save address"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {message && (
        <p role="status" className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
