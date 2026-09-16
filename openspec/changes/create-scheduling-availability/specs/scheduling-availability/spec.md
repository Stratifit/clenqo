# Requirements: Scheduling & Availability

**Change ID:** `create-scheduling-availability`

Capability: `scheduling-availability` (new). All requirements derive from the
approved decision record S1–S18 (`SCHEDULING_SYSTEM.md` §84–86, 2026-09) and
the source documents (`SCHEDULING_SYSTEM.md`, `DATABASE.md`, `BOOKING_SYSTEM.md`,
`SERVICE_CATALOG.md`, `PRICING_ENGINE.md`, `SECURITY.md`, `API_STANDARDS.md` §28).
Requirement wording below is normative and testable; WHERE/THEN scenarios are
acceptance criteria.

## ADDED Requirements

### Requirement: Deterministic server-authoritative availability

The system SHALL compute availability server-side as a deterministic function
of branch configuration and operational state (S18). Same inputs SHALL
produce the same slot list. Client-side availability data SHALL be treated as
informational only; the authoritative result is always recomputed on the
server (SCHEDULING_SYSTEM §4, §83).

#### Scenario: Deterministic slot list

* **WHEN** the availability engine runs twice with identical configuration
  and state inputs
* **THEN** both runs return an identical slot list (no randomness, no
  wall-clock side effects inside the computation)

#### Scenario: Client data never trusted

* **WHEN** a confirmation-time feasibility check is requested with
  client-supplied slot data
* **THEN** the server recomputes availability from authoritative state and
  ignores client-side results

### Requirement: Catalog offering gate

Scheduling SHALL consume the effective catalog bookability conjunction
(`listEffectiveCatalog`) read-only when resolving service offering (S18
step 3). Scheduling SHALL NOT duplicate catalog data, re-decide offering
state, or modify catalog rows.

#### Scenario: Disabled service produces no slots

* **WHEN** a service is not in the branch's effective catalog (disabled or
  not active)
* **THEN** the availability engine returns no slots for that service

#### Scenario: Catalog change reflected without scheduling mutation

* **WHEN** a branch disables a service in the catalog
* **THEN** that service disappears from availability results without any
  scheduling-configuration change

### Requirement: Temporary slot holds are the single reservation mechanism

The V1 temporary capacity-blocking reservation mechanism SHALL be the
scheduling-owned slot hold (S1). A hold SHALL be created only after a real
availability check. A session SHALL have at most one active hold. Hold
creation SHALL be idempotent per idempotency key. Booking drafts SHALL NOT
block capacity, and no persisted blocking `pending` booking state SHALL
exist in V1. Audit events `slot_held` / `slot_released` / `slot_consumed`
SHALL be written transactionally.

#### Scenario: Hold created after availability check

* **WHEN** a hold is requested for a slot
* **THEN** the hold is created only if the authoritative availability engine
  confirms the slot, and `slot_held` is audited transactionally

#### Scenario: One active hold per session

* **WHEN** a session requests a second hold while one is active
* **THEN** the request is rejected (or replaces only per documented
  semantics) — two active holds for one session never exist

#### Scenario: Draft bookings do not block

* **WHEN** a booking exists only in draft state
* **THEN** it contributes nothing to occupancy or capacity

### Requirement: Hold TTL and expiry

Hold TTL SHALL default to 15 minutes and be configurable per branch (S1b).
Expiry SHALL be enforced by read-time validity checks plus a periodic sweep.
Expired and released holds SHALL restore capacity and SHALL NOT block.

#### Scenario: Expired hold releases capacity

* **WHEN** a held slot passes its `expires_at` and a new availability query
  runs (or the sweep executes)
* **THEN** the hold no longer blocks capacity and the slot is offerable
  again

#### Scenario: Abandoned checkout creates no booking

* **WHEN** a checkout session is abandoned with an active hold
* **THEN** the hold expires by TTL, no booking row is created, and capacity
  is fully restored

