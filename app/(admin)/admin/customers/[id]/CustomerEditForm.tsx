"use client";

/**
 * Customer edit form (Change 9, design §12): thin client over
 * `updateCustomerAction` + the existing `updateCustomerSchema` fields.
 * `contact_conflict_flag` is NOT settable here (BD-B4). Without
 * `customers.edit` the form renders read-only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerAction } from "@/features/booking/actions";
import type { Result } from "@/lib/errors";

export interface EditableCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  preferred_language: string | null;
  notes: string | null;
  status: "active" | "inactive";
}

export default function CustomerEditForm({
  customer,
  canEdit,
}: {
  customer: EditableCustomer;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone ?? "",
    company: customer.company ?? "",
    preferred_language: customer.preferred_language ?? "",
    notes: customer.notes ?? "",
    status: customer.status,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res: Result<unknown> = await updateCustomerAction({
        customerId: customer.id,
        patch: {
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone || null,
          company: form.company || null,
          preferred_language: form.preferred_language || null,
          notes: form.notes || null,
          status: form.status,
        },
      });
      if (res.success) {
        setMessage({ kind: "ok", text: "Customer saved." });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Edit customer</h2>
      {!canEdit && (
        <p className="mt-1 text-xs text-gray-400">
          Read-only — customer editing requires the <code>customers.edit</code> permission.
        </p>
      )}
      <fieldset disabled={!canEdit} className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["first_name", "First name"],
            ["last_name", "Last name"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["company", "Company"],
            ["preferred_language", "Preferred language (e.g. de, en)"],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <label htmlFor={`edit-${field}`} className="block text-xs text-gray-600">
              {label}
            </label>
            <input
              id={`edit-${field}`}
              type={field === "email" ? "email" : "text"}
              value={form[field] ?? ""}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        ))}
        <div>
          <label htmlFor="edit-status" className="block text-xs text-gray-600">
            Status
          </label>
          <select
            id="edit-status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "inactive" })}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="edit-notes" className="block text-xs text-gray-600">
            Internal notes
          </label>
          <textarea
            id="edit-notes"
            rows={2}
            maxLength={4000}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
          />
        </div>
      </fieldset>
      {message && (
        <p role="status" className={`mt-2 text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="mt-3 rounded bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      )}
    </section>
  );
}
