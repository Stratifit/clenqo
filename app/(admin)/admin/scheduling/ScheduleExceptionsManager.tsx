"use client";

/**
 * Schedule-exceptions manager (Change 10, design §6): typed manual V1
 * exceptions via `createScheduleExceptionAction` /
 * `deleteScheduleExceptionAction` (closed / reduced_hours / blackout /
 * holiday_override; reduced_hours requires replacement intervals). Mutations
 * require `branches.edit` server-side (BD-E3b).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createScheduleExceptionAction,
  deleteScheduleExceptionAction,
} from "@/features/scheduling/actions";

type ExceptionRow = {
  id: string;
  exception_type: string;
  start_date: string;
  end_date: string;
  intervals: { start: string; end: string }[] | null;
  reason: string | null;
};

const EXCEPTION_TYPES = ["closed", "reduced_hours", "blackout", "holiday_override"] as const;

export default function ScheduleExceptionsManager({
  branchId,
  canEdit,
  exceptions,
}: {
  branchId: string;
  canEdit: boolean;
  exceptions: ExceptionRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    exception_type: "closed" as (typeof EXCEPTION_TYPES)[number],
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    reason: "",
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
  const btnGhost = "rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

  const intervalsValid =
    form.exception_type !== "reduced_hours" || (form.start_time !== "" && form.end_time !== "");

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Schedule exceptions</h2>
      {message && (
        <p role="status" className={`mt-1 text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      {exceptions.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">No exceptions configured.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs text-gray-600">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-mono">{e.exception_type}</span> {e.start_date}
                {e.end_date !== e.start_date ? `–${e.end_date}` : ""}
                {e.intervals ? ` · ${e.intervals.map((i) => `${i.start}–${i.end}`).join(", ")}` : ""}
                {e.reason ? ` (${e.reason})` : ""}
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => deleteScheduleExceptionAction({ branch_id: branchId, exception_id: e.id }),
                      "Exception deleted.",
                    )
                  }
                  className={btnGhost}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-200 pt-3">
        <div>
          <label htmlFor="se-type" className={field}>Type</label>
          <select
            id="se-type"
            value={form.exception_type}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, exception_type: e.target.value as typeof form.exception_type })}
            className={input}
          >
            {EXCEPTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="se-start" className={field}>Start date *</label>
          <input id="se-start" type="date" value={form.start_date} disabled={!canEdit} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="se-end" className={field}>End date *</label>
          <input id="se-end" type="date" value={form.end_date} disabled={!canEdit} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={input} />
        </div>
        {form.exception_type === "reduced_hours" && (
          <>
            <div>
              <label htmlFor="se-opens" className={field}>Opens *</label>
              <input id="se-opens" type="time" value={form.start_time} disabled={!canEdit} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className={input} />
            </div>
            <div>
              <label htmlFor="se-closes" className={field}>Closes *</label>
              <input id="se-closes" type="time" value={form.end_time} disabled={!canEdit} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={input} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="se-reason" className={field}>Reason</label>
          <input id="se-reason" value={form.reason} disabled={!canEdit} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={input} />
        </div>
        <button
          type="button"
          disabled={!canEdit || busy || !form.start_date || !form.end_date || !intervalsValid}
          onClick={() =>
            run(
              () =>
                createScheduleExceptionAction({
                  branch_id: branchId,
                  exception_type: form.exception_type,
                  start_date: form.start_date,
                  end_date: form.end_date,
                  ...(form.exception_type === "reduced_hours"
                    ? { intervals: [{ start: form.start_time, end: form.end_time }] }
                    : {}),
                  ...(form.reason ? { reason: form.reason } : {}),
                }),
              "Exception created.",
            )
          }
          className={btn}
        >
          Add exception
        </button>
      </div>
    </section>
  );
}