### Requirement: Atomic hold consumption at confirmation

Confirmation SHALL consume the valid hold atomically with booking creation
inside one transaction, after a final authoritative availability re-check
including holds, committed bookings, and capacity (S16 stages 4–5). If the
re-check fails, the transaction SHALL abort leaving no partial state.

#### Scenario: Confirmation consumes hold atomically

* **WHEN** booking confirmation succeeds with a valid hold
* **THEN** the hold is `consumed`, the booking and required audit events
  exist in the same committed transaction, and the hold can never be
  consumed twice

#### Scenario: Confirmation race rejects the loser

* **WHEN** two sessions confirm conflicting capacity simultaneously
* **THEN** exactly one succeeds; the other aborts with a stable conflict
  error and its hold is released (DB-level protection plus transactional
  re-check)

### Requirement: Branch concurrency capacity

V1 capacity SHALL be a branch-level configured concurrency cap (S7/S7b,
default 3, per-branch configurable). A slot SHALL be offerable only when the
number of concurrently occupied intervals (committed bookings/jobs plus
active holds) within the buffered interval is below the cap. Employee-derived
capacity SHALL NOT be implemented in this change.

#### Scenario: Cap respected

* **WHEN** concurrent occupancy equals the configured cap
* **THEN** additional overlapping slots are not offered

#### Scenario: Buffers count toward occupancy

* **WHEN** a job's buffered interval (operational + travel buffers, S6b)
  overlaps a candidate slot
* **THEN** the candidate is treated as occupied for capacity evaluation

### Requirement: Deterministic DST handling

Timezone handling SHALL be deterministic (S14): branch IANA timezone
authoritative, storage in UTC, local intervals materialized per date before
comparison. Nonexistent spring-forward recurring local times SHALL be
rejected at configuration time; nonexistent concrete candidate starts SHALL
be skipped; ambiguous fall-back local times SHALL resolve to the earlier
(first) occurrence.

#### Scenario: Spring-forward candidate skipped

* **WHEN** a candidate start falls into a nonexistent local time on a
  spring-forward date
* **THEN** no slot is generated for that start time

#### Scenario: Fall-back ambiguity resolved deterministically

* **WHEN** a configured local time occurs twice on a fall-back date
* **THEN** the earlier occurrence is used everywhere (slots, holds,
  bookings)

### Requirement: Branch scheduling configuration

Each branch SHALL own its scheduling configuration (S2–S7, S12, S1b):
minimum notice (default 24 h), maximum advance (default 90 d), slot grid
(default 15 min), operational buffer (15 min), travel buffer (30 min),
concurrency cap (3), customer horizon (14 d), hold TTL (15 min). Platform
defaults SHALL be applied idempotently per branch. Configuration mutations
SHALL be audited and SHALL NOT rewrite historical records.

#### Scenario: Defaults applied idempotently

* **WHEN** the default-configuration seed runs twice for a branch
* **THEN** row counts and values are identical to a single run and match §86

#### Scenario: Notice enforced from configuration

* **WHEN** a slot start is earlier than the branch minimum notice from now
* **THEN** the slot is not offered

### Requirement: Branch isolation and RLS

Every new scheduling table SHALL have Row Level Security enabled from its
creation migration, enforcing organization scope for HQ roles and branch
scope via `membership_branches` for branch-scoped roles, reusing the
established SECURITY DEFINER helpers and owner-exemption pattern (no FORCE).
A user of one organization SHALL never observe another organization's
scheduling data.

#### Scenario: Cross-organization invisibility

* **WHEN** a user of organization A queries scheduling rows of organization B
  with known IDs
* **THEN** no rows are returned (RLS)

#### Scenario: Branch roles confined to their branch

* **WHEN** a branch manager of branch A reads or mutates branch B's
  scheduling configuration
* **THEN** the request is rejected or invisible via RLS

### Requirement: Transactional audit for scheduling mutations

