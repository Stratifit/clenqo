# Design: Scheduling & Availability

**Change ID:** `create-scheduling-availability`
**Status:** Documentation/design only — **no implementation has occurred**.
This document and `spec.md` are the Change 3 contract; migration 0009,
`features/scheduling/`, and tests are created only after this change is
approved and BUILD MODE begins.

**Normative source:** the approved decision record **S1–S18**
(`SCHEDULING_SYSTEM.md` §84–86, approved 2026-09), reproduced in §8 of this
document. Where this document and the decision record differ, the decision
record wins.

---

## 1. Current implementation status (verified 2026-09-16)

| Area | Status |
|---|---|
| Organizations / branches / identity / RLS helpers / audit | **Implemented** (Change 1, archived) |
| Service catalog (per-branch rows, offering flags, compatibility, aliases) | **Implemented** (Change 2, archived) |
| Branch operating hours, schedule exceptions, scheduling config, slot holds | **Specified but not implemented** (`SCHEDULING_SYSTEM.md` §84–86; no tables in migrations 0001–0008) |
| Availability engine / slot generation | **Specified but not implemented** (`SCHEDULING_SYSTEM.md` §2–§23, §83) |
| Pricing Engine (authoritative duration) | **Not implemented** — future change; consumed here via interface contract only |
| Workforce (employees, skills, availability) | **Not implemented** — Phase 2 per `ROADMAP.md` §19; no employee tables exist |

Key architectural facts this design builds on:

* Branch rows carry `timezone` (`DATABASE.md` §11.1); Change 1 provisions
  them with locale/currency configuration.
* The catalog read model `listEffectiveCatalog(branchId, { locale,
  customerVisibleOnly })` is the authoritative bookability conjunction
  (Change 2 spec) — scheduling must consume it, never re-decide offering.
* The audit service writes transactional, fail-closed `resource.action`
  events (Change 1 pattern, `AUDIT_SYSTEM.md` §50/§101).
* The activation readiness checklist hardcodes `operating_hours` as
  unsatisfiable (`features/branches/activation.ts`) — this change must make
  the item satisfiable via real branch operating-hours rows.

## 2. Domain model

New tables (conceptual here; exact SQL written at implementation, per
OpenSpec rules). All follow the Change 1 conventions: UUID PKs via
`gen_random_uuid()`, `timestamptz` UTC timestamps, `organization_id` +
`branch_id NOT NULL` on every row (Q9 pattern), FKs to `branches`, RLS
enabled in the creation migration, no FORCE.

### 2.1 `branch_operating_hours` (S2)

```text
id                  uuid pk
organization_id     uuid fk organizations
branch_id           uuid fk branches, NOT NULL
weekday             smallint CHECK 0–6 (0 = Sunday, branch-local)
interval_index      smallint CHECK >= 0
start_time          time (branch-local wall clock)
end_time            time (branch-local wall clock)
effective_from      date, NOT NULL
effective_until     date, NULL (open-ended)
created_at / updated_at
```

* Multiple intervals per weekday allowed (`interval_index` orders them).
* Closed day = no rows for that weekday (in the effective period).
* Weekly template with `end_time <= start_time` rejected for V1
  (S13 — no overnight; the model remains wrap-capable for the future).
* Historical periods are never mutated: changes create new effective-dated
  rows (S2 immutability rule, `SCHEDULING_SYSTEM.md` §74).
* `unique (branch_id, weekday, interval_index, effective_from)`.

### 2.2 `branch_schedule_exceptions` (S9)

```text
id                  uuid pk
organization_id     uuid fk organizations
branch_id           uuid fk branches, NOT NULL
exception_type      text CHECK ('closed','reduced_hours','blackout','holiday_override')
start_date          date, NOT NULL
end_date            date, NOT NULL (>= start_date; single day = equal)
intervals           jsonb, NULL (reduced_hours: alternate intervals for the date(s))
reason              text, NULL
created_at / updated_at
```

