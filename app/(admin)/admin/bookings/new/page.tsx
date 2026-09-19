"use client";

/**
 * Staff booking creation wizard (Change 9, design §7; BD-B3): a thin client
 * composing the EXISTING engine in domain order — catalog service selection →
 * customer/property input → availability (server slots) → quote (server
 * price) → slot hold → confirmation via `staffCreateBookingAction` with
 * `source: "dashboard"`. The UI computes NO authoritative value: durations,
 * slots, prices and confirmation are server contracts; the wizard-instance
 * idempotency key is reused across retries of the same submission so
 * duplicates converge (TD-5). BD-W6 worker propagation stays inside the
 * confirm action.
 */
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { randomUUID } from "@/lib/cryptoClient";
import {
  getAvailabilityAction,
  createSlotHoldAction,
} from "@/features/scheduling/actions";
import { calculateQuoteAction } from "@/features/pricing/actions";
import { listEffectiveCatalogAction } from "@/features/services/actions";
import { staffCreateBookingAction } from "@/features/booking/actions";
import type { EffectiveCatalog } from "@/features/services/service";
import type { QuoteResult } from "@/features/pricing/quote";

type CatalogService = EffectiveCatalog["services"][number];

/** display_name rides CatalogRow's index signature as unknown; project it. */
function label(row: { name: string } & Record<string, unknown>): string {
  return typeof row.display_name === "string" && row.display_name ? row.display_name : row.name;
}

