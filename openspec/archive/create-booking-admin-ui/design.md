# Design: create-booking-admin-ui

**Change ID:** `create-booking-admin-ui` · **Capability:** `admin-bookings` (new)
**Decision records:** BD-B1–BD-B4 (DOCUMENTATION_AUDIT §4d; BOOKING_SYSTEM §48; ADMIN_SYSTEM §3)

## Normative architectural rule

**Business logic remains in server-side domain services.** UI components are
consumers of those contracts and must never reimplement Booking, Pricing,
Scheduling, Worker, Payment, or Notification business logic. Where this design
says "display", the value comes from a server contract; where it says "call",
the server action is the only path. No validation, computation, or state
transition may be duplicated client-side — client checks are UX only.

## 1. BD-B1–BD-B4 as binding constraints

* **BD-B1 (branch-scoped lists).** `listBookingsAction` already *requires*
  `branchId` (`features/booking/actions.ts:89`). The UI passes the
  server-resolved branch context; it never invents a branch id client-side.
  No "All Branches" bookings aggregation view, no cross-branch service. When
  HQ users hold the org-wide "All Branches" context, the bookings pages
  require an explicit branch selection (empty state prompting selection) —
  the context selector remains the switching mechanism.
* **BD-B2 (staff customer detail/editing).** Detail views render the
  `CustomerRecord` fields the service returns (name, email, phone, company,
  status, preferred language, notes). Editing uses `updateCustomerAction`
  with the existing `updateCustomerSchema` shapes; permissions via existing
  `customers.view`/`customers.edit`. The BD-C1 cleaner minimization is a
  cleaner-surface rule and does not apply here; conversely, this change adds
  no new customer exposure beyond what the services already authorize.
* **BD-B3 (staff creation via existing engine).** Creation composes existing
  contracts in domain order (§7 below). The UI must not compute prices,
  durations, availability, or hold state; every authoritative value comes
  from `calculateQuoteAction` / `getAvailabilityAction` / `createSlotHold` /
  `staffCreateBookingAction`.
* **BD-B4 (dedup deferred).** The UI may render `contact_conflict_flag`
  (already present in `updateCustomerSchema` and the customer record) as a
  passive indicator. No conflict-resolution UI, no merge flow, no new
  backend flag; MEDIUM-7 untouched.

## 2. Admin route architecture

```text
app/(admin)/admin/bookings/page.tsx            — list (server component)
app/(admin)/admin/bookings/[id]/page.tsx       — detail (server component)
app/(admin)/admin/customers/page.tsx           — list (server component)
app/(admin)/admin/customers/[id]/page.tsx      — detail + edit (server component)
```

* Routes live inside the existing `(admin)` group → middleware, layout guard,
  and shell apply automatically. URLs follow the established
  `/admin/<domain>` convention (`PROJECT_STRUCTURE.md` §11 conceptual map).
* Server Components fetch via the existing `*Action` functions directly
  (same pattern as `app/(admin)/admin/page.tsx`); Client Components exist
  only for forms/wizard interactivity and invoke Server Actions wrappers
  around the same domain actions.
* No new route groups, no new middleware, no layout changes beyond nav.

## 3. Change 8 shell/context integration

* `resolveAdminContext` (`features/admin/context.ts`) is already invoked by
  the `(admin)` layout and revalidates the selected branch against
  organization + `membership_branches` on every request. Pages receive the
  resolved context; they never re-derive scope from cookies/query directly.
* Navigation: the shell gains **Bookings** and **Customers** entries gated by
  `hasPermission(ctx, "bookings.view")` / `hasPermission(ctx,
  "customers.view")` respectively (same pattern as existing entries in
  `app/(admin)/admin/layout.tsx`). No permission catalog change.
* Deep links: booking/customer URLs carry ids only; branch context stays in
  the established `?branch=` + cookie-echo mechanism. A URL for a branch the
  actor cannot access fails closed with the context error (existing
  behavior), not a silent fallback.

## 4. Booking list architecture

* **Data:** `listBookingsAction({ branchId, status?, search?, limit? })` —
  server-enforced org access + `hasBranchScope` + cap 500 (`limit` clamped in
  the action). Status filter uses the booking status vocabulary already
  stored (`draft/pending/confirmed/assigned/in_progress/completed/cancelled/no_show`);
  search matches `booking_number`/customer name/email server-side.
* **Columns (display-only):** booking number, status, scheduled_start (branch
  timezone), customer name, service/snapshot label, total (minor units),
  `amount_owed_minor` badge when > 0, source.
* **Filters:** status select + search box, applied via URL search params
  (shareable deep links); pagination is limit-offset over the same action
  (max 500 per query — no new aggregate).
* **BD-B1 guard:** the page requires a resolved branch context; with
  "All Branches" selected it renders the explicit branch-selection empty
  state rather than attempting an unscoped query.
