"use client";

/**
 * Operating-hours editor (Change 10, design §6): thin client over
 * `upsertOperatingHoursAction` — per-weekday template upsert with
 * effective-dating (history immutable; a new `effective_from` closes the
 * previous version). Mutations require `branches.edit` server-side (BD-E3b);
 * read-only rendering without it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertOperatingHoursAction } from "@/features/scheduling/actions";

const DAYS = [
  { weekday: 0, label: "Sunday" },
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
] as const;

type Interval = { start_time: string; end_time: string };
type HoursInterval = {
  weekday: number;
  interval_index: number;
  start_time: string;
  end_time: string;
};

export default function OperatingHoursEditor({
  branchId,
  canEdit,
  hours,
}: {
  branchId: string;
  canEdit: boolean;
  hours: HoursInterval[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [open, setOpen] = useState("09:00");
  const [close, setClose] = useState("17:00");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [secondInterval, setSecondInterval] = useState(false);
  const [open2, setOpen2] = useState("");
  const [close2, setClose2] = useState("");

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

  const currentDay = DAYS[weekday];
  const dayRows = hours
    .filter((h) => h.weekday === currentDay.weekday)
    .sort((a, b) => a.interval_index - b.interval_index);

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Operating hours (weekly template)</h2>
      {message && (
        <p role="status" className={`mt-1 text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-3">Weekday</th>
              <th className="py-1 pr-3">Intervals</th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => {
              const rows = hours.filter((h) => h.weekday === d.weekday);
              return (
                <tr key={d.weekday} className={d.weekday === weekday ? "bg-gray-50" : ""}>
                  <td className="py-1 pr-3 text-xs">{d.label}</td>
                  <td className="py-1 text-xs text-gray-600">
                    {rows.length === 0
                      ? "closed"
                      : rows.map((r) => `${r.start_time}–${r.end_time}`).join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-200 pt-3">
        <div>
          <label htmlFor="oh-day" className={field}>Weekday</label>
          <select
            id="oh-day"
            value={weekday}
            disabled={!canEdit}
            onChange={(e) => setWeekday(Number(e.target.value))}
            className={input}
          >
            {DAYS.map((d) => (
              <option key={d.weekday} value={d.weekday}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="oh-open" className={field}>Opens (HH:MM) *</label>
          <input id="oh-open" type="time" value={open} disabled={!canEdit} onChange={(e) => setOpen(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="oh-close" className={field}>Closes (HH:MM) *</label>
          <input id="oh-close" type="time" value={close} disabled={!canEdit} onChange={(e) => setClose(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="oh-second" className={field}>Second interval</label>
          <input
            id="oh-second"
            type="checkbox"
            checked={secondInterval}
            disabled={!canEdit}
            onChange={(e) => setSecondInterval(e.target.checked)}
            className="mt-1"
          />
        </div>
        {secondInterval && (
          <>
            <div>
              <label htmlFor="oh-open2" className={field}>Opens 2</label>
              <input id="oh-open2" type="time" value={open2} disabled={!canEdit} onChange={(e) => setOpen2(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="oh-close2" className={field}>Closes 2</label>
              <input id="oh-close2" type="time" value={close2} disabled={!canEdit} onChange={(e) => setClose2(e.target.value)} className={input} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="oh-eff" className={field}>Effective from (YYYY-MM-DD) *</label>
          <input id="oh-eff" type="date" value={effectiveFrom} disabled={!canEdit} onChange={(e) => setEffectiveFrom(e.target.value)} className={input} />
        </div>
        <button
          type="button"
          disabled={!canEdit || busy || !effectiveFrom || !open || !close || open >= close}
          onClick={() => {
            const intervals: Interval[] = [{ start_time: open, end_time: close }];
            if (secondInterval && open2 && close2 && open2 < close2) {
              intervals.push({ start_time: open2, end_time: close2 });
            }
            void run(
              () =>
                upsertOperatingHoursAction({
                  branch_id: branchId,
                  weekday,
                  intervals,
                  effective_from: effectiveFrom,
                }),
              "Operating hours saved (new effective version).",
            );
          }}
          className={btn}
        >
          Save {currentDay.label} hours
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Current intervals for {currentDay.label}:{" "}
        {dayRows.length === 0
          ? "closed"
          : dayRows.map((r) => `${r.start_time}–${r.end_time}`).join(", ")}
        . Upserting creates a new effective-dated version; history is immutable.
      </p>
    </section>
  );
}
