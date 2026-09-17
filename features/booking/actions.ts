"use server";

/**
 * Server Actions for the Booking domain (Change 5; API_STANDARDS §4:
 * authenticate → authorize → validate → domain service → typed result).
 * No business logic lives here — everything delegates to features/booking/*.
 *
 * Three surfaces:
 *   1. Internal staff actions — authenticated; permissions enforced inside
 *      the domain (bookings.view/create/edit/cancel/override, customers.*,
 *      branches.edit for configuration).
 *   2. Customer Booking Hub actions — magic-link session (TD-3); NEVER
 *      staff permissions.
 *   3. Public unauthenticated flows — quote preview, hold creation, and
 *      checkout confirmation (rate-limited, Zod-validated, enumeration-safe).
 */
import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
import { query } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { confirmBooking, cancelBooking, overrideCancellationFee, rescheduleBooking, loadBookingForActor } from "./service";
import { issueMagicLink, verifyMagicLink, requireCustomerSession, type CustomerSession } from "./magicLink";
import {
  createCancellationPolicy,
  publishCancellationPolicy,
  archiveCancellationPolicy,
  listCancellationPolicies,
  listServiceAreas,
  setServiceAreas,
} from "./configuration";
import { getCustomer, listCustomers, updateCustomer } from "./customers";
import { listAddresses, createAddress, deleteAddress, type CustomerAddress } from "./addresses";
import type {
  CancellationPolicyRow,
} from "./configuration";
import type { BookingRow, CancellationOutcome, RescheduleOutcome, ConfirmationResult } from "./service";
import type { CustomerRecord } from "./customers";

async function currentContext(): Promise<AuthContext> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  ctx.requestId = randomUUID();
  return ctx;
}

function run<T>(fn: (ctx: AuthContext) => Promise<T>): Promise<Result<T>> {
  return (async () => {
    try {
      const ctx = await currentContext();
      return ok(await fn(ctx), ctx.requestId);
    } catch (err) {
      const appErr = toAppError(err);
      return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
    }
  })();
}

// ---------------------------------------------------------------------------
// Internal — booking operations
// ---------------------------------------------------------------------------

export async function getBookingAction(bookingId: string): Promise<Result<BookingRow>> {
  return run((ctx) => loadBookingForActor(ctx, bookingId));
}

export async function listBookingsAction(input: {
  branchId: string;
  status?: string;
  search?: string;
  limit?: number;
}): Promise<Result<BookingRow[]>> {
  return run(async (ctx) => {
    const rows = await listBookingsForActor(ctx, input);
    return rows;
  });
}

export async function staffCancelBookingAction(input: {
  booking_id: string;
  reason?: string;
}): Promise<Result<CancellationOutcome>> {
  return run(async (ctx) => {
    const outcome = await cancelBooking(ctx, input);
    return outcome;
  });
}

export async function staffRescheduleBookingAction(input: unknown): Promise<Result<RescheduleOutcome>> {
  return run((ctx) => rescheduleBooking(ctx, input));
}

export async function staffCreateBookingAction(input: unknown): Promise<Result<ConfirmationResult>> {
  return run((ctx) => confirmBooking(ctx, input));
}

export async function overrideCancellationFeeAction(input: unknown): Promise<Result<BookingRow>> {
  return run((ctx) => overrideCancellationFee(ctx, input));
}

// ---------------------------------------------------------------------------
// Internal — configuration (branches.view / branches.edit)
// ---------------------------------------------------------------------------

export async function listCancellationPoliciesAction(branchId: string): Promise<Result<CancellationPolicyRow[]>> {
  return run((ctx) => listCancellationPolicies(ctx, branchId));
}

export async function createCancellationPolicyAction(input: unknown): Promise<Result<CancellationPolicyRow>> {
  return run((ctx) => createCancellationPolicy(ctx, input));
}

export async function publishCancellationPolicyAction(input: {
  policy_id: string;
  effective_from?: string;
  effective_until?: string;
}): Promise<Result<CancellationPolicyRow>> {
  return run((ctx) =>
    publishCancellationPolicy(ctx, input.policy_id, {
      effective_from: input.effective_from,
      effective_until: input.effective_until,
    }),
  );
}

export async function archiveCancellationPolicyAction(policyId: string): Promise<Result<CancellationPolicyRow>> {
  return run((ctx) => archiveCancellationPolicy(ctx, policyId));
}