* **Row action:** link to detail. No inline mutation on the list.

## 5. Booking detail architecture

* **Data:** `getBookingAction(bookingId)` — `loadBookingForActor` already
  enforces org access + branch scope; the UI additionally verifies the
  returned `branch_id` matches the resolved context before rendering
  (fail-closed on mismatch).
* **Sections:** status + booking number; schedule (start/end, branch-local
  time, reschedule count); customer card (link to
  `/admin/customers/[id]`); service address snapshot; **stored pricing
  snapshot** (subtotal/surcharge/tax/total, currency — display only, §22);
  cancellation state (policy snapshot, fee, amount owed); source;
  **timeline** (§6).
* **Actions:** cancel (§8) and reschedule (§9) as client forms invoking the
  staff actions; booking creation never happens here.
* **Job linkage (§21):** where the Worker contract exposes the related job
  (jobs are created per booking post-commit), render a **link** to
  `/admin/jobs/[id]` — read-only navigation, no job data duplication.

## 6. Staff booking timeline (the one new action)

**Gap:** the only existing timeline contract is customer-session-scoped
(`hubGetTimelineAction` — customer-safe events only). Staff need the
operational history.

**New thin read action** in `features/booking/actions.ts`:

```text
getBookingTimelineAction(input: { bookingId: string })
```

* Validates with the same chain as `loadBookingForActor`:
  `requirePermission(ctx, "bookings.view")` → load booking →
  `requireOrganizationAccess` + `hasBranchScope(booking.branch_id)`.
  The booking must belong to the authorized branch — authorization flows
  through the booking's branch, not a `booking_events` column (the table has
  no branch/organization column; **no RLS change and no migration are
  required** — repo evidence: migration 0011 table definition).
* Returns `event_type`, `created_at`, `metadata` ordered ascending —
  **read-only**; no mutation, no new event types, no event-writing logic
  (events are written by the domain, unchanged). No pagination in V1 (event
  counts per booking are small); a hard row cap (e.g. 200, `created_at desc`
  then reversed) prevents unbounded reads.
* Detail page renders the timeline as plain rows with server-formatted
  branch-local timestamps.

## 7. Staff booking creation

UI flow mirrors the domain flow — **each step server-authoritative**:

```text
branch context (resolved) 
→ service/variant selection        — catalog services via existing service
                                     list actions for the branch
→ property + customer information  — customer fields per confirmBookingSchema;
                                     existing customer may be selected or new
                                     created through the customer input schema
→ availability                     — getAvailabilityAction (server slots only)
→ quote                            — calculateQuoteAction (server price only)
→ slot hold                        — createSlotHold (hold_id + session)
→ confirm                          — staffCreateBookingAction with
                                     source: "dashboard", the quoted
                                     accepted_total_minor, and a UI-generated
                                     idempotency_key (UUID)
```

* The wizard validates shape client-side for UX only; all real validation is
  `confirmBookingSchema` in the action.
* `idempotency_key` is generated once per wizard instance and **reused on
  retry** of the same submission — double-clicks/replays converge to one
  booking (existing TD-5 behavior).
* On success, redirect to the new booking's detail. Worker job creation and
  outbox events happen inside the action (BD-W6) — the UI never calls them.
* Explicit non-goals hold: no recurring scheduling, no payment step, no
  notification triggers.

## 8. Staff cancellation

* `staffCancelBookingAction({ booking_id, reason? })` — confirm dialog
  collecting an optional reason (max 1000, per `cancelBookingSchema`).
* Outcome comes from the domain (`CancellationOutcome`): applicable fee tier,
  fee amount, amount owed, new status. The UI displays the returned outcome —
  it never precomputes fees. Fee override is **not** part of Change 9 UI
  (`bookings.override` exists for future HQ tooling; showing it here would
  expand scope without an owner decision).
* Post-commit job propagation (`propagateCancellationToJob`) already lives in
  the action; the UI does not touch Worker.

## 9. Staff rescheduling

* `staffRescheduleBookingAction({ booking_id, target_start, target_end,
  hold_id, session_id, reason?, accepted_target_total_minor? })` (same input
  shape the hub action composes — staff variant skips the customer-session
  requirement; authorization is staff + branch scope).
* Flow: pick a new slot via `getAvailabilityAction` → hold via
  `createSlotHold` → submit; the domain enforces BD-3 rules (24-h minimum
  notice, permitted states, free reschedule, new pricing snapshot,
  customer-acceptance on higher price). The UI surfaces domain-returned
  results — including a deterministic error when the target is same-day or
  the state disallows rescheduling — and never relaxes rules client-side.

## 10–13. Customer list / detail / editing / addresses