Every scheduling mutation SHALL write `resource.action` audit events
transactionally with the state change (fail-closed): operating-hours,
exception, configuration, and service-rule mutations, plus the hold
lifecycle events. Records SHALL carry actor, organization, branch, resource,
action, request ID, and bounded redacted metadata.

#### Scenario: Configuration mutation audited

* **WHEN** a branch manager updates the branch concurrency cap
* **THEN** a `branch_scheduling.updated` audit event exists in the same
  transaction with actor, request ID, and changed fields

#### Scenario: Hold lifecycle audited

* **WHEN** a hold is created, released, or consumed
* **THEN** the corresponding `slot_held` / `slot_released` /
  `slot_consumed` event exists transactionally

### Requirement: Authorization uses the existing permission catalog

All scheduling operations SHALL enforce server-side authorization using only
existing permissions: `branches.view` / `branches.edit` for configuration
(S17), `services.view` for offering-dependent reads. No new permission names
SHALL be introduced. The override capability of SCHEDULING_SYSTEM §56 SHALL
NOT be implemented (deferred security decision).

#### Scenario: Branch Manager configures own branch only

* **WHEN** a branch manager sets operating hours for their branch with
  `branches.edit`
* **THEN** the operation succeeds and is audited

#### Scenario: No override capability exists

* **WHEN** any user attempts a scheduling-constraint override action
* **THEN** no such operation exists in the API surface

### Requirement: No pricing or duration calculation in scheduling

Scheduling SHALL consume authoritative duration in minutes through the
Pricing Engine interface contract (S6) and SHALL NOT contain pricing
calculation, rates, or a second duration authority. Availability results
SHALL contain no pricing data (§25).

#### Scenario: Duration injected, never computed

* **WHEN** the availability engine resolves a slot interval
* **THEN** the duration comes from the injected `DurationProvider`, and no
  scheduling table or code path derives price or duration rules

#### Scenario: Customer-safe result shape

* **WHEN** availability results are returned to a customer surface
* **THEN** they contain start, end, timezone, and availability only — no
  employee internals, no pricing values

### Requirement: Historical schedule immutability

Changes to operating hours, exceptions, or configuration SHALL NOT rewrite
historical operational records (S2, SCHEDULING_SYSTEM §74). Operating-hours
changes SHALL be expressed through effective dating, not mutation of past
periods.

#### Scenario: Completed jobs unaffected by hours change

* **WHEN** a branch changes its operating hours after jobs completed
* **THEN** the historical job schedules remain exactly as recorded

### Requirement: V1 scope exclusions

V1 SHALL NOT implement: skill-based availability filtering (S8),
overnight/cross-midnight services (S13), emergency booking (S10),
employee-derived capacity (S7), recurring-plan CRUD (S11), override
capability (S17), and external holiday-calendar providers (S9b). The data
model SHALL remain wrap-capable for future overnight support, and
occurrence validation SHALL be usable by the future recurring flow.

#### Scenario: Cross-midnight service rejected in V1

* **WHEN** an operating-hours or service-window configuration declares an
  end time at or before its start time
* **THEN** the configuration is rejected (no-wrap rule)

#### Scenario: No skill filtering in availability

* **WHEN** slots are generated for a branch whose cleaners lack a particular
  skill
* **THEN** availability is unaffected (skills apply at assignment time only)

#### Scenario: Occurrence validation available without plan CRUD

* **WHEN** a future recurring flow needs to validate an occurrence
* **THEN** the feasibility primitive accepts an arbitrary future start and
  evaluates it against current constraints without any recurring-plan
  dependency

## Test/verification requirements (applies to the capability)

* Migration chain (0009) applies cleanly to a fresh database; constraints,
  uniquenesses, and RLS verified by automated tests (pglite).
* DST spring/autumn transitions and concurrency races covered by dedicated
  test cases (SCHEDULING_SYSTEM §76–78).
* Hosted Supabase verification is specified as a later implementation task
  (tasks.md §13, `HOSTED_VERIFY=1`) and is NOT executed during design
  approval.
