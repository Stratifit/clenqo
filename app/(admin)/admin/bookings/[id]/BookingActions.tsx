"use client";

/**
 * Booking actions client island (Change 9, design §8/§9): cancel + reschedule
 * forms invoking the existing staff actions. The UI implements NO domain
 * rules — the server returns outcomes/errors and the page renders them.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getAvailabilityAction } from "@/features/scheduling/actions";
import type { SlotHold } from "@/features/scheduling/holds";
import type { Result } from "@/lib/errors";

type CancelOutcome = { booking: { status: string }; feeMinor: number; amountOwedMinor: number; tierPercent: number };
type RescheduleOutcome = { booking: { scheduled_start: string }; newTotal: number; priceDeltaMinor: number; requiresAcceptance: boolean };

export default function BookingActions({
  bookingId,
  status,
  scheduledStart,
  branchId,
  canCancel,
  canReschedule,
  cancelAction,
  rescheduleAction,
}: {
  bookingId: string;
  status: string;
  scheduledStart: string;
  branchId: string;
  canCancel: boolean;
  canReschedule: boolean;
  cancelAction: (input: { booking_id: string; reason?: string }) => Promise<Result<CancelOutcome>>;
  rescheduleAction: (input: {
    booking_id: string;
    target_start: string;
    target_end: string;
    hold_id?: string;
    session_id?: string;
    reason?: string;
    accepted_target_total_minor?: number;
    idempotency_key: string;
  }) => Promise<Result<RescheduleOutcome>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Cancel dialog state
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Reschedule state
  const [showReschedule, setShowReschedule] = useState(false);
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<{ start: string; end: string } | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  async function onCancel() {
    setCancelling(true);
    setMessage(null);
    try {
      const res = await cancelAction({ booking_id: bookingId, reason: cancelReason.trim() || undefined });
      if (res.success) {
        setMessage({
          kind: "ok",
          text: `Booking cancelled. Fee: ${(res.data.feeMinor / 100).toFixed(2)} · Owed: ${(res.data.amountOwedMinor / 100).toFixed(2)} (tier ${res.data.tierPercent}%)`,
        });
        setShowCancel(false);
        startTransition(() => router.refresh());
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setCancelling(false);
    }
  }

  async function loadSlots() {
    if (!serviceId) return;
    setLoadingSlots(true);
    setMessage(null);
    try {
      const res = await getAvailabilityAction({
        branchId,
        serviceId,
        days: 14,
      });
      if (res.success) {
        setSlots(res.data.filter((s) => s.available).map((s) => ({ start: s.start, end: s.end })));
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setLoadingSlots(false);
    }
  }

  async function onReschedule() {
    if (!pickedSlot) return;
    setRescheduling(true);
    setMessage(null);
    try {
      const sessionId = `resched-${crypto.randomUUID()}`;
      // Hold the target slot through the existing contract (server-authoritative).
      const hold = (await import("@/features/scheduling/actions")).createSlotHoldAction;
      const holdRes = (await hold({
        branch_id: branchId,
        service_id: serviceId,
        start_time: pickedSlot.start,
        end_time: pickedSlot.end,
        session_id: sessionId,
        idempotency_key: crypto.randomUUID(),
      })) as Result<SlotHold>;
      if (!holdRes.success) {
        setMessage({ kind: "error", text: holdRes.error.message });
        return;
      }
      const res = await rescheduleAction({
        booking_id: bookingId,
        target_start: pickedSlot.start,
        target_end: pickedSlot.end,
        hold_id: holdRes.data.id,
        session_id: sessionId,
        idempotency_key: crypto.randomUUID(),
      });
      if (res.success) {
        setMessage({
          kind: "ok",
          text:
            res.data.requiresAcceptance
              ? `Reschedule committed. New total ${(res.data.newTotal / 100).toFixed(2)} (increase — acceptance recorded per BD-3).`
              : `Rescheduled. New total ${(res.data.newTotal / 100).toFixed(2)} (delta ${(res.data.priceDeltaMinor / 100).toFixed(2)}).`,
        });
        setShowReschedule(false);
        startTransition(() => router.refresh());
      } else {
        setMessage({ kind: "error", text: res.error.message });
      }
    } finally {
      setRescheduling(false);
    }
  }

  if (!canCancel && !canReschedule) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {canCancel && (
        <button
          type="button"
          onClick={() => setShowCancel(true)}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Cancel booking
        </button>
      )}
      {canReschedule && (
        <button
          type="button"
          onClick={() => setShowReschedule(true)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Reschedule
        </button>
      )}
      {message && (
        <p
          role="status"
          className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}
        >
          {message.text}
        </p>
      )}

      {showCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel booking"
          onKeyDown={(e) => e.key === "Escape" && setShowCancel(false)}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h3 className="text-base font-semibold">Cancel this booking?</h3>
            <p className="mt-1 text-xs text-gray-500">
              The applicable fee tier is computed server-side from the stored policy snapshot. Current status: {status}.
            </p>
            <label htmlFor="cancel-reason" className="mt-3 block text-xs text-gray-600">
              Reason (optional)
            </label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={1000}
              rows={3}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={cancelling}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReschedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reschedule booking"
          onKeyDown={(e) => e.key === "Escape" && setShowReschedule(false)}
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
            <h3 className="text-base font-semibold">Reschedule booking</h3>
            <p className="mt-1 text-xs text-gray-500">
              BD-3 rules are enforced server-side: confirmed/assigned only, 24-hour minimum notice, free, new pricing
              snapshot. Current start: {new Date(scheduledStart).toLocaleString("en-GB")}.
            </p>
            <label htmlFor="resched-svc" className="mt-3 block text-xs text-gray-600">
              Service
            </label>
            <input
              id="resched-svc"
              type="text"
              placeholder="Service UUID (from the booking's service items)"
              onChange={(e) => setServiceId(e.target.value.trim() || null)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={loadSlots}
              disabled={!serviceId || loadingSlots}
              className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingSlots ? "Loading slots…" : "Load availability"}
            </button>
            {slots.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm" role="listbox" aria-label="Available slots">
                {slots.slice(0, 50).map((s) => (
                  <li key={s.start}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={pickedSlot?.start === s.start}
                      onClick={() => setPickedSlot(s)}
                      className={`w-full rounded border px-2 py-1.5 text-left ${
                        pickedSlot?.start === s.start ? "border-[#07742F] bg-green-50" : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {new Date(s.start).toLocaleString("en-GB")} → {new Date(s.end).toLocaleTimeString("en-GB")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReschedule(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onReschedule}
                disabled={!pickedSlot || rescheduling}
                className="rounded bg-[#07742F] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
              >
                {rescheduling ? "Rescheduling…" : "Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && <span className="text-xs text-gray-400">Refreshing…</span>}
    </div>
  );
}