* Exceptions override the weekly template (`SCHEDULING_SYSTEM.md` §31–32).
* V1 source is manual branch entry only (S9b) — no calendar provider.
* `intervals` content is validated by Zod at the domain layer (never an
  unstructured blob — `DATABASE.md` §46 rule).
* Overlapping same-type exception ranges are rejected in the domain layer.

### 2.3 `branch_scheduling_configuration` (S4–S7, S12, S1b)

```text
id                          uuid pk
organization_id             uuid fk organizations
branch_id                   uuid fk branches, NOT NULL, UNIQUE
minimum_notice_minutes      integer, default 1440 (24 h, S4)
maximum_advance_days        integer, default 90 (S5)
slot_grid_minutes           integer, default 15 (S3/S3b)
operational_buffer_minutes  integer, default 15 (S6b)
travel_buffer_minutes       integer, default 30 (S6b)
concurrency_cap             integer, default 3 (S7/S7b)
customer_horizon_days       integer, default 14 (S12)
hold_ttl_minutes            integer, default 15 (S1b)
created_at / updated_at
```

* One row per branch (upserted at provisioning/seed time with platform
  defaults — `SCHEDULING_SYSTEM.md` §86 is the normative value source).
* `concurrency_cap >= 1`; buffers/grids/notice validated positive; grid
  divides evenly into 60 (deterministic alignment).
* Mutable with audit (`branch_scheduling.updated`); changes never rewrite
  historical records (§74).

### 2.4 `service_scheduling_rules` (S18 step 3)

```text
id                  uuid pk
organization_id     uuid fk organizations
branch_id           uuid fk branches, NOT NULL
service_id          uuid fk services, NOT NULL (Change 2 identity)
weekday             smallint, NULL (NULL = every day the branch is open)
start_time          time, NULL (NULL = branch operating window)
end_time            time, NULL
created_at / updated_at
```

* Scheduling-specific constraints only — **MUST NOT become a second
  pricing/duration authority** (duration stays Pricing-owned, S6).
* Optional in V1: a service without rows inherits the branch operating
  window (§9–10 relationship, `SCHEDULING_SYSTEM.md`).
* `unique (branch_id, service_id, weekday, start_time)`.

### 2.5 `slot_holds` (S1/S1b)

```text
id                  uuid pk
organization_id     uuid fk organizations
branch_id           uuid fk branches, NOT NULL
service_id          uuid fk services, NOT NULL
start_time          timestamptz, NOT NULL (absolute UTC)
end_time            timestamptz, NOT NULL (start + duration + buffers)
session_id          text, NOT NULL (checkout session identifier)
idempotency_key     text, NOT NULL
status              text CHECK ('held','consumed','released','expired')
expires_at          timestamptz, NOT NULL (created_at + hold TTL)
consumed_by_booking uuid, NULL (set atomically at confirmation — booking change)
created_at / updated_at
```

* The **single** capacity-blocking reservation mechanism in V1 (S1 —
  resolves MEDIUM-9). Booking drafts never block.
* Exactly one active (`held`) hold per session (partial unique index).
* Idempotent creation: repeat calls with the same `idempotency_key` return
  the existing hold.
* Expiry enforced by read-time validity checks (any consumer ignores/expires
  `held` rows past `expires_at`) **plus** a periodic sweep that transitions
  stale rows to `expired` (simplest reliable mechanism, `ARCHITECTURE.md`
  §41 — no distributed queue).
* `start_time`/`end_time` are absolute UTC instants — cross-midnight
  representable (S13 wrap-capable), comparisons TZ-safe.

## 3. Pricing Engine interface contract (duration)

Scheduling never calculates duration (S6, §81, `PRICING_ENGINE.md` §13).
Change 3 defines the seam; the pricing change implements it:

```ts
/** Returns the authoritative estimated duration in whole minutes (PRICING_ENGINE §14). */
interface DurationProvider {
  getEstimatedDuration(selection: {
    branchId: string;
    serviceId: string;
    variantId?: string;
    addons?: { addonId: string; quantity: number }[];
  }): Promise<number>; // minutes, integer >= 1
}
```

