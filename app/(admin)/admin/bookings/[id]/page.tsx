import Link from "next/link";
import {
  getBookingAction,
  getCustomerAction,
  getBookingTimelineAction,
  staffCancelBookingAction,
  staffRescheduleBookingAction,
} from "@/features/booking/actions";
import { listJobsAction } from "@/features/worker/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../../pageContext";
import BookingActions from "./BookingActions";

export const dynamic = "force-dynamic";

/**
 * `/admin/bookings/[id]` — booking detail (Change 9, design §5). Renders
 * only what the Booking domain contract returns: status/number, schedule
 * (branch-local), customer (staff-authorized — BD-B2), address snapshot,
 * stored pricing snapshot (display-only), cancellation state, staff
 * timeline (read-only action), and a link to the related Worker job where
 * an existing contract supports the mapping (link-only; no job data
 * duplication — design §21). Cancel/reschedule delegate to the existing
 * staff actions; the UI never implements domain rules.
 */

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

function fmt(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: timezone });
}

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, branchId } = await requireBookingPageContext("bookings.view");
  const canCancel = hasPermission(ctx, "bookings.cancel");
  const canReschedule = hasPermission(ctx, "bookings.edit");

  const result = await getBookingAction(id);
  if (!result.success) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {result.error.message}
        </p>
        <Link href="/admin/bookings" className="mt-4 inline-block text-sm text-[#07742F] hover:underline">
          ← Back to bookings
        </Link>
      </main>
    );
  }
  const booking = result.data;

  // BD-B1 fail-closed: the booking must belong to the resolved branch.
  if (booking.branch_id !== branchId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          This booking belongs to a different branch. Switch the branch context to view it.
        </p>
        <Link href="/admin/bookings" className="mt-4 inline-block text-sm text-[#07742F] hover:underline">
          ← Back to bookings
        </Link>
      </main>
    );
  }

  const [customer, timeline, jobLink] = await Promise.allSettled([
    getCustomerAction(booking.customer_id),
    getBookingTimelineAction({ bookingId: booking.id }),
    // Worker-boundary link-only (design §21): jobs are found through the
    // existing Worker list contract scoped to this branch and filtered by
    // the booking's number — no second job system, no direct job-table
    // access from the booking surface.
    listJobsAction({ branch_id: booking.branch_id, search: booking.booking_number, limit: 10 }),
  ]);

  const customerOk = customer.status === "fulfilled" && customer.value.success ? customer.value.data : null;
  const timelineOk = timeline.status === "fulfilled" && timeline.value.success ? timeline.value.data : null;
  const timelineError = timeline.status === "fulfilled" && !timeline.value.success ? timeline.value.error.message : null;
  const jobOk =
    jobLink.status === "fulfilled" && jobLink.value.success
      ? (jobLink.value.data.find((j) => j.booking_id === booking.id) ?? null)
      : null;

  const cancellable = ["pending", "confirmed", "assigned"].includes(booking.status);
  const reschedulable = ["confirmed", "assigned"].includes(booking.status);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {booking.booking_number}
            <span className="ml-3 align-middle rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700">
              {booking.status}
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {booking.booking_type} · source {booking.source} ·{" "}
            {fmt(booking.scheduled_start, booking.timezone)} → {fmt(booking.scheduled_end, booking.timezone)} (
            {booking.timezone})
          </p>
        </div>
        <Link href="/admin/bookings" className="text-sm text-[#07742F] hover:underline">
          ← Bookings
        </Link>
      </header>

      <BookingActions
        bookingId={booking.id}
        status={booking.status}
        scheduledStart={booking.scheduled_start}
        branchId={booking.branch_id}
        canCancel={canCancel && cancellable}
        canReschedule={canReschedule && reschedulable}
        cancelAction={staffCancelBookingAction}
        rescheduleAction={staffRescheduleBookingAction}
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Customer</h2>
          {customerOk ? (
            <p className="mt-1 text-sm">
              {customerOk.first_name} {customerOk.last_name}
              {customerOk.company ? ` · ${customerOk.company}` : ""}
              <br />
              <span className="text-gray-500">{customerOk.email_normalized}</span>
              {customerOk.phone_e164 && <span className="text-gray-500"> · {customerOk.phone_e164}</span>}
              <br />
              <Link
                href={`/admin/customers/${customerOk.id}`}
                className="text-xs text-[#07742F] hover:underline"
              >
                Open customer →
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-400">Customer unavailable.</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Service address</h2>
          <p className="mt-1 text-sm text-gray-600">
            {typeof booking.service_address === "object" && booking.service_address !== null
              ? [
                  booking.service_address.street,
                  booking.service_address.house_number,
                ]
                  .filter(Boolean)
                  .join(" ")
              : null}
            {booking.service_address &&
            typeof booking.service_address === "object" &&
            "city" in booking.service_address
              ? `, ${booking.service_address.city}`
              : null}
            {booking.service_address &&
            typeof booking.service_address === "object" &&
            "postal_code" in booking.service_address
              ? ` ${booking.service_address.postal_code}`
              : null}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Pricing snapshot (authoritative)</h2>
          <dl className="mt-1 space-y-0.5 text-sm text-gray-600">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatMoney(booking.subtotal, booking.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Surcharges</dt>
              <dd>{formatMoney(booking.surcharge_total, booking.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd>{formatMoney(booking.tax_total, booking.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-0.5 font-semibold text-gray-800">
              <dt>Total</dt>
              <dd>{formatMoney(booking.total, booking.currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Cancellation state</h2>
          {booking.status === "cancelled" ? (
            <p className="mt-1 text-sm text-gray-600">
              Cancelled {booking.cancelled_at ? fmt(booking.cancelled_at, booking.timezone) : "—"}
              {booking.cancellation_reason ? ` · reason: ${booking.cancellation_reason}` : null}
              <br />
              Fee: {formatMoney(booking.cancellation_fee_minor ?? 0, booking.currency)} · Owed:{" "}
              {formatMoney(booking.amount_owed_minor ?? 0, booking.currency)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              Rescheduled {booking.reschedule_count}× · confirmed{" "}
              {booking.confirmed_at ? fmt(booking.confirmed_at, booking.timezone) : "—"} · completed{" "}
              {booking.completed_at ? fmt(booking.completed_at, booking.timezone) : "—"}
            </p>
          )}
        </div>
      </section>

      {jobOk && (
        <section className="mt-4 rounded-lg border border-gray-200 px-4 py-3 text-sm">
          <h2 className="text-sm font-semibold text-gray-700">Operational job</h2>
          <Link href={`/admin/jobs/${jobOk.id}`} className="text-[#07742F] hover:underline">
            {jobOk.job_number}
          </Link>
          <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{jobOk.status}</span>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Timeline</h2>
        {timelineOk === null && timelineError && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {timelineError}
          </p>
        )}
        {timelineOk !== null &&
          (timelineOk.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No events recorded.</p>
          ) : (
            <ol className="mt-2 space-y-1 text-sm text-gray-600">
              {timelineOk.map((e, i) => (
                <li key={`${e.event_type}-${i}`} className="flex gap-3">
                  <span className="w-56 shrink-0 text-gray-400">{e.created_at}</span>
                  <span className="font-mono text-xs">{e.event_type}</span>
                </li>
              ))}
            </ol>
          ))}
      </section>
    </main>
  );
}
