"use client";

/**
 * Pricing profile create/update island (Change 10, design §5): thin client
 * over `createPricingProfileAction` / `updatePricingProfileAction`. The UI
 * implements no pricing logic — server schemas and services are authoritative.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPricingProfileAction,
  updatePricingProfileAction,
} from "@/features/pricing/actions";

export default function PricingProfileActions({
  branchId,
  canEdit,
}: {
  branchId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", description: "", currency: "", profileId: "", status: "" });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = (await fn()) as { success: boolean; error?: { message: string } };
      if (res.success) {
        setMessage({ kind: "ok", text: ok });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error?.message ?? "Request failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm";
  const field = "block text-xs text-gray-600";
  const btn = "rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50";

  return (
    <section className="mt-6 space-y-4 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Profile management</h2>
      {message && (
        <p role="status" className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold">Create profile</h3>
          <label htmlFor="pp-name" className={field}>Name *</label>
          <input id="pp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <label htmlFor="pp-desc" className={field}>Description</label>
          <input id="pp-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
          <label htmlFor="pp-cur" className={field}>Currency (ISO 4217) *</label>
          <input id="pp-cur" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className={input} />
          <button
            type="button"
            disabled={busy || !form.name || form.currency.length !== 3}
            onClick={() =>
              run(
                () =>
                  createPricingProfileAction({
                    branch_id: branchId,
                    name: form.name,
                    ...(form.description ? { description: form.description } : {}),
                    currency: form.currency,
                  }),
                "Profile created.",
              )
            }
            className={`${btn} mt-2`}
          >
            Create profile
          </button>
        </div>
        {canEdit && (
          <div>
            <h3 className="text-xs font-semibold">Update profile</h3>
            <label htmlFor="pp-id" className={field}>Profile ID</label>
            <input id="pp-id" value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })} className={input} />
            <label htmlFor="pp-status" className={field}>Status</label>
            <select id="pp-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={input}>
              <option value="">— unchanged —</option>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
            <button
              type="button"
              disabled={busy || !form.profileId || (!form.status && !form.name)}
              onClick={() =>
                run(
                  () =>
                    updatePricingProfileAction(
                      form.profileId,
                      {
                        ...(form.name ? { name: form.name } : {}),
                        ...(form.description ? { description: form.description } : {}),
                        ...(form.status ? { status: form.status } : {}),
                      },
                    ),
                  "Profile updated.",
                )
              }
              className={`${btn} mt-2`}
            >
              Update profile
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