export async function listServiceAreasAction(branchId: string): Promise<Result<string[]>> {
  return run((ctx) => listServiceAreas(ctx, branchId));
}

export async function setServiceAreasAction(input: unknown): Promise<Result<string[]>> {
  return run((ctx) => setServiceAreas(ctx, input));
}

// ---------------------------------------------------------------------------
// Internal — customers
// ---------------------------------------------------------------------------

export async function getCustomerAction(customerId: string): Promise<Result<CustomerRecord>> {
  return run((ctx) => getCustomer(ctx, customerId));
}

export async function listCustomersAction(input: {
  organizationId: string;
  search?: string;
  conflictsOnly?: boolean;
}): Promise<Result<CustomerRecord[]>> {
  return run((ctx) => listCustomers(ctx, input.organizationId, input));
}

export async function updateCustomerAction(input: {
  customerId: string;
  patch: unknown;
}): Promise<Result<CustomerRecord>> {
  return run((ctx) => updateCustomer(ctx, input.customerId, input.patch as Record<string, never>));
}

export async function listCustomerAddressesAction(customerId: string): Promise<Result<CustomerAddress[]>> {
  return run((ctx) => listAddresses(ctx, customerId));
}

export async function createCustomerAddressAction(input: {
  customerId: string;
  address: unknown;
}): Promise<Result<CustomerAddress>> {
  return run((ctx) => createAddress(ctx, input.customerId, input.address));
}

