"use client";

/**
 * Version creation island (Change 10, design §5): thin client over
 * `createPricingVersionAction`. Effective dates are server-validated
 * (YYYY-MM-DD; open end omitted = effective until superseded).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPricingVersionAction } from "@/features/pricing/actions";

export default function PricingVersionActions({
  profileId,
  branchId,
  canCreate,
  canEdit,
}: {
  profileId: string;
  branchId: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ effective_from: "", effective_until: "" });

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
      <h2 className="text-sm font-semibold text-gray-700">Version management</h2>
      {message && (
        <p role="status" className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      {canCreate && (
        <div className="max-w-md">
          <h3 className="text-xs font-semibold">Create version</h3>
          <label htmlFor="pv-from" className={field}>Effective from (YYYY-MM-DD) *</label>
          <input id="pv-from" type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} className={input} />
          <label htmlFor="pv-until" className={field}>Effective until (optional)</label>
          <input id="pv-until" type="date" value={form.effective_until} onChange={(e) => setForm({ ...form, effective_until: e.target.value })} className={input} />
          <button
            type="button"
            disabled={busy || !form.effective_from}
            onClick={() =>
              run(
                () =>
                  createPricingVersionAction({
                    profile_id: profileId,
                    branch_id: branchId,
                    effective_from: form.effective_from,
                    ...(form.effective_until ? { effective_until: form.effective_until } : {}),
                  }),
                "Version created as draft.",
              )
            }
            className={`${btn} mt-2`}
          >
            Create draft version
          </button>
        </div>
      )}
      {canEdit && (
        <p className="text-xs text-gray-500">
          Select a version to edit its draft rules. Published and archived versions are immutable.
        </p>
      )}
    </section>
  );
}
