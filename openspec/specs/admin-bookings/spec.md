# admin-bookings

**Capability:** `admin-bookings`
**Status:** Active capability
**Established by:** `openspec/archive/create-booking-admin-ui/` (Change 9, implemented 2026-09-19, commit `8672525`; hosted Change 9 verification 8/8 PASS, full hosted Changes 1–9 regression 97/97 PASS, local suite 330 PASS / 97 skipped)
**Sources:** `BOOKING_SYSTEM.md` (incl. §73/§74 implementation records, BD-B1–BD-B4 decision record), `ADMIN_SYSTEM.md` §3, `REQUIREMENTS.md` §28/§29/§36, `ROADMAP.md` §14/§16, `PROJECT_STRUCTURE.md` §12, `SECURITY.md` §14, `API_STANDARDS.md`

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.
Requirement wording is normative and testable; WHEN/THEN scenarios are
acceptance criteria. The authoritative V1 decision record is BD-B1–BD-B4.
The Booking domain lifecycle (`booking` capability) and the Admin Foundation
shell (`admin-foundation` capability) remain authoritative and unchanged;
this capability describes the staff-facing application surface that consumes
them. Customer deduplication workflows (MEDIUM-7) and organization-wide
booking aggregation are explicit non-goals of this capability.


## Requirement: Staff booking list is branch-scoped (BD-B1)
The staff booking list SHALL render bookings only for the server-resolved branch context of the request; Branch Managers SHALL see only branches within their `membership_branches` scope, and HQ Staff/Admin SHALL switch branches through the existing Change 8 context selector. The V1 surface SHALL NOT provide an organization-wide "All Branches" bookings aggregation view, and no cross-branch aggregation service SHALL be created. Booking lists SHALL be produced exclusively by the existing `listBookingsAction` contract (status filter, search, and result caps included).

#### Scenario: Branch Manager sees only authorized branches
* **WHEN** a Branch Manager opens `/admin/bookings`
* **THEN** the list contains only bookings of branches in their `membership_branches` scope, and a direct URL with another branch id fails closed

#### Scenario: HQ user with All Branches context
* **WHEN** an HQ user holds the organization-wide context and opens `/admin/bookings`
* **THEN** the page shows an explicit branch-selection empty state and performs no unscoped query

#### Scenario: No cross-branch aggregation
* **WHEN** any staff role uses the booking list
* **THEN** every result row belongs to exactly one server-validated branch, and no UI or service path returns bookings across branches in one view

## Requirement: Booking detail renders domain data only
`/admin/bookings/[id]` SHALL render booking status and number, schedule in the branch timezone, the customer card with a link to the customer detail, the service address snapshot, the stored pricing snapshot (display-only), cancellation state (policy snapshot, fee, amount owed), source, and the staff timeline. The page SHALL fail closed when the booking's `branch_id` does not match the resolved branch context. All data SHALL come from `getBookingAction`.

#### Scenario: Foreign-branch booking denied
* **GIVEN** a booking in a branch outside the actor's authorized scope
* **WHEN** the actor requests `/admin/bookings/[id]` for it
* **THEN** the request fails with the stable access error and no booking data is rendered

## Requirement: Staff booking timeline is a read-only authorized view
A staff timeline read action SHALL return a booking's `booking_events` rows (event_type, created_at, metadata, ascending) only to actors holding `bookings.view` whose resolved context grants organization access and branch scope for the booking's branch. The action SHALL perform no mutation, SHALL introduce no new event types, and SHALL cap result rows. Existing domain event-writing SHALL remain the only source of events.

#### Scenario: Unauthorized timeline access
* **WHEN** an actor without `bookings.view` — or with valid permission but a booking in an unauthorized branch — requests the timeline
* **THEN** the action returns a deterministic denial and no events are exposed

#### Scenario: Timeline is read-only
* **WHEN** the timeline action is invoked by an authorized actor
* **THEN** booking_events content is unchanged and no audit/event row is written by the action itself

## Requirement: Staff booking creation uses the existing engine (BD-B3)
The booking creation wizard SHALL compose the existing contracts in domain order — catalog service selection, customer input per the existing schema, availability via the existing availability action, quote via the existing quote action, slot hold via the existing hold contract, and confirmation via `staffCreateBookingAction` with `source: "dashboard"`, the server-quoted accepted total, and a caller-supplied idempotency key. The UI SHALL NOT compute prices, durations, availability, or hold state, and SHALL NOT create a second booking engine. Recurring bookings, payment processing, notification delivery, job-creation logic, and workforce assignment SHALL NOT be implemented by this capability.

#### Scenario: Creation converges on retry
* **GIVEN** a wizard submission that already confirmed a booking
* **WHEN** the same submission (same idempotency key) is retried
* **THEN** exactly one booking exists and the UI lands on that booking's detail

#### Scenario: No client-side price authority
* **WHEN** the wizard reaches confirmation
* **THEN** the accepted total sent is the server-quoted value, and any client-side manipulation of price fields fails domain validation

## Requirement: Staff cancellation delegates to the domain
Cancellation SHALL call `staffCancelBookingAction` with an optional reason and SHALL display the domain-returned outcome (applicable fee tier, fee amount, amount owed, resulting status). The UI SHALL NOT precompute cancellation fees and SHALL NOT expose a cancellation-fee override control. The existing post-commit job propagation SHALL remain inside the action and untouched by the UI.

