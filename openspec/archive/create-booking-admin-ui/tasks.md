# Tasks: create-booking-admin-ui

> Implementation contract from proposal.md + design.md. BD-B1–BD-B4 are
> binding. No migration, no new permissions, no Worker/Cleaner changes, no
> notification delivery, no payments, no dedup workflow, no public/customer-
> facing UI. Do not mark tasks complete until verified.

## 1. Routes & navigation

- [x] 1.1 Create `app/(admin)/admin/bookings/page.tsx` and
      `app/(admin)/admin/bookings/[id]/page.tsx` (server components).
- [x] 1.2 Create `app/(admin)/admin/customers/page.tsx` and
      `app/(admin)/admin/customers/[id]/page.tsx` (server components).
- [x] 1.3 Add permission-aware shell nav entries: Bookings
      (`bookings.view`), Customers (`customers.view`) in
      `app/(admin)/admin/layout.tsx` (existing `hasPermission` pattern).
- [x] 1.4 Wire branch-context interplay: pages consume the layout-resolved
      context; "All Branches" + bookings page renders the explicit
      branch-selection empty state (BD-B1) — no unscoped query.

## 2. Booking list

- [x] 2.1 Implement the list view on `listBookingsAction` (status filter,
      search, capped pagination via URL params; branch timezone display;
      minor-units currency rendering; `amount_owed_minor` badge).
- [x] 2.2 Add `loading.tsx`, error and empty states for the segment
      (including "no branch selected").

## 3. Booking detail

- [x] 3.1 Implement detail on `getBookingAction` with the §5 layout: status/
      number, schedule, customer card (link), address snapshot, stored
      pricing snapshot (display-only), cancellation state, source.
- [x] 3.2 Fail closed when the returned booking's `branch_id` mismatches the
      resolved context.

## 4. Staff timeline (read-only action)

- [x] 4.1 Add `getBookingTimelineAction({ bookingId })` to
      `features/booking/actions.ts`: `bookings.view` + booking load +
      `requireOrganizationAccess` + `hasBranchScope(booking.branch_id)`;
      ascending `event_type/created_at/metadata`; hard row cap; no
      mutation, no new event types (design §6).
- [x] 4.2 Render the timeline on the detail page with branch-local
      timestamps.
- [x] 4.3 Tests: gating matrix (unauthenticated / wrong permission /
      foreign-branch booking → deterministic errors; authorized → events),
      read-only guarantee (no rows written).

## 5. Staff booking creation

- [x] 5.1 Build the creation wizard (client component) composing:
      service/variant selection (existing catalog list actions) →
      customer fields (`customerInputSchema` or existing-customer select) →
      property details → `getAvailabilityAction` slots →
      `calculateQuoteAction` quote display → `createSlotHold` →
      `staffCreateBookingAction` with `source: "dashboard"`, quoted
      `accepted_total_minor`, and a wizard-instance `idempotency_key`
      reused across retries (design §7).
- [x] 5.2 Route the wizard entry from the bookings list (permission
      `bookings.create`); redirect to the new booking detail on success.
- [x] 5.3 Tests: idempotency-key reuse converges duplicate submits;
      server-authoritative values only (UI sends no computed price/duration);
      `confirmBookingSchema` rejection surfaces stable errors.

## 6. Cancellation

- [x] 6.1 Implement the cancel dialog (optional reason, max 1000) calling
      `staffCancelBookingAction`; render the domain `CancellationOutcome`
      (fee tier, fee, amount owed, status) — no UI fee computation; no
      fee-override UI.
- [x] 6.2 Tests: permission gating (`bookings.cancel`), outcome rendering,
      BD-W7 propagation untouched (action-level regression).

## 7. Rescheduling

- [x] 7.1 Implement the reschedule flow: `getAvailabilityAction` slot picker
      → `createSlotHold` → `staffRescheduleBookingAction` (target_start/
      target_end/hold_id/session_id/optional reason/accepted target total).
      Surface BD-3 domain rules' results verbatim (24-h notice, permitted
      states, free reschedule, new snapshot) — no client-side rule checks.
- [x] 7.2 Tests: permission gating (`bookings.edit`), same-day target
      returns the domain's stable error and the UI displays it unchanged.

## 8. Customer list

- [x] 8.1 Implement the list on `listCustomersAction` (server-side search;
      passive `contact_conflict_flag` badge per BD-B4; no dedup workflow).
- [x] 8.2 Add loading/error/empty states.

## 9. Customer detail & editing

- [x] 9.1 Implement detail on `getCustomerAction`: contact block, status,
      notes, conflict flag (display-only), addresses, authorized booking
      history via `listBookingsAction` restricted to actor-accessible
      branches (fail-closed).
- [x] 9.2 Implement the edit form on `updateCustomerAction` +
      `updateCustomerSchema` (`customers.edit`; read-only render without
      it; `contact_conflict_flag` not settable from the UI).

## 10. Customer addresses

- [x] 10.1 Implement address list/create/delete on the existing address
       actions with `addressInputSchema` (`customers.edit` for mutations).

## 11. Context & state polish

- [x] 11.1 Verify every page/action call uses the server-resolved context;
       direct URL access to unauthorized branches fails closed.
- [x] 11.2 Apply the shared pending/error patterns to all mutations; no
       optimistic domain state anywhere.

## 12. Tests & verification

- [x] 12.1 Authorization matrix tests (hq_admin / hq_staff / branch_manager
       in- and out-of-scope / cleaner) across all consumed actions.
- [x] 12.2 RLS regression: existing booking/customer policies unchanged and
       passing; no new policy.
- [x] 12.3 UI smoke tests: nav visibility, BD-B1 empty state, safe-`next`
       regression, conflict-flag read-only rendering.
- [x] 12.4 Security tests: cross-branch URL access denied; direct action
       invocation without permission denied.
- [x] 12.5 Accessibility/responsive checks: keyboard paths for wizard and
       dialogs, labelled inputs, status-by-text.
- [x] 12.6 Typecheck, lint, build — all green.

## 13. Hosted verification

- [x] 13.1 Dedicated Change 9 hosted verification suite (no migration apply;
       staff flows against the hosted project; zero test leftovers).
- [x] 13.2 Full hosted Changes 1–9 regression (existing suites + Change 9).

## 14. Documentation synchronization

- [x] 14.1 `PROJECT_STRUCTURE.md`: bookings/customers routes implemented.
- [x] 14.2 `ADMIN_SYSTEM.md`: operational modules record update.
- [x] 14.3 `ROADMAP.md`: §14/§16 implementation records.
- [x] 14.4 `BOOKING_SYSTEM.md`: staff-UI surface note (§46 area).
- [x] 14.5 `DOCUMENTATION_AUDIT.md`: Change 9 implementation follow-up entry.
- [x] 14.6 Mark this change's tasks complete per project convention after
       verification (archive/promotion happens in its own finalization run).