* The availability engine receives the provider as an injected dependency.
* Until the pricing change lands, a design-time adapter may return a
  configuration-sourced estimate — explicitly a placeholder, deleted when
  the real provider arrives (two duration authorities are forbidden).
* Unit is minutes everywhere (PRICING_ENGINE §14; buffers in the same unit).

## 4. Availability pipeline (S18 — normative)

Deterministic, pure, pricing-free:

```text
1. Read branch schedule/configuration.
2. Apply schedule exceptions (override the weekly template).
3. Resolve service offering (catalog bookability conjunction) and
   applicable service scheduling rules (fallback: branch window).
4. Obtain authoritative duration from the Pricing Engine interface contract.
5. Materialize local intervals into UTC using deterministic DST-safe rules
   (S14).
6. Generate candidate starts on the configured grid (S3).
7. Filter by: minimum notice (S4), maximum advance (S5), customer-facing
   horizon (S12), occupied intervals (committed bookings/jobs + active
   holds + buffers, S6), capacity (S7).
8. Return customer-safe slots (start/end/timezone/available) without
   exposing internal workforce details or performing pricing calculations.
```

Determinism contract: same inputs (configuration + state snapshot) ⇒ same
slot list. No randomness, no wall-clock dependence inside the computation
(now() is an input, never a side effect).

## 5. DST rules (S14 — normative)

* Branch timezone (IANA) is authoritative; storage is UTC.
* Local intervals are materialized **per date** into UTC instants before any
  comparison.
* Spring-forward nonexistent local times: recurring weekly configuration
  containing a nonexistent local time is rejected at configuration time;
  concrete candidate starts falling into a nonexistent local time on a
  specific date are skipped (no slot generated).
* Fall-back ambiguous local times: resolve to the **earlier (first)
  occurrence** — one rule, applied in slot generation, holds, bookings, and
  recurring expansion.
* Test cases for spring and autumn transitions are mandatory
  (`SCHEDULING_SYSTEM.md` §77).

## 6. Confirmation concurrency boundary (S16)

Change 3 implements stages 3–4 (and the stage-5 re-check primitive); the
booking change owns stage 5's transaction:

```text
1. Validate request.
2. Read effective catalog offering.
3. Authoritative availability engine re-computation.
4. Create/validate slot hold.
5. One transaction: final availability re-check (holds + committed bookings
   + capacity) → consume hold → create booking + items + pricing snapshot +
   booking event + job → audit events → commit.
6. After commit: notifications/outbox, cache invalidation, async side effects.
```

Double-booking protection: transactional re-check **plus** a DB-level
constraint over committed occupancy and `held` holds against the
concurrency cap (exact mechanism — partial exclusion/unique constraint vs
advisory lock — fixed at implementation with tests proving the race).
Idempotency keys on hold creation and confirmation.

## 7. Authorization & audit

* **Permissions (S17):** configuration and read operations use the existing
  `branches.view` / `branches.edit`; offering-dependent reads use
  `services.view` (Change 2 pattern). **No new permission names.** Override
  capability: deferred (see `SECURITY.md` open decision) — not implemented.
* Public customer slot querying follows the public booking flow posture
  (unauthenticated reads of availability results only; no internals, §25–26).
* **Audit:** transactional, fail-closed, redacted metadata, request IDs
  (established pattern). Events: `branch_operating_hours.created/updated`,
  `branch_schedule_exception.created/updated/removed`,
  `branch_scheduling.updated`, `service_scheduling_rule.created/updated`,
  `slot_held`, `slot_released`, `slot_consumed`, `slot_expired` (sweep).
* **RLS:** every new table; HQ roles org-wide, branch roles via
  `membership_branches`; owner-exemption pattern, no FORCE (Change 1/2
  precedent). Hosted verification extends the `HOSTED_VERIFY=1` suite.

## 8. Decision record annex (approved 2026-09 — normative)

