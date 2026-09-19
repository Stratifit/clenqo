# Proposal: create-booking-admin-ui

**Change ID:** `create-booking-admin-ui`
**Capability:** `admin-bookings` (new)
**Status:** Draft — awaiting implementation approval
**Date:** 2026-09-19
**Decision records:** BD-B1–BD-B4 (`docs/DOCUMENTATION_AUDIT.md` §4d, `docs/BOOKING_SYSTEM.md` §48 block, `docs/ADMIN_SYSTEM.md` §3)

## Problem

The CLENQO booking and customer engine is backend-complete (Change 5, extended
through Change 8) but has **no staff-facing surface**. Staff today can:

* see dashboard *counts* of bookings (`app/(admin)/admin/page.tsx` consumes
  `listBookingsAction` only for numbers, capped at 200 rows);
* invite users, manage branches, employees and jobs.

Staff cannot list bookings for a branch, open a booking, read its history,
cancel or reschedule on a customer's behalf, create a dashboard booking
(phone/walk-in intake), or look up and edit a customer. `BOOKING_SYSTEM.md`
§14 ("Booking Operations") and ROADMAP §16 ("Branch Dashboard") describe this
surface as a Phase 1 requirement; it is the only remaining Phase 1 operations
gap now that the Admin Foundation (Change 8) exists.

## Motivation

* The Change 8 readiness audit and the Change 9 readiness audit independently
  identified Booking + Customer Admin UI as the next isolatable boundary:
  every server contract already exists and is authorization-complete; only the
  application surface is missing.
* It unblocks future changes by giving staff their first real data surface:
  Service Catalog UI, Pricing/Scheduling UI, and the public website all
  presume staff can see and correct operational data.
* It completes ROADMAP Phase 1 exit criteria (§17): "booking → confirmation →
  dashboard" must work "without manual database intervention" — today the
  dashboard leg requires SQL.

## Exact scope

Four routes inside the existing Change 8 protected `(admin)` route group:

```text
/admin/bookings        — branch-scoped booking list
/admin/bookings/[id]   — booking detail (customer, pricing snapshot, timeline)
/admin/customers       — customer list
/admin/customers/[id]  — customer detail + editing + addresses
```

Consumed (existing, unchanged) contracts:

* **Bookings:** `listBookingsAction`, `getBookingAction`,
  `staffCancelBookingAction`, `staffRescheduleBookingAction`,
  `staffCreateBookingAction` (`features/booking/actions.ts`)
* **Composition for staff creation:** `getAvailabilityAction`
  (`features/scheduling/actions.ts`), `calculateQuoteAction`
  (`features/pricing/actions.ts`), `createSlotHold`
  (`features/scheduling/holds.ts`)
* **Customers:** `listCustomersAction`, `getCustomerAction`,
  `updateCustomerAction`, `listCustomerAddressesAction`,
  `createCustomerAddressAction`, `deleteCustomerAddressAction`
* **One new thin read action:** staff booking timeline over
  `public.booking_events` (see design §6) — read-only, permission-gated,
  no mutation, no new event types, no migration.

Shell integration: permission-aware nav entries in the Change 8 layout,
branch-context awareness via the existing context selector
(`?branch=<branchId>` + server revalidation).

## Dependencies

| Dependency | State |
|---|---|
| Change 1 branch/provisioning/activation | shipped |
| Change 2 service catalog (backend) | shipped |
| Change 3 scheduling/availability (backend) | shipped |
| Change 4 pricing engine (backend) | shipped |
| Change 5 booking engine + magic links (backend) | shipped |
| Change 6 worker/jobs + booking↔job contracts | shipped |
| Change 7 cleaner PWA (unaffected) | shipped |
| Change 8 admin shell/context/permissions/RLS | shipped |
| Open decisions | **none** — BD-B1–BD-B4 resolved |

## Affected existing capabilities

* **`booking`** — consumed only; lifecycle, holds, reschedule rules (BD-3),
  cancellation tiers, idempotency and events remain authoritative. The live
  `openspec/specs/booking/spec.md` is **not modified** by this change.
* **`admin-foundation`** — consumed only; shell, context model, middleware,
  permission-aware navigation and RLS baseline are reused as-is. The live
  `openspec/specs/admin-foundation/spec.md` is **not modified** by this change.
* **`admin-bookings`** — new capability proposed by this change (the
  staff-facing application surface).

## Binding owner decisions (BD-B1–BD-B4)