#### Scenario: Cancellation outcome is authoritative
* **GIVEN** a confirmed booking within a fee tier
* **WHEN** authorized staff cancel it with a reason
* **THEN** the displayed fee, amount owed, and status equal the domain outcome

## Requirement: Staff rescheduling delegates to the domain
Rescheduling SHALL compose the availability action, the hold contract, and `staffRescheduleBookingAction` (target interval, hold, optional reason, accepted target total). Domain rules — permitted states, 24-hour minimum notice, free reschedule, new pricing snapshot, customer acceptance when the price increases — SHALL be enforced by the domain only; the UI SHALL display domain results verbatim, including deterministic errors for same-day targets or disallowed states.

#### Scenario: Same-day reschedule target rejected
* **WHEN** staff select a same-day target slot
* **THEN** the domain returns its stable error and the UI displays it without offering a bypass

## Requirement: Customer list is staff-authorized
`/admin/customers` SHALL render customers via `listCustomersAction` with server-side search, showing name, email, phone, status, and the existing `contact_conflict_flag` as a passive indicator. No deduplication or conflict-resolution workflow SHALL be created (BD-B4), and `contact_conflict_flag` SHALL NOT be settable from this UI. Access SHALL require `customers.view`.

#### Scenario: Conflict flag displayed without workflow
* **GIVEN** a customer with `contact_conflict_flag = true`
* **WHEN** staff view the customer list or detail
* **THEN** the flag renders as a read-only indicator and no merge/resolve control exists

## Requirement: Customer detail and editing use existing contracts (BD-B2)
`/admin/customers/[id]` SHALL render the staff-authorized customer detail (name, email, phone, company, status, preferred language, notes, addresses, and booking history restricted to branches within the actor's accessible scope, failing closed). Editing SHALL use `updateCustomerAction` with the existing update schema behind `customers.edit`; actors without the permission SHALL see a read-only view. The cleaner-minimized customer visibility rules (BD-C1) SHALL remain unchanged on cleaner surfaces and SHALL NOT be relaxed or applied here.

#### Scenario: Editing requires customers.edit
* **GIVEN** a staff member with only `customers.view`
* **WHEN** they open a customer detail
* **THEN** the data is visible and every edit control is absent/disabled server-side

#### Scenario: Booking history is scope-limited
* **WHEN** a Branch Manager views a customer who has bookings in branches outside their scope
* **THEN** only in-scope bookings are requested and rendered; out-of-scope bookings are never fetched

## Requirement: Customer addresses use existing contracts
Address listing, creation, and deletion SHALL use the existing address actions and the existing address input schema, gated by `customers.edit` for mutations and `customers.view` for reads. No address data flow SHALL bypass the snapshot semantics of the booking creation flow.

#### Scenario: Address mutation gated
* **WHEN** an actor without `customers.edit` submits an address change
* **THEN** the action denies deterministically and no address row changes

## Requirement: Permission enforcement uses the canonical catalog only
Every Change 9 surface SHALL gate on the existing canonical permissions — `bookings.view`/`bookings.create`/`bookings.edit`/`bookings.cancel` and `customers.view`/`customers.edit` — via the existing authorization layer. Navigation visibility SHALL follow the Change 8 shell pattern. No new permission SHALL be created and no role grant SHALL change.

#### Scenario: Navigation reflects permissions
* **GIVEN** a staff member without `bookings.view`
* **WHEN** the admin shell renders
* **THEN** no Bookings entry is shown and direct URL access to `/admin/bookings` is denied server-side

## Requirement: Branch isolation is enforced by server and RLS
All Change 9 reads and mutations SHALL pass the server-resolved branch context validated against `membership_branches`; existing RLS policies SHALL remain unchanged, and no new policy SHALL be added. Middleware remains a UX layer only — server authorization in each action and RLS remain the security boundary.

#### Scenario: Compromised client cannot escape scope
* **WHEN** a client invokes a Change 9 action directly with a branch or booking outside the actor's scope
* **THEN** the action's organization/branch-scope checks deny the call regardless of UI state

## Requirement: Existing domain contracts are the only data path
Change 9 SHALL consume the existing booking, scheduling, pricing, and customer contracts enumerated in the design's contract inventory. It SHALL NOT duplicate booking lifecycle logic, pricing arithmetic, scheduling feasibility, cancellation tiers, or reschedule rules, SHALL NOT modify Worker/Cleaner execution surfaces, and SHALL NOT touch `notification_outbox`, payment fields (display-only), or customer-facing flows.

#### Scenario: Worker boundary preserved
* **GIVEN** a booking with a related job
* **WHEN** staff view the booking detail
* **THEN** the job appears at most as a link to the existing job admin page, with no job data duplicated and no job mutation available

#### Scenario: Notification and payment boundaries preserved
* **WHEN** staff use any Change 9 surface
* **THEN** no outbox status, delivery control, payment capture/refund, or customer-facing booking UI is reachable

## Requirement: Idempotency and concurrency behavior is preserved
Booking creation SHALL reuse a wizard-instance idempotency key across retries so duplicate submissions converge to one booking. Cancellation, rescheduling, and customer updates SHALL rely on server-authoritative outcomes; the UI SHALL NOT mutate domain state locally and SHALL re-render from server data after actions complete.

#### Scenario: Stale client receives deterministic result
* **GIVEN** two staff members viewing the same booking
* **WHEN** both attempt rescheduling concurrently
* **THEN** the domain serializes the outcomes and each client displays the server-returned result without client-side reconciliation