export default function NewBookingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branch") ?? "";

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1: service selection (server catalog)
  const [catalog, setCatalog] = useState<EffectiveCatalog | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const service = useMemo<CatalogService | null>(
    () => catalog?.services.find((s) => s.id === serviceId) ?? null,
    [catalog, serviceId],
  );

  // Step 2: customer + property
  const [customer, setCustomer] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [address, setAddress] = useState({ street: "", house_number: "", postal_code: "", city: "", country: "de" });

  // Step 3: availability (server slots only)
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [pickedSlot, setPickedSlot] = useState<{ start: string; end: string } | null>(null);

  // Step 4: quote (server price only)
  const [propertyDetails] = useState<Record<string, unknown>>({});
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  // Idempotency: one key per wizard instance, reused across retries (TD-5).
  const idempotencyKey = useRef<string>(randomUUID());
  const holdSession = useRef<string>(randomUUID());

  async function loadCatalog() {
    setBusy(true);
    setError(null);
    try {
      const res = await listEffectiveCatalogAction(branchId, { customerVisibleOnly: false });
      if (res.success) setCatalog(res.data);
      else setError(res.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadAvailability() {
    if (!serviceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getAvailabilityAction({ branchId, serviceId, variantId, days: 14 });
      if (res.success) {
        setSlots(res.data.filter((s) => s.available).map((s) => ({ start: s.start, end: s.end })));
        setStep(3);
      } else setError(res.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadQuote() {
    if (!pickedSlot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await calculateQuoteAction({
        branch_id: branchId,
        service_id: serviceId,
        variant_id: variantId,
        property_details: Object.keys(propertyDetails).length ? propertyDetails : undefined,
        scheduled_date: pickedSlot.start.slice(0, 10),
      });
      if (res.success) {
        setQuote(res.data);
        setStep(4);
      } else setError(res.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pickedSlot || !quote || !serviceId) return;
    setBusy(true);
    setError(null);
    try {
      // Hold the chosen slot through the existing contract.
      const holdRes = await createSlotHoldAction({
        branch_id: branchId,
        service_id: serviceId,
        variant_id: variantId,
        start_time: new Date(pickedSlot.start).toISOString(),
        end_time: new Date(pickedSlot.end).toISOString(),
        session_id: holdSession.current,
        idempotency_key: randomUUID(),
      });
      if (!holdRes.success) {
        setError(holdRes.error.message);
        return;
      }

      const res = await staffCreateBookingAction({
        branch_id: branchId,
        service_id: serviceId,
        variant_id: variantId,
        scheduled_start: new Date(holdRes.data.start_time).toISOString(),
        hold_id: holdRes.data.id,
        session_id: holdSession.current,
        customer: {
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email,
          phone: customer.phone || undefined,
        },
        service_address: {
          street: address.street,
          house_number: address.house_number,
          postal_code: address.postal_code,
          city: address.city,
          country: address.country,
        },
        property_details: Object.keys(propertyDetails).length ? propertyDetails : undefined,
        source: "dashboard",
        accepted_total_minor: Number(quote.total.replace(".", "")),
        idempotency_key: idempotencyKey.current,
      });
      if (res.success) {
        router.push(`/admin/bookings/${res.data.booking.id}`);
      } else {
        setError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!branchId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          No branch context selected. Pick a branch in the context selector first.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">New booking</h1>
      <p className="mt-1 text-sm text-gray-500">
        Branch <span className="font-mono text-xs">{branchId}</span> · availability, pricing, holds and confirmation are
        server-authoritative.
      </p>

      <ol className="mt-4 flex gap-2 text-xs" aria-label="Wizard progress">
        {["Service", "Customer & property", "Time", "Quote & confirm"].map((label, i) => (
          <li
            key={label}
            className={`rounded px-2 py-1 ${step === i + 1 ? "bg-[#07742F] text-white" : step > i + 1 ? "bg-green-100 text-green-900" : "bg-gray-100 text-gray-500"}`}
            aria-current={step === i + 1 ? "step" : undefined}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {step === 1 && (
        <section className="mt-6" aria-label="Service selection">
          {!catalog ? (
            <button
              type="button"
              onClick={loadCatalog}
              disabled={busy}
              className="rounded bg-[#07742F] px-4 py-2 text-sm text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {busy ? "Loading catalog…" : "Load branch catalog"}
            </button>
          ) : (
            <>
              <label htmlFor="svc" className="block text-sm text-gray-700">
                Service
              </label>
              <select
                id="svc"
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                onChange={(e) => {
                  setServiceId(e.target.value || null);
                  setVariantId(undefined);
                }}
                value={serviceId ?? ""}
              >
                <option value="">— select a service —</option>
                {catalog.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {label(s)}
                  </option>
                ))}
              </select>
              {service && service.variants.length > 0 && (
                <>
                  <label htmlFor="variant" className="mt-3 block text-sm text-gray-700">
                    Variant (optional)
                  </label>
                  <select
                    id="variant"
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    onChange={(e) => setVariantId(e.target.value || undefined)}
                    value={variantId ?? ""}
                  >
                    <option value="">— none —</option>
                    {service.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="button"
                disabled={!serviceId || busy}
                onClick={() => setStep(2)}
                className="mt-4 rounded bg-[#07742F] px-4 py-2 text-sm text-white hover:bg-[#055c24] disabled:opacity-50"
              >
                Next
              </button>
            </>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="mt-6 space-y-3" aria-label="Customer and property details">
          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Customer</legend>
            {(
              [
                ["first_name", "First name", true],
                ["last_name", "Last name", true],
                ["email", "Email", true],
                ["phone", "Phone", false],
              ] as const
            ).map(([field, label, required]) => (
              <div key={field} className="mt-2">
                <label htmlFor={`cust-${field}`} className="block text-xs text-gray-600">
                  {label}
                  {required ? " *" : ""}
                </label>
                <input
                  id={`cust-${field}`}
                  type={field === "email" ? "email" : "text"}
                  required={required}
                  value={customer[field]}
                  onChange={(e) => setCustomer({ ...customer, [field]: e.target.value })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </fieldset>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Service address</legend>
            {(
              [
                ["street", "Street", true],
                ["house_number", "House number", true],
                ["postal_code", "Postal code", true],
                ["city", "City", true],
              ] as const
            ).map(([field, label, required]) => (
              <div key={field} className="mt-2">
                <label htmlFor={`addr-${field}`} className="block text-xs text-gray-600">
                  {label}
                  {required ? " *" : ""}
                </label>
                <input
                  id={`addr-${field}`}
                  required={required}
                  value={address[field]}
                  onChange={(e) => setAddress({ ...address, [field]: e.target.value })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </fieldset>

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={loadAvailability}
              className="rounded bg-[#07742F] px-4 py-2 text-sm text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {busy ? "Checking availability…" : "Check availability"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-6" aria-label="Slot selection">
          {slots.length === 0 ? (
            <p className="text-sm text-gray-500">No available slots in the next 14 days.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Available slots">
              {slots.slice(0, 60).map((s) => (
                <li key={s.start}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={pickedSlot?.start === s.start}
                    onClick={() => setPickedSlot(s)}
                    className={`w-full rounded border px-3 py-1.5 text-left text-sm ${
                      pickedSlot?.start === s.start ? "border-[#07742F] bg-green-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {new Date(s.start).toLocaleString("en-GB")} → {new Date(s.end).toLocaleTimeString("en-GB")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-between">
            <button type="button" onClick={() => setStep(2)} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
            <button
              type="button"
              disabled={!pickedSlot || busy}
              onClick={loadQuote}
              className="rounded bg-[#07742F] px-4 py-2 text-sm text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {busy ? "Calculating quote…" : "Get quote"}
            </button>
          </div>
        </section>
      )}

      {step === 4 && quote && (
        <section className="mt-6" aria-label="Quote and confirmation">
          <dl className="rounded-lg border border-gray-200 p-4 text-sm">
            <div className="flex justify-between">
              <dt>Base</dt>
              <dd>{quote.base_amount}</dd>
            </div>
            {Number(quote.addon_amount) > 0 && (
              <div className="flex justify-between">
                <dt>Add-ons</dt>
                <dd>{quote.addon_amount}</dd>
              </div>
            )}
            {Number(quote.surcharge_amount) > 0 && (
              <div className="flex justify-between">
                <dt>Surcharges</dt>
                <dd>{quote.surcharge_amount}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd>{quote.tax_amount}</dd>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold">
              <dt>Total ({quote.currency})</dt>
              <dd>{quote.total}</dd>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              duration {quote.duration_minutes} min · pricing version {quote.pricing_version_number}
            </p>
          </dl>
          <div className="mt-4 flex justify-between">
            <button type="button" onClick={() => setStep(3)} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Confirm booking"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
