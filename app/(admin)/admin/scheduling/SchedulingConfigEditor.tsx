"use client";

/**
 * Scheduling config editor (Change 10, design §6): thin client over
 * `updateSchedulingConfigAction`. Mutations require `branches.edit`
 * server-side (BD-E3b); the island disables inputs without it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSchedulingConfigAction } from "@/features/scheduling/actions";

type ConfigShape = {
  minimum_notice_minutes: number;
  maximum_advance_days: number;
  slot_grid_minutes: number;
  operational_buffer_minutes: number;
  travel_buffer_minutes: number;
  concurrency_cap: number;
  customer_horizon_days: number;
  hold_ttl_minutes: number;
};

const FIELDS: { key: keyof ConfigShape; label: string; id: string }[] = [
  { key: "minimum_notice_minutes", label: "Min notice (min)", id: "sc-notice" },
  { key: "maximum_advance_days", label: "Max advance (days)", id: "sc-advance" },
  { key: "slot_grid_minutes", label: "Slot grid (min)", id: "sc-grid" },
  { key: "operational_buffer_minutes", label: "Operational buffer (min)", id: "sc-opbuf" },
  { key: "travel_buffer_minutes", label: "Travel buffer (min)", id: "sc-trvbuf" },
  { key: "concurrency_cap", label: "Concurrency cap", id: "sc-conc" },
  { key: "customer_horizon_days", label: "Customer horizon (days)", id: "sc-horizon" },
  { key: "hold_ttl_minutes", label: "Hold TTL (min)", id: "sc-hold" },
];

export default function SchedulingConfigEditor({
  branchId,
  canEdit,
  config,
}: {
  branchId: string;
  canEdit: boolean;
  config: ConfigShape;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<Record<keyof ConfigShape, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(config[f.key])])) as Record<
      keyof ConfigShape,
      string
    >,
  );

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

  const input = "mt-0.5 w-28 rounded border border-gray-300 px-2 py-1.5 text-sm";
  const field = "block text-xs text-gray-600";
  const btn = "rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50";

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Configuration</h2>
      {message && (
        <p role="status" className={`mt-1 text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.id} className={field}>{f.label}</label>
            <input
              id={f.id}
              type="number"
              min={0}
              value={form[f.key]}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              className={input}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!canEdit || busy}
        onClick={() =>
          run(
            () =>
              updateSchedulingConfigAction({
                branch_id: branchId,
                minimum_notice_minutes: Number(form.minimum_notice_minutes),
                maximum_advance_days: Number(form.maximum_advance_days),
                slot_grid_minutes: Number(form.slot_grid_minutes),
                operational_buffer_minutes: Number(form.operational_buffer_minutes),
                travel_buffer_minutes: Number(form.travel_buffer_minutes),
                concurrency_cap: Number(form.concurrency_cap),
                customer_horizon_days: Number(form.customer_horizon_days),
                hold_ttl_minutes: Number(form.hold_ttl_minutes),
              }),
            "Configuration saved.",
          )
        }
        className={`${btn} mt-3`}
      >
        Save configuration
      </button>
    </section>
  );
}