* **List:** `listCustomersAction({ organizationId, search?, conflictsOnly? })`
  — org-scoped by design (the customer model is organization-wide); rows show
  name, email, phone, status, conflict flag (passive badge, BD-B4). Search is
  server-side. Branch-context does not filter this list (no branch column on
  customers — matches existing contract; isolation is enforced by the service
  layer's org check and RLS).
* **Detail:** `getCustomerAction(customerId)`; sections: contact block
  (BD-B2 fields), status, notes, conflict flag (display-only), addresses,
  booking relationship/history **only through existing authorized data** —
  the list of that customer's bookings is fetched with
  `listBookingsAction` for branches the actor can access within the resolved
  context; bookings in branches outside the actor's scope are never requested
  and never shown (fail-closed, not hidden).
* **Editing:** `updateCustomerAction` with `updateCustomerSchema` fields
  (first/last name, email, phone, company, preferred language, status, notes;
  `contact_conflict_flag` **not** settable from the UI — BD-B4). Permission
  `customers.edit`; read-only rendering when the actor lacks it.
* **Addresses:** `listCustomerAddressesAction` /
  `createCustomerAddressAction` / `deleteCustomerAddressAction` with the
  existing `addressInputSchema` (street, house_number, postal_code, city,
  country 2-letter, access_instructions, label). No address becomes a booking
  service_address from the UI without re-entering it in the creation wizard
  (snapshot semantics preserved).

## 14. Existing domain contract inventory (consumed, unchanged)

| Contract | Location | Used for |
|---|---|---|
| `listBookingsAction` | `features/booking/actions.ts:89` | booking list |
| `getBookingAction` | :85 | booking detail |
| `staffCancelBookingAction` | :101 | cancellation |
| `staffRescheduleBookingAction` | :115 | rescheduling |
| `staffCreateBookingAction` | :129 | creation |
| `getAvailabilityAction` | `features/scheduling/actions.ts:120` | slot selection |
| `calculateQuoteAction` | `features/pricing/actions.ts:100` | quote display |
| `createSlotHold` | `features/scheduling/holds.ts:108` | hold before confirm |
| `listCustomersAction` | `features/booking/actions.ts:188` | customer list |
| `getCustomerAction` | :184 | customer detail |
| `updateCustomerAction` | :196 | customer editing |
| `listCustomerAddressesAction` / `createCustomerAddressAction` / `deleteCustomerAddressAction` | :203/:207/:214 | addresses |
| `getBookingTimelineAction` | **new** (this change) | staff timeline (read-only) |
| schemas | `features/booking/schemas/booking.ts` | `confirmBookingSchema`, `cancelBookingSchema`, `updateCustomerSchema`, `customerInputSchema`, `addressInputSchema`, `BOOKING_SOURCES` |

## 15. Permission enforcement

* Canonical catalog only: `bookings.view` (list/detail/timeline),
  `bookings.create` (creation wizard), `bookings.edit` (reschedule),
  `bookings.cancel` (cancellation), `customers.view` (list/detail/addresses),
  `customers.edit` (customer/address mutation). Nav entries gated as in §3;
  pages render read-only or 403 per existing `run()`/`AppError` mapping when
  a permission is missing. No new permission, no role change
  (`lib/permissions.ts` untouched).

## 16. RLS enforcement

* No new policies; no policy modified. All tables involved (bookings,
  customers, customer_addresses, booking_events, slot_holds) carry their
  Change 1–5 RLS. `booking_events` has no tenant column — staff access flows
  exclusively through the booking's branch authorization in the action
  (§6), which is the same trust boundary as every other booking read.
  RLS regression tests from Changes 1–8 must pass unchanged.

## 17. Branch-context isolation

* Every page/action call passes the **server-resolved** branch context.
  Branch Managers: context is fixed to `membership_branches` (selector
  enumerates only those; direct URL to another branch fails closed).
  HQ: context switching through the selector; bookings pages require an
  explicit branch (BD-B1). Customer pages are org-scoped per the customer
  model, with booking history narrowed to accessible branches (§11).
* Server actions remain the boundary: even if a compromised client called an
  action directly, org + branch-scope checks inside each action apply.

## 18. Loading/error/empty states

* Server Components stream naturally; heavy lists use `loading.tsx` files per
  route segment. Errors render the existing app error conventions
  (`AppError` codes → stable messages; NOT_FOUND → not-found UI; FORBIDDEN →
  explicit access-denied panel). Empty states: no bookings in branch (with
  creation shortcut when permitted), no branch selected (BD-B1 "All
  Branches" case), no customers matching search, no addresses. Pending
  mutations use the existing form-pending patterns; no optimistic domain
  state.

## 19. Pagination / filter / search

* Bookings: status filter + search + limit-offset via existing action caps
  (≤ 500); filter state lives in URL params (deep-linkable, preserves branch
  context param). Customers: server-side search; result rendering capped the
  same way. Timeline: hard cap per §6. No new indexes or queries outside the
  existing service SQL.

## 20. Idempotency / concurrency

* Creation: UI-generated `idempotency_key` (UUID) created once per wizard
  instance and reused across retries of that submission; the domain's
  idempotent-confirm converges duplicates (existing TD-5 contract).
* Cancel/reschedule/customer updates: plain server-authoritative calls; a
  stale client simply receives the domain's stable error/outcome — the UI
  never reconciles state locally. No client-side status mutation; lists
  re-render from server data after actions complete.

## 21. Booking → Worker boundary

* Change 9 renders at most a **link** from a booking to its related job
  (`/admin/jobs/[id]`, where an existing contract exposes the mapping — jobs
  are created per booking post-commit, BD-W6). No job detail data is
  duplicated into booking pages; no job mutation exists in this change;
  employees/assignments/jobs remain Worker-owned (Changes 6/7). The existing
  `safeWorkerPropagation` calls inside booking actions are untouched.

## 22. Pricing boundary

* The stored pricing snapshot (subtotal/surcharge/tax/total, currency,
  `pricing_version_id`) is **display-only**. Quote display during
  creation/reschedule comes from `calculateQuoteAction`. No UI-side price
  arithmetic, no fee/tax computation, no pricing rule editing (that belongs
  to the future Pricing Admin UI change), no `pricing.override` surface.

## 23. Scheduling boundary

* Availability comes exclusively from `getAvailabilityAction`; holds via
  `createSlotHold`; BD-3 rules enforced server-side. The UI never computes
  slots, never bypasses the hold, and never mutates operating hours or
  exceptions (Scheduling Admin UI is a future change).

## 24. Notification boundary

* The `notification_outbox` is invisible to this UI: no listing, no status
  display, no retry controls, no delivery implementation. Booking actions
  enqueue events exactly as they already do; that is the entire notification
  interaction. Reminder/payment emails are non-goals.

## 25. Payment boundary

* Stored monetary fields (total, `amount_owed_minor`, `cancellation_fee_minor`,
  currency) render as display values only. No payment processing, no
  capture/refund UI, no provider integration, no payment status mutation —
  Payments remain Phase 3 documentation.

## 26. Audit / event behavior

* Domain actions keep writing their existing booking events and audit
  records transactionally — unchanged. The new timeline action is read-only
  and writes nothing. No second audit architecture; no new event types; UI
  actions add at most the actor's existing identity through the standard
  context (no new actor model).

## 27. Localization / timezone / currency

* Timestamps display in the **branch timezone** (bookings carry `timezone`;
  use the existing localization utilities — same convention as the admin
  dashboard). Currency amounts render as minor-units → major-unit strings
  with the stored currency code. UI strings follow the existing
  localization architecture (employee preferred language / supported-locale
  fallback, `LOCALIZATION.md`); no hardcoded locale, no hardcoded Leipzig,
  no new translation keys beyond the change's own UI strings.

## 28. Accessibility / responsive admin UI

* Desktop-first responsive internal tooling (Change 8 convention): usable at
  tablet width, keyboard-operable forms, labelled inputs, focus-visible
  states, status conveyed by text (not color alone), table semantics with
  sensible scope attributes, dialogs with focus trapping and Escape/overlay
  dismissal. No new component framework — reuse existing admin styling.

## 29. Testing strategy

* **Action/authorization tests** (pglite, real migrations): timeline action
  gating (no session, no permission, foreign branch → deterministic
  errors; authorized branch → events); staff cancel/reschedule/create
  passthrough with branch-scope denials; idempotency-key reuse converging
  creation; customer list/detail/edit/address authorization matrix
  (hq_admin, hq_staff, branch_manager in/out of scope, cleaner denied).
* **RLS tests:** regression — no policy change; assert existing booking/
  customer policies still behave (outsider sees none; same-org staff rows
  per existing model).
* **UI smoke tests:** nav visibility per role/permission; branch-context
  interplay (BD-B1 empty state under "All Branches"); safe-`next` regression
  after login; creation wizard reaches confirm with server values; conflict
  flag renders read-only.
* **Security tests:** cross-branch URL access denied; direct action calls
  without permission denied; no customer-data exposure beyond contracts.
* **A11y/responsive checks:** keyboard paths for wizard/dialogs; status
  text alternatives.
* **Hosted:** dedicated Change 9 hosted verification (no migration apply)
  + full Changes 1–9 hosted regression. Typecheck/lint/build gates. No test
  weakened to pass.

## 30. Documentation synchronization

`PROJECT_STRUCTURE.md` (routes now implemented), `ADMIN_SYSTEM.md` (module
record), `ROADMAP.md` (§14/§16 records), `BOOKING_SYSTEM.md` (staff-UI note
at §46), `DOCUMENTATION_AUDIT.md` (Change 9 follow-up). BD-B records remain
authoritative — no decision rewritten.
