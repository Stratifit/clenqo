# Booking

**Capability:** `booking`
**Status:** Active capability
**Established by:** `openspec/archive/create-booking/` (implemented 2026-09-17, commit `4220eb7`; hosted Supabase verification 11/11 PASS, full hosted suite 65/65 PASS)
**Sources:** `BOOKING_SYSTEM.md` §21/§29–30/§63, `REQUIREMENTS.md` BK-002/BK-005/BK-006, `DATABASE.md` §17/§18/§65, `SCHEDULING_SYSTEM.md` S1, `PRICING_ENGINE.md` §82, `SECURITY.md`, `SECURITY_PRIVACY.md` §29–33, `NOTIFICATION_SYSTEM.md`, `API_STANDARDS.md`, `PAYMENT_SYSTEM.md`

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.
Requirement wording is normative and testable; WHEN/THEN scenarios are
acceptance criteria. The authoritative V1 decision record is BD-1–BD-6
(plus B-NEW-1). Jobs/Worker, payment collection, customer messaging, and
recurring bookings remain outside this capability.

## Requirement: Server-authoritative booking creation
Bookings SHALL be created only through server-side validation (BK-005, BOOKING_SYSTEM §21): catalog sellability, service-area eligibility, authoritative availability, and authoritative pricing. Client-supplied prices or availability SHALL never be trusted.

#### Scenario: Client price ignored
* **WHEN** a submitted `accepted_total_minor` differs from the server-recalculated quote total
* **THEN** confirmation fails with a stable price-changed error and no booking is persisted

## Requirement: Single temporary reservation mechanism
Capacity during checkout SHALL be reserved only by scheduling-owned slot holds (S1); booking drafts SHALL never block capacity; confirmation SHALL consume a valid unexpired hold atomically with booking creation.

#### Scenario: Failed confirmation releases capacity
* **WHEN** the confirmation transaction fails or rolls back
* **THEN** no booking row exists and the hold is released/expired without blocking capacity

## Requirement: Idempotent confirmation
Duplicate confirmation submissions with the same idempotency key SHALL return the original result without duplicate bookings, holds, or events (BOOKING_SYSTEM §63).

#### Scenario: Replayed confirmation
* **WHEN** a successful confirmation request is retried with the same key
* **THEN** the original booking is returned and no new rows are created

## Requirement: Booking number
Each confirmed booking SHALL carry a human-readable number `CLN-<year>-<sequence>` unique per organization, database-enforced (BD-5); the UUID remains the internal identifier.

#### Scenario: Concurrent confirmations
* **WHEN** two bookings confirm simultaneously in one organization
* **THEN** they receive distinct sequential numbers and both commits succeed

## Requirement: Customer identity without accounts
Customers SHALL book without accounts (BK-002); identity SHALL be resolved by normalized email then normalized phone (BD-4); uniqueness SHALL be organization-wide; on conflicting contact details the stored canonical values SHALL be kept and the conflict flagged for staff resolution.

#### Scenario: Returning customer with changed phone
* **WHEN** a booking arrives with a matching email but a different phone than stored
* **THEN** the booking uses the stored customer record, the stored phone remains unchanged, and the conflict is flagged and auditable

## Requirement: Service-area eligibility
A booking SHALL be rejected when the service address postal code is not in the branch's configured allowlist (BD-6); the allowlist SHALL be branch-managed via the existing `branches.edit` permission.

#### Scenario: Outside area
* **WHEN** the address postal code is not allowlisted for the branch
* **THEN** the booking cannot proceed and a stable error is returned before any hold is created

## Requirement: Authoritative pricing snapshot
Confirmed bookings SHALL store `pricing_version_id` and the canonical immutable pricing snapshot (DATABASE §16.3); historical bookings SHALL never be recalculated with current pricing rules.

#### Scenario: Pricing rules change after confirmation
* **WHEN** pricing configuration changes after a booking is confirmed
* **THEN** the confirmed booking's stored snapshot and totals remain unchanged

## Requirement: Cancellation policy application
Customer cancellation SHALL be prohibited at/after `scheduled_start` (BD-2.5); windows SHALL be measured from `scheduled_start` with tiers [24,∞) 0% / [12,24) 25% / [2,12) 50% / [0,2) 100% (exactly-24h→0%, exactly-12h→25%, exactly-2h→50%); the fee SHALL equal the tier percentage of the immutable snapshot total (tax included, tips excluded), half-up rounded to the currency minor unit, from the policy snapshot captured at confirmation.

