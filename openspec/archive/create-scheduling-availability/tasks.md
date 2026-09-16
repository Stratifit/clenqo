# Tasks: Scheduling & Availability

**Change ID:** `create-scheduling-availability`

Ordered so verification is possible at every step. No task starts before its
dependencies are complete. All checkboxes start unchecked — they are ticked
only after the corresponding implementation and verification actually succeed.

## 1. Database / schema alignment (design first, then SQL)

- [x] 1.1 Confirm target schema against `SCHEDULING_SYSTEM.md` §86 and
      design §2: `branch_operating_hours`, `branch_schedule_exceptions`,
      `branch_scheduling_configuration`, `service_scheduling_rules`,
      `slot_holds` — all with `organization_id` + `branch_id NOT NULL` (Q9
      pattern), CHECKs, natural-key UNIQUEs, effective-dating columns
- [x] 1.2 Confirm the duration seam: `DurationProvider` interface contract
      (design §3) consumes minutes from the Pricing Engine; no duration
      calculation or pricing fields anywhere in scheduling tables

## 2. Migration

- [x] 2.1 Migration `0009_scheduling_availability.sql`: all tables of task
      1.1 with UUID PKs, `timestamptz` UTC timestamps, FKs, CHECK
      constraints (weekday 0–6, exception types, hold status, positive
      config values, grid divisibility, S13 no-wrap rule), UNIQUE
      constraints (effective-dated hours, per-branch config singleton,
      one-hold-per-session partial index, idempotency key)
- [x] 2.2 Indexes per `DATABASE.md` §43 conventions: branch_id, status,
      effective dates, hold expiry/branch lookups, service rules lookups
- [x] 2.3 Migration applies cleanly to a fresh database (pglite chain test)
      → `tests/db/migrations.test.ts` extension

## 3. RLS

- [x] 3.1 RLS enabled on every new table **in the creation migration**;
      policies follow the Change 1/2 pattern (org scope for HQ, branch
      scope via `membership_branches`), reusing the existing SECURITY
      DEFINER helpers; owner-exemption pattern preserved (no FORCE)
- [x] 3.2 RLS tests: cross-organization invisibility, cross-branch denial,
      branch-scoped reads, manipulated-ID rejection
      → `tests/db/rls.test.ts` extension

## 4. Authorization

- [x] 4.1 Domain authorization wiring (S17): `branches.view` for
      configuration reads, `branches.edit` for configuration mutations,
      `services.view` for offering-dependent reads — no new permission
      names; HQ = org-wide, branch roles = own branch only; enforced
      server-side before any state change; override capability NOT
      implemented (deferred decision)
- [x] 4.2 Authorization tests: HQ Admin full access; Branch Manager own
      branch only; cross-branch and cross-organization denied;
      unauthenticated denied
      → `tests/domain/authorization.test.ts` extension

## 5. Domain validation

- [x] 5.1 Zod schemas in `features/scheduling/schemas/`: weekday ranges,
      interval bounds, S13 no-wrap rule (`end > start` branch-local),
      exception type/date-range validity, config value bounds (grid
      divisibility, positive buffers/notice/cap), hold payloads
- [x] 5.2 Validation invariants: DST config rejection of nonexistent
      recurring local times (S14); exception-over-template precedence;
      effective-dating overlap rules; historical immutability
      → unit tests

## 6. Branch scheduling configuration operations

- [x] 6.1 Domain service: operating-hours CRUD (effective-dated, historical
      rows never mutated), schedule-exception CRUD (typed, overlap
      rejection), scheduling-configuration upsert (platform defaults per
      §86), service-scheduling-rules CRUD — transactional with audit;
      stable error codes
- [x] 6.2 Server Actions exposing the operations with the `Result<T>`
      envelope; no business logic in actions
- [x] 6.3 Activation readiness integration: `operating_hours` item of the
      branch checklist evaluates real rows (replaces the hardcoded
      unsatisfiable stub) — `features/branches/activation.ts`
- [x] 6.4 Domain tests: CRUD paths, effective-dating resolution, exception
      precedence over the weekly template

## 7. Availability engine + slot generation

- [x] 7.1 Deterministic slot generation implementing the S18 8-step
      pipeline: schedule → exceptions → offering gate (catalog read model
      consumed read-only) → duration (injected `DurationProvider`) → UTC
      materialization → candidate grid → filters → customer-safe result
- [x] 7.2 S14 DST rules implemented and tested: nonexistent candidate
      starts skipped; fall-back ambiguity resolved to first occurrence;
      spring/autumn transition test cases (`SCHEDULING_SYSTEM.md` §77)
