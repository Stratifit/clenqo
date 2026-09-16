# Proposal: Scheduling & Availability

**Change ID:** `create-scheduling-availability`
**Status:** Draft (awaiting approval — do not implement)
**Roadmap phase:** Phase 1 — Availability (`ROADMAP.md` §11; exit criteria §17
require "website → service → availability → price → booking" without manual
database intervention)
**Priority:** P1 — branch activation cannot succeed while the operating-hours
readiness item is unsatisfiable (`features/branches/activation.ts` hardcodes
`operating_hours` as unsatisfied), and no customer booking flow can exist
without authoritative availability.

---

## Problem

The platform can provision branches (Change 1) and manage a service catalog
(Change 2), but nothing determines **when** a service can actually be
performed:

* `SCHEDULING_SYSTEM.md` (83 sections) fully specifies availability
  *principles* — branch operating hours, service windows, buffers, capacity,
  slot generation, holds, DST, concurrency — but no scheduling tables exist
  in migrations `0001–0008`, and no availability code exists.
* Branch operating hours are an activation prerequisite
  (`BRANCH_SYSTEM.md` §44–45) with **no data model anywhere**; the readiness
  checklist cannot ever pass.
* `DOCUMENTATION_AUDIT.md` **MEDIUM-9**: scheduling slot holds and booking
  draft/pending states overlap as reservation mechanisms with their
  relationship never stated — two overlapping reservation mechanisms could
  both be built.
* `DOCUMENTATION_AUDIT.md` **HIGH-2** (scheduling rows): slot holds and
  schedule infrastructure are absent from the `DATABASE.md` §64/§65 initial
  table inventory.
* The scheduling-vs-assignment responsibility boundary was ambiguous
  (`SCHEDULING_SYSTEM.md` §49 vs `WORKER_SYSTEM.md` §51).

## Motivation

Implement the **Scheduling & Availability** capability exactly as decided in
the approved decision record **S1–S18** (`SCHEDULING_SYSTEM.md` §84–86,
approved 2026-09): a deterministic, server-authoritative availability engine
so that

* the booking engine (future change) can present and confirm only slots
  CLENQO can realistically fulfill (§83 golden rule);
* branch activation readiness (`operating_hours`) becomes satisfiable;
* MEDIUM-9 is resolved in schema and code — exactly one reservation
  mechanism;
* the pricing engine (future change) can attach to a stable scheduling
  contract for duration consumption;
* recurring plans (Booking-phase change) can validate occurrences
  independently against real constraints.

## Scope

* **New capability** `scheduling-availability`:
  * Migration `0009` (structure, no seed content): branch operating hours
    (weekly effective-dated template), branch schedule exceptions (typed:
    closed / reduced_hours / blackout / holiday_override), branch scheduling
    configuration, service scheduling rules, slot holds.
  * Branch scheduling configuration domain: minimum notice (default 24 h),
    maximum advance (default 90 d), slot grid (default 15 min), operational
    buffer (default 15 min), travel buffer (default 30 min), concurrency cap
    (default 3), customer horizon (default 14 d), hold TTL (default 15 min).
  * Deterministic availability engine implementing the S18 pipeline:
    branch schedule → exceptions → offering gate → duration (via the Pricing
    Engine interface contract) → UTC materialization (S14 DST rules) →
    candidate grid → filters → customer-safe slots.
  * Slot holds per S1/S1b: scheduling-owned, session-scoped, idempotent,
    TTL-enforced (read-time + sweep), single active hold per session.
  * Booking-boundary validation primitive (slot feasibility check) for the
    future confirmation flow (S16 stage 3).
  * RLS on every new table, organization + branch scoped, following the
    Change 1/2 pattern.
  * Server Actions exposing the operations with the `Result<T>` envelope;
    authorization via existing `branches.view` / `branches.edit` /
    `services.view` only (S17 — no new permission names).
  * Transactional `resource.action` audit events (fail-closed), including
    `slot_held` / `slot_released` / `slot_consumed` and configuration
    mutations.
  * Seed/config mechanism (structure only): the S2b default operating hours
    and platform-default scheduling configuration, applied idempotently.
* **Documentation synchronization** (explicit obligation of this change):
  `DATABASE.md` §64/§65 field-level resolution (HIGH-2), `REQUIREMENTS.md`
  §18 verification, `DOCUMENTATION_AUDIT.md` finding closure, per the
  Change 2 synchronization precedent.

## Non-goals

* No pricing or duration **calculation** — duration is consumed through the
  Pricing Engine interface contract only; the pricing engine is a separate
  future change.
* No booking flow, booking state machine, or confirmation transaction
  (stage 5 of S16 belongs to the booking change; this change provides the
  stage-3 primitive).
* No employee/workforce tables, no employee-derived capacity (Phase 2).
* No skill-based availability filtering (S8 — assignment-time validation
  only, and no skills data exists yet).
* No recurring-plan CRUD — occurrence-validation foundation only (S11).
* No emergency booking path (S10), no override capability (S17).
* No overnight/cross-midnight services (S13 — model stays wrap-capable).
* No external holiday/calendar provider (S9b — manual exceptions only).
* No multi-cleaner teams, no route optimization, no live traffic.

## Dependencies

* **Change 1 `create-branch-provisioning` (archived)** — organizations/
  branches, identity, RLS helpers, audit, observability, migration/test
  infrastructure.
* **Change 2 `create-service-catalog` (archived)** — the offering gate:
  scheduling consumes `listEffectiveCatalog` bookability read-only; catalog
  rows are `branch_id NOT NULL` per-branch identities.
* **Approved decision record S1–S18** — `SCHEDULING_SYSTEM.md` §84–86.
* **Pricing Engine interface contract** — duration consumption is designed
  here and implemented by the future pricing change (contract-first
  sequencing decision, see design.md §3).

## Domain relationship boundaries

| Domain | Consumes from this change | Provides to this change |
|---|---|---|
| **Service Catalog** (Change 2, live) | — | Bookability conjunction (`listEffectiveCatalog`); stable catalog identities |
| **Pricing Engine** (future change) | Slot feasibility primitive | Authoritative duration (minutes) via interface contract |
| **Booking** (future change) | Availability re-check primitive; hold consumption semantics; recurring-occurrence validation | Confirmation transaction (S16 stage 5); recurring plans |
| **Workers** (Phase 2) | Feasibility-filtered candidate set (§85 boundary) | Employee availability; skills (assignment-time only, S8) |
| **Notifications** (future) | Scheduling events | Delivery of customer/cleaner messages |

Scheduling owns availability calculation, schedule constraints, slot
generation, conflicts, and holds (§81). It never prices, never selects a
worker, never owns booking state.

## Impact

* **Affected specs:** new capability spec
  `openspec/specs/scheduling-availability/spec.md` (created on archive).
* **Affected code areas (future):** `features/scheduling/` (schemas,
  service, actions), migrations `0009+`, RLS additions, admin UI for
  scheduling configuration.
* **Affected docs (synchronized during this authorship round):**
  `SCHEDULING_SYSTEM.md` §56/§79/§84–86; `DATABASE.md` §64/§65;
  `REQUIREMENTS.md` §18; `DOCUMENTATION_AUDIT.md` (MEDIUM-9, HIGH-2
  scheduling rows, new S17 finding); `BOOKING_SYSTEM.md` §19;
  `SECURITY.md` open-decision note. Field-level `DATABASE.md` §11.1-companion
  updates land with implementation, per the Change 2 precedent.