| ID | Decision |
|---|---|
| S1 | Reservation mechanism = scheduling-owned temporary slot hold. Draft is non-blocking. No persisted blocking pending booking. Hold consumed by confirmation. One active hold per session. Idempotent. Read-time expiry + periodic sweep. Final confirmation re-checks availability transactionally. |
| S1b | Hold TTL default **15 minutes**, configurable per branch; read-time validity + periodic sweep. |
| S2 | Operating hours: relational weekly template (branch, weekday, interval index, local start/end, effective_from, effective_until); multiple intervals/day; exceptions override; historical schedules immutable. |
| S2b | Seed defaults: Mon–Fri 08:00–18:00; Sat 09:00–14:00; Sun closed. Per-branch configurable. |
| S3/S3b | Slot grid default **15 minutes**, per-branch configurable. |
| S4 | Minimum notice default **24 hours**, per-branch configurable. |
| S5 | Maximum advance booking window default **90 days**, per-branch configurable. |
| S6 | Service duration owned by the Pricing Engine; scheduling consumes via interface contract. Operational and travel buffers separate from duration. |
| S6b | Operational buffer **15 min**; travel buffer **30 min**. Per-branch configurable. |
| S7/S7b | V1 capacity = branch-level concurrency cap, default **3 concurrent jobs**; workforce-derived capacity deferred to Phase 2. |
| S8 | No skill-based availability filtering in V1; skills validated at assignment time only. |
| S9/S9b | Unified typed schedule exceptions (closed / reduced_hours / blackout / holiday_override); manual branch entry in V1; no calendar provider. |
| S10 | Same-day only when the 24-hour notice is satisfied; emergency bookings disabled in V1. |
| S11 | Recurring-plan rules deferred to the Booking phase; Change 3 provides occurrence-validation foundation only; occurrences never silently created invalid. |
| S12 | Max advance 90 days; customer-facing availability query horizon default **14 days**; internal scheduling horizon distinct. |
| S13 | No overnight bookings in V1 (complete within one branch-local calendar day); data model wrap-capable. |
| S14 | Deterministic DST: reject nonexistent recurring config times; skip nonexistent concrete candidates; first occurrence on fall-back; materialize UTC before comparison. |
| S15 | Boundary: "Scheduling answers whether the requested work can be performed in the requested interval from branch, service, capacity, and conflict constraints — it counts eligible resources but never selects one. Assignment answers which eligible, available worker is chosen to perform it — it may rank and select only among candidates Scheduling has already established as feasible; neither domain performs the other's question." |
| S16 | Six-stage confirmation sequence (§6 above) with transactional final re-check, hold consumption, DB-level protection, idempotency. |
| S17 | Configuration via existing `branches.view`/`branches.edit`; no new scheduling permission; override deferred to a later dedicated security decision. |
| S18 | Eight-step deterministic availability pipeline (§4 above); no pricing/duration calculation inside scheduling. |

## 9. Testing strategy

* **Migration/constraint suite** (pglite, `tests/db/`): chain 0001→0009
  applies cleanly; CHECKs, UNIQUEs, effective-date semantics, hold status
  transitions, partial unique index for one-hold-per-session.
* **RLS suite** (pglite + hosted extension): org invisibility, branch-scope
  enforcement, definer-helper compatibility, manipulated-ID rejection.
* **Domain suite** (`tests/domain/`): slot generation determinism (incl. DST
  spring/autumn, split shifts, closed days, exceptions precedence), filters
  (notice/advance/horizon), capacity math, hold lifecycle (idempotency,
  single-hold, TTL expiry, release), authorization boundaries, audit
  pairing, duration-contract injection (no pricing leakage).
* **Hosted suite** (`tests/hosted/`, skipped by default, `HOSTED_VERIFY=1`):
  real Auth, real RLS as real roles, transactional audits, constraint races.
* Quality gates: `npm test` / `npm run lint` / `npm run typecheck` /
  `npm run build`.