- [x] 7.3 Filters: minimum notice (S4), maximum advance (S5), customer
      horizon (S12), occupied intervals incl. buffers (S6), capacity cap
      (S7)
- [x] 7.4 Availability result shape per §25 (start/end/timezone/available;
      no workforce internals); server-side Zod validation of requests
      (`SCHEDULING_SYSTEM.md` §60)
- [x] 7.5 Domain tests: determinism (same inputs ⇒ same slots), split
      shifts, closed days, exceptions, service-window fallback, capacity
      math

## 8. Slot holds (S1/S1b)

- [x] 8.1 Hold domain service: idempotent creation (session + idempotency
      key), one active hold per session (partial unique constraint),
      TTL from branch config (default 15 min), release, consume (atomic),
      read-time expiry + periodic sweep (simplest reliable mechanism)
- [x] 8.2 Holds participate in capacity/occupancy filters (step 7 of the
      pipeline); expired/released holds never block
- [x] 8.3 Tests: idempotent re-creation returns the same hold; second
      active hold per session rejected; TTL expiry releases capacity;
      abandoned checkout creates no booking and hold expires; consumed
      hold is terminal

## 9. Booking-boundary validation primitive (S16 stage 3)

- [x] 9.1 `validateSlotFeasibility({ branchId, serviceId, variantId?,
      start })` — pure scheduling-side feasibility check: offering gate,
      window, duration, buffers, notice, capacity, occupancy — no pricing,
      no booking-state logic
- [x] 9.2 Contract documented for the Booking-phase change: stage-5
      transaction consumes holds atomically (design §6); DB-level
      double-booking constraint sketch validated by concurrency tests
- [x] 9.3 Tests: feasibility agrees with availability engine; infeasible
      slots rejected with stable codes

## 10. Audit

- [x] 10.1 Wire all events of design §7 through the existing audit service
       (transactional, fail-closed, redacted metadata, request IDs):
       configuration mutations, `slot_held`/`slot_released`/`slot_consumed`
       /`slot_expired`
- [x] 10.2 Audit tests: required events per mutation, hold lifecycle
       pairing, no sensitive metadata
       → `tests/domain/audit.test.ts` extension

## 11. Seed / configuration mechanism (structure only)

- [x] 11.1 Idempotent seed runner: S2b default operating hours and platform
       default scheduling configuration applied per branch (natural-key
       upserts; identical row counts on rerun)
- [x] 11.2 Seed tests: rerun produces identical counts; defaults match §86
       values exactly

## 12. Tests (full quality gate)

- [x] 12.1 Migration + constraint + RLS suites green
- [x] 12.2 Domain suites green (authorization, configuration, availability,
       DST, holds, boundary primitive, audit, seeds; provisioning and
       catalog suites unaffected)
- [x] 12.3 `npm test` / `npm run lint` / `npm run typecheck` /
       `npm run build` all pass

## 13. Hosted Supabase verification (later task — do NOT run now)

- [x] 13.1 Extend the skipped-by-default hosted suite (`HOSTED_VERIFY=1`)
       with scheduling coverage: real Auth authorization, RLS isolation as
       real roles, definer-helper behavior, transactional audits, hold
       constraint races, DST behavior on real PostgreSQL
- [x] 13.2 Execute the hosted suite against the staging project; clean up
       all hosted test data; record results in the implementation report

## 14. Documentation synchronization (explicit obligations)

- [x] 14.1 `DATABASE.md`: field-level scheduling model (§11.1-companion
       section) matching migration 0009; §64/§65 note updated from
       "Change 3 scope" to implemented
- [x] 14.2 `DOCUMENTATION_AUDIT.md`: HIGH-2 scheduling rows fully closed;
       MEDIUM-9 marked resolved-by-implementation; S17 override finding
       updated if the security decision lands
- [x] 14.3 Verify no contradictory availability wording remains
       (`REQUIREMENTS.md` §18, `BOOKING_SYSTEM.md` §19)

## 15. Acceptance walkthrough

- [x] 15.1 Demonstrate: branch manager sets operating hours + exception →
       HQ configures scheduling parameters → availability engine returns
       deterministic slots honoring notice/horizon/capacity/DST → hold
       created, expired, re-created; unauthorized attempts rejected; audit
       trail complete
- [x] 15.2 Demonstrate: DST spring and autumn transitions produce the
       approved behavior (S14) with test evidence