#### Scenario: Exactly 2 hours notice
* **WHEN** a customer cancels exactly 2 hours before `scheduled_start`
* **THEN** the 50% tier applies

#### Scenario: Post-start customer cancellation
* **WHEN** `now >= scheduled_start` and a customer requests cancellation
* **THEN** the request is rejected; the post-start operational outcome is `no_show`

## Requirement: Unpaid cancellation fee outcome
When a cancelled booking with a non-zero fee has not paid (V1 default: payment after completion), the fee SHALL be recorded as an amount owed by the customer (BD-2.6); the collection mechanism SHALL remain a Payment-domain concern.

#### Scenario: Fee on unpaid booking
* **WHEN** a 25%-tier cancellation occurs on a never-paid booking
* **THEN** the booking records the computed fee as amount owed and no payment call is made

## Requirement: Cancellation-fee override authorization
Waiving or reducing a calculated cancellation fee SHALL require the dedicated `bookings.override` permission (HQ Admin only in V1) and SHALL be audited with actor, timestamp, booking, original fee, final fee, and reason (BD-2.4).

#### Scenario: Branch manager attempts override
* **WHEN** a branch manager attempts a fee override
* **THEN** the action is denied by authorization before any mutation

## Requirement: Rescheduling rules
Rescheduling SHALL be V1 for customers (magic link) and staff; SHALL be permitted only from `confirmed`/`assigned`; customer requests SHALL be at least 2 hours before the current `scheduled_start`; the target slot SHALL satisfy the full 24-hour minimum-notice rule (no same-day targets); rescheduling SHALL be free (cancellation tiers never applied) and unlimited; the cancellation window SHALL thereafter be measured from the new `scheduled_start`; price increases SHALL commit only after explicit customer acceptance while decreases SHALL apply automatically; each reschedule SHALL produce a new authoritative pricing snapshot preserving the prior one; `booking_rescheduled` SHALL remain an event, not a status (BD-3).

#### Scenario: Same-day target rejected
* **WHEN** a customer requests a target slot violating the 24-hour minimum-notice rule
* **THEN** the reschedule is rejected with a stable error and the booking is unchanged

#### Scenario: Higher price requires acceptance
* **WHEN** the recalculated target price is higher than the current booking total
* **THEN** the reschedule commits only after the customer explicitly accepts the new price

#### Scenario: Original booking preserved on failure
* **WHEN** any step of the reschedule transaction fails
* **THEN** the booking keeps its original interval, totals, and pricing snapshot

## Requirement: Magic-link customer access
Magic-link tokens SHALL be unpredictable, stored only as hashes, single-use, expiring, scoped to exactly one booking, revocable, and rate-limited; public endpoints SHALL NOT reveal booking/customer existence (SECURITY_PRIVACY §29–33).

#### Scenario: Replayed token
* **WHEN** a consumed token is presented again
* **THEN** verification fails without revealing whether the booking exists

## Requirement: Organization and branch isolation
All booking tables SHALL enforce organization + branch RLS using the established policy pattern; branch-scoped roles SHALL only access their membership branches; magic-link access SHALL never cross customers or bookings.

#### Scenario: Cross-branch staff access
* **WHEN** a branch-scoped user queries bookings of another branch
* **THEN** no rows are returned

## Requirement: Transactional fail-closed audit
Booking mutations SHALL write audit records transactionally with the business change (AUDIT_SYSTEM §50); audit failure SHALL abort the operation; booking events SHALL be append-only.

#### Scenario: Audit write failure
* **WHEN** the audit insert fails during confirmation
* **THEN** the entire confirmation rolls back and no booking exists

## Requirement: Booking → job handoff only
Change 5 SHALL create no jobs, employees, or assignment structures (TD-1); the confirmed booking SHALL be the idempotent source from which the Worker change later creates jobs; Booking SHALL never select workers.

#### Scenario: No job rows
* **WHEN** a booking is confirmed
* **THEN** no job table or row is created by the Booking domain

## Requirement: No customer messaging in V1
The Booking Hub "Contact CLENQO" element SHALL present branch contact information only; no message storage or conversation threads SHALL exist (B-NEW-1).

#### Scenario: Hub contact
* **WHEN** a customer opens Contact CLENQO in the Booking Hub
* **THEN** branch contact details are shown and no message record is created