* **BD-B1 Booking list scope:** branch-scoped V1 lists. Branch Managers see
  only their `membership_branches` branches; HQ Staff/Admin use the Change 8
  branch context selector. **No organization-wide "All Branches" booking
  aggregation and no cross-branch aggregation service.**
* **BD-B2 Customer detail/editing:** staff surface shows the full
  staff-authorized customer detail (name, email, phone, addresses, authorized
  booking relationship/history) and includes editing through the existing
  `customers.edit` permission. Cleaner BD-C1 minimized visibility is
  unchanged — this is a staff surface.
* **BD-B3 Staff booking creation:** included, via the existing
  `staffCreateBookingAction` and existing Catalog/Scheduling/Pricing/hold/
  confirmation contracts. **No second booking engine.**
* **BD-B4 Customer dedup UX:** deferred. No dedup/conflict-resolution
  workflow. The existing backend conflict behavior stays authoritative; the
  existing `contact_conflict_flag` may be **displayed** but no workflow is
  created. MEDIUM-7 remains open.

## Architectural boundary

Change 9 is a UI/application-surface change consuming existing domain
capabilities. It must not: create a new booking or customer domain; duplicate
pricing, scheduling, cancellation or rescheduling logic; modify Worker/Cleaner
execution; modify payment; implement notification delivery; create new
permissions; create a new RLS model; or create a migration unless the source
of truth proves a genuinely required schema gap (none is known — the one new
action is read-only over an existing table).

## Explicit non-goals

* recurring booking creation or management
* payment processing of any kind
* notification delivery or outbox management (outbox stays invisible to staff UI)
* job creation logic or workforce assignment (BD-W6/W7 propagation already
  lives inside the booking actions)
* customer-facing booking UX, public website, CMS
* customer deduplication workflow (BD-B4)
* Worker/Cleaner dashboard rebuild (link-only from booking to job where a
  contract supports it)
* organization-wide cross-branch booking aggregation (BD-B1)
* new permissions, new RLS model, database migration
* Magic-link/Booking Hub changes (customer session flows are untouched)

## Security considerations

Three-layer security model unchanged: middleware (UX layer only), server-side
authorization in every action (`requireOrganizationAccess` + `hasBranchScope`
+ `requirePermission`), and PostgreSQL RLS. Customer contact data on this
surface is the staff-authorized set — it must never be confused with the
Change 7 cleaner-minimized surface (BD-C1). Branch context is revalidated on
every request against `membership_branches`; Branch Managers cannot escape
their scope by URL manipulation. Booking creation is idempotency-keyed;
concurrent mutations remain server-authoritative.

## Testing / verification

Domain/action tests (authorization matrix, branch-scope denials, timeline
read-action gating, idempotency passthrough), RLS tests (no new policies —
regression only), UI smoke tests (nav visibility, context interplay,
safe-`next` regression), security tests (cross-branch URL access, permission
denials), a11y/responsive checks, hosted verification (no migration apply;
full Changes 1–9 hosted regression), typecheck/lint/build. No test may be
weakened to obtain green results.

## Documentation impact

* `docs/PROJECT_STRUCTURE.md` — routes map: bookings/customers move from
  "future consumer routes" to implemented.
* `docs/ADMIN_SYSTEM.md` — operational modules implemented (record update).
* `docs/ROADMAP.md` — §14/§16 implementation records.
* `docs/BOOKING_SYSTEM.md` — staff-UI surface note (§46 area).
* `docs/DOCUMENTATION_AUDIT.md` — Change 9 implementation follow-up entry.

## Acceptance criteria

1. A Branch Manager sees exactly their authorized branches' bookings; an HQ
   user switching branch context sees the selected branch's bookings.
2. A booking's detail shows customer, service, schedule, stored pricing
   snapshot, cancellation/amount-owed state and the staff timeline.
3. Staff can cancel and reschedule through the existing domain contracts with
   domain-returned outcomes (fee tiers, BD-3 rules) — no UI-side rule logic.
4. Staff can create a dashboard booking through the existing
   availability → quote → hold → confirm flow; duplicate submissions are
   absorbed by the domain's idempotency key.
5. Staff can list, view, edit customers and manage addresses via existing
   contracts; `contact_conflict_flag` is display-only.
6. Every route/action is permission-gated with the canonical catalog; RLS
   regression passes; no new policy or migration exists.
7. No Worker/Cleaner functionality is duplicated; booking↔job linkage is
   link-only.
8. Full local suite, hosted Change 9 verification and hosted Changes 1–9
   regression pass.