export async function deleteCustomerAddressAction(addressId: string): Promise<Result<null>> {
  return run(async (ctx) => {
    await deleteAddress(ctx, addressId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Public — unauthenticated checkout flow (rate-limited, enumeration-safe)
// ---------------------------------------------------------------------------

/**
 * Checkout confirmation. The customer has browsed availability, accepted a
 * price, and holds a slot; this action validates, gates, and confirms in one
 * transaction. No authentication: authorization comes from the hold/session
 * binding, the service-area gate, and server-side recalculated pricing
 * (TD-2) — client data is never trusted.
 */
export async function confirmPublicBookingAction(input: unknown): Promise<Result<ConfirmationResult>> {
  try {
    const result = await confirmBooking(null, input);
    return ok(result, randomUUID());
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
  }
}

// ---------------------------------------------------------------------------
// Booking Hub — magic-link session surface (TD-3; task 9.2)
// ---------------------------------------------------------------------------

export async function requestMagicLinkAction(input: {
  booking_number: string;
  email: string;
}): Promise<Result<{ sent: boolean }>> {
  try {
    await issueMagicLink(input);
    // Enumeration-safe: the response never reveals whether details matched.
    return ok({ sent: true });
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

export async function verifyMagicLinkAction(input: {
  token: string;
}): Promise<Result<{ session: CustomerSession }>> {
  try {
    const session = await verifyMagicLink({ token: input.token });
    return ok({ session });
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

/** Hub: booking details (session-bound; scope enforced by construction). */
export async function hubGetBookingAction(input: {
  sessionId: string;
}): Promise<Result<BookingRow>> {
  try {
    const session = await requireCustomerSession(input.sessionId);
    const booking = await loadBookingInternal(session.bookingId);
    if (booking.customer_id !== session.customerId) {
      throw new AppError(ErrorCode.FORBIDDEN, "Access denied.");
    }
    return ok(booking);
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

/** Hub: customer-visible timeline (customer-safe events only). */
export async function hubGetTimelineAction(input: { sessionId: string }): Promise<Result<
  { event_type: string; created_at: string; metadata: Record<string, unknown> }[]
>> {
  try {
    const session = await requireCustomerSession(input.sessionId);
    const booking = await loadBookingInternal(session.bookingId);
    if (booking.customer_id !== session.customerId) {
      throw new AppError(ErrorCode.FORBIDDEN, "Access denied.");
    }
    const events = await query<{ event_type: string; created_at: string; metadata: Record<string, unknown> }>(
      `select event_type, created_at::text, metadata from public.booking_events
       where booking_id = $1 and event_type in
         ('booking_created', 'booking_confirmed', 'booking_rescheduled', 'booking_cancelled')
       order by created_at asc`,
      [session.bookingId],
    );
    return ok(events.rows);
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

/** Hub: cancel (BD-2 customer path — deadline enforced in the domain). */
export async function hubCancelBookingAction(input: {
  sessionId: string;
  reason?: string;
}): Promise<Result<CancellationOutcome>> {
  try {
    const session = await requireCustomerSession(input.sessionId);
    const outcome = await cancelBooking(null, { booking_id: session.bookingId, reason: input.reason });
    return ok(outcome);
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

/** Hub: reschedule (BD-3 customer path — 2h deadline + 24h target notice). */
export async function hubRescheduleBookingAction(input: {
  sessionId: string;
  target_start: string;
  target_end: string;
  hold_id?: string;
  session_slot_id?: string;
  reason?: string;
  accepted_target_total_minor?: number;
}): Promise<Result<RescheduleOutcome>> {
  try {
    const session = await requireCustomerSession(input.sessionId);
    const outcome = await rescheduleBooking(
      null,
      {
        booking_id: session.bookingId,
        target_start: input.target_start,
        target_end: input.target_end,
        hold_id: input.hold_id,
        session_id: input.session_slot_id,
        reason: input.reason,
        accepted_target_total_minor: input.accepted_target_total_minor,
        idempotency_key: `hub-${session.sessionId}-${input.target_start}`,
      },
    );
    return ok(outcome);
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

/** Hub: Contact CLENQO — branch contact info ONLY (B-NEW-1; no messaging). */
export async function hubContactInfoAction(input: { sessionId: string }): Promise<Result<{
  name: string;
  phone: string | null;
  email: string | null;
}>> {
  try {
    const session = await requireCustomerSession(input.sessionId);
    const booking = await loadBookingInternal(session.bookingId);
    const branch = await query<{ name: string; phone: string | null; email: string | null }>(
      `select name, phone, email from public.branches where id = $1`,
      [booking.branch_id],
    );
    const b = branch.rows[0];
    if (!b) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
    return ok({ name: b.name, phone: b.phone, email: b.email });
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

async function loadBookingInternal(bookingId: string): Promise<BookingRow> {
  const res = await query<BookingRow>(
    `select id, organization_id, branch_id, customer_id, booking_number, status,
            booking_type, scheduled_start::text, scheduled_end::text, timezone, service_address,
            pricing_version_id, cancellation_policy_snapshot, source, currency, subtotal,
            surcharge_total, tax_total, total, cancelled_at::text, cancelled_by, cancellation_reason,
            cancellation_fee_minor, amount_owed_minor, reschedule_count, confirmed_at::text, completed_at::text
     from public.bookings where id = $1`,
    [bookingId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Booking not found.");
  return row;
}

async function listBookingsForActor(
  ctx: AuthContext,
  input: { branchId: string; status?: string; search?: string; limit?: number },
): Promise<BookingRow[]> {
  const { requireOrganizationAccess, hasBranchScope } = await import("@/lib/authorization/server");
  const branch = await query<{ organization_id: string }>(
    `select organization_id from public.branches where id = $1`,
    [input.branchId],
  );
  const branchRow = branch.rows[0];
  if (!branchRow) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  requireOrganizationAccess(ctx, branchRow.organization_id);
  if (!(await hasBranchScope(ctx, input.branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  const params: unknown[] = [input.branchId];
  const conditions: string[] = ["branch_id = $1"];
  if (input.status) {
    params.push(input.status);
    conditions.push(`status = $${params.length}`);
  }
  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim().toLowerCase()}%`);
    conditions.push(
      `(lower(booking_number) like $${params.length} or customer_id in (
         select id from public.customers
         where email_normalized like $${params.length}
            or lower(first_name || ' ' || last_name) like lower($${params.length})
       ))`,
    );
  }
  params.push(Math.min(input.limit ?? 100, 500));
  const res = await query<BookingRow>(
    `select id, organization_id, branch_id, customer_id, booking_number, status,
            booking_type, scheduled_start::text, scheduled_end::text, timezone, service_address,
            pricing_version_id, cancellation_policy_snapshot, source, currency, subtotal,
            surcharge_total, tax_total, total, cancelled_at::text, cancelled_by, cancellation_reason,
            cancellation_fee_minor, amount_owed_minor, reschedule_count, confirmed_at::text, completed_at::text
     from public.bookings where ${conditions.join(" and ")}
     order by scheduled_start desc limit $${params.length}`,
    params,
  );
  return res.rows;
}
