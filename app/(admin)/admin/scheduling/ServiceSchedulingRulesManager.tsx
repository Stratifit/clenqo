"use client";

/**
 * Service scheduling rules manager (Change 10, design §6): windows-only
 * upsert via `upsertServiceSchedulingRuleAction` (S18) — per-service booking
 * windows, never duration or price (S6 boundary). Mutations require
 * `branches.edit` server-side (BD-E3b). The read contract for listing rules
 * is not exposed as an admin action, so this island is upsert-only; existing
 * rules surface through the catalog service context.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertServiceSchedulingRuleAction } from "@/features/scheduling/actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export default function ServiceSchedulingRulesManager({
  branchId,
  canEdit,
}: {
  branchId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    service_id: "",
    weekday: "" as string,
    start_time: "",
    end_time: "",
    is_active: true,
  });

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

  const input = "mt-0.5 rounded border border-gray-300 px-2 py-1.5 text-sm";
  const field = "block text-xs text-gray-600";
  const btn = "rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50";

  const bothOrNeither = (form.start_time === "") === (form.end_time === "");

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Service scheduling rules (windows only)</h2>
      {message && (
        <p role="status" className={`mt-1 text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Per-service booking windows (S18). Omit the weekday for every open day; omit both times to
        inherit the branch operating window. Duration and pricing are never stored here (S6).
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="sr-service" className={field}>Service ID *</label>
          <input id="sr-service" value={form.service_id} disabled={!canEdit} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="sr-day" className={field}>Weekday (omit = all open days)</label>
          <select
            id="sr-day"
            value={form.weekday}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, weekday: e.target.value })}
            className={input}
          >
            <option value="">— every open day —</option>
            {DAYS.map((d, i) => (
              <option key={d} value={String(i)}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sr-start" className={field}>Window start (omit pair to inherit)</label>
          <input id="sr-start" type="time" value={form.start_time} disabled={!canEdit} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="sr-end" className={field}>Window end</label>
          <input id="sr-end" type="time" value={form.end_time} disabled={!canEdit} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="sr-active" className={field}>Active</label>
          <input
            id="sr-active"
            type="checkbox"
            checked={form.is_active}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            className="mt-1"
          />
        </div>
        <button
          type="button"
          disabled={!canEdit || busy || !form.service_id || !bothOrNeither}
          onClick={() =>
            run(
              () =>
                upsertServiceSchedulingRuleAction({
                  branch_id: branchId,
                  service_id: form.service_id,
                  ...(form.weekday !== "" ? { weekday: Number(form.weekday) } : {}),
                  ...(form.start_time && form.end_time
                    ? { start_time: form.start_time, end_time: form.end_time }
                    : {}),
                  is_active: form.is_active,
                }),
              "Rule saved.",
            )
          }
          className={btn}
        >
          Save rule
        </button>
      </div>
    </section>
  );
}
