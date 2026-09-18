# Change 6 — Worker / Workforce Foundation

**Change ID:** `create-worker`
**Status:** Approved — BUILD MODE
**Roadmap alignment:** Phase 2 §18–20, §22 (Workforce, Job Management, Manual Assignment First); REQUIREMENTS §16 EM-001–003, §18–20; WORKER_SYSTEM §85 (MVP workforce scope, foundation subset per BD-W10).
**Predecessors:** Change 1 (Branch Provisioning), Change 2 (Service Catalog), Change 3 (Scheduling & Availability), Change 4A (Pricing Engine), Change 5 (Booking System) — all archived, hosted-verified.

## Problem

The platform converts confirmed bookings into work, but no operational workforce exists: migrations 0001–0011 contain no employees, employee-branch authorization, skills, availability, jobs, assignments, or incidents, and `features/` has no worker module. Change 5 deliberately shipped the booking→job handoff contract only (TD-1): every confirmed booking currently has no job, Booking states `assigned`/`in_progress` have no trigger, and staff have no operational surface to run the cleaning business. The workforce decision record is complete (BD-W1–BD-W13, 2026-09 decision round).

## Motivation

Deliver the operational half of the platform: a branch-scoped workforce with explicit many-to-many branch authorization, skills with qualification validity, availability with exceptions, jobs generated idempotently from confirmed bookings, a single-active-assignment model with eligibility validation, and the Booking↔Job synchronization contracts (WORKER_SYSTEM §87–89 golden rule). The Cleaner PWA (Change 7) builds directly on these tables and contracts without new domain plumbing.

## Scope

- Migration `0012_worker.sql` (next in chain 0001–0011): `employees`, `employee_branches`, `employee_skills`, `employee_availability`, `employee_availability_exceptions`, `jobs`, `job_assignments`, `job_events`, `incidents`, `job_number_sequences` + RLS + constraints + indexes.
- `features/worker/`: Zod schemas, stable error codes, employee domain (records, branch memberships, skills/qualifications, availability + exceptions, EMP-number allocation), job domain (post-commit creation per BD-W6, `JOB-` numbering per BD-W5, snapshots, lifecycle transitions), assignment domain (manual assignment per BD-W9, one-active invariant per BD-W8, eligibility validation incl. global cross-branch conflicts, reassignment), Booking↔Job contracts (both directions per BD-W7), incidents (`no_show` per BD-W7d), job events + fail-closed audit, outbox triggers.
- Scheduling occupancy unification (BD-W13): bookings remain the single occupancy source; the Change 3 speculative `jobs` probe is removed from `loadOccupied`.
- Internal operations UI: employees/jobs/assignments surfaces per PROJECT_STRUCTURE §12 (no cleaner routes).
- Full test suite (unit/domain/hosted) with explicit non-production fixtures; no seed business content.

## Non-goals

No Cleaner PWA, cleaner routes, login UX, check-in/out/`en_route` UI, checklist execution, photos/Storage, offline mode, push delivery, or cleaner self-service (BD-W10 → Change 7) · no cleaner acceptance/decline workflow (BD-W9; statuses reserved) · no team cleaning / multiple active assignments (BD-W8) · no automatic assignment or ranking (WORKER §25/§86) · no workforce-derived scheduling capacity (BD-W13) · no payment, payroll, tips, performance analytics, quality workflows (WORKER §54–56/§74) · no notification delivery (outbox rows only) · no recurring bookings · no Auth mechanism changes (BD-W12 reuses `users.invite`) · no new permissions (`employees.*`/`jobs.*` exist in the catalog) · no production business values (no skill seed content, no working-time limits, no employee data).

## Dependencies

Change 1 (organizations/branches, `profiles`/`memberships`/`membership_branches` RLS anchor, 0006 helpers) · Change 2 (catalog identities referenced in job snapshots, read-only) · Change 3 (feasibility model + occupancy-source contract) · Change 4A (pricing snapshot remains booking-authoritative; Worker never calculates price) · Change 5 (`bookings` occupancy model, confirmation/reschedule/cancel/no-show flows, outbox + idempotency + audit conventions, Booking-owned transition contract surface).

## Impact

Post-implementation documentation sync: WORKER_SYSTEM (implementation status), DATABASE §23–29, REQUIREMENTS EM notes, SECURITY (workforce RLS row), SCHEDULING_SYSTEM (occupancy-source note), BOOKING_SYSTEM (§51 job-creation mechanism + transition contracts), ARCHITECTURE, ROADMAP Phase 2 progress, PROJECT_STRUCTURE (worker feature), DOCUMENTATION_AUDIT (HIGH-6 resolution recorded; TD-W closures).
