# Change 7 — Cleaner Execution PWA

**Change ID:** `create-cleaner-pwa`
**Status:** Draft — awaiting approval
**Roadmap alignment:** Phase 2 §21 (Cleaner PWA / execution layer); REQUIREMENTS §17/§20; WORKER_SYSTEM §85 (MVP scope), §87–89 (boundaries/golden rule).
**Predecessors:** Change 1 (Branch Provisioning), Change 2 (Service Catalog), Change 3 (Scheduling & Availability), Change 4A (Pricing Engine), Change 5 (Booking System), Change 6 (Worker / Workforce Foundation) — all archived, hosted-verified.
**Decision record:** BD-C1–BD-C9 resolved and committed (`5ec79ff docs: record change 7 decisions`, DOCUMENTATION_AUDIT §4b). This change does not reopen any of them.

## Problem

The Worker foundation is complete but inert in the field: `jobs.status` already contains `en_route`, `checked_in`, and `in_progress` (migration 0012), yet **no surface can trigger them** — every confirmed booking's job must currently be completed manually by staff (`assigned → completed`), with no cleaner visibility, no check-in, no checklist, no before/after photos, and no incident reporting from the person actually doing the work. The Worker capability spec explicitly reserves this surface: *"en_route/checked_in/in_progress triggers SHALL belong to the Change 7 cleaner surface."* Cleaners also have no way to see their assigned jobs, and operational events (assignment, reassignment, schedule change, cancellation) never reach them.

## Motivation

Deliver the cleaner's field-execution experience as an **execution interface over the existing Worker domain** — not a second Worker domain. Worker remains authoritative for employees, employee branches, skills, availability, jobs, assignments, incidents, job lifecycle, execution authorization, assignment validation, and the Booking↔Worker contracts. The Cleaner PWA owns only the cleaner-facing interaction surface and execution UX: it invokes Worker-owned server contracts, displays Worker-owned state, and never mutates Booking lifecycle directly. All nine BD-C decisions (customer-data minimization, en_route, checklist snapshot model, photo scope, lightweight offline queue, no GPS, in-app notifications only, signature deferral, completion gates) are binding inputs to this change.

## Scope

- **Migration `0013_cleaner_execution.sql`** (next in chain 0001–0012): jobs execution timestamps (`en_route_at`, `checked_in_at`, `checked_out_at`, `actual_start`, `actual_end`); versioned service-scoped `checklist_templates` + immutable `job_checklist_snapshots` + `job_checklist_items`; `job_media` linkage; `job_events` event-type CHECK widened (`en_route`, `checklist_completed`); RLS on all new tables following the established organization/branch/active-assignment pattern.
- **`features/worker` extensions (domain-owned, no new domain):** cleaner-execution contracts (`enRoute`, `checkIn`, `startWork`, `updateChecklistItem`, `reportExecutionIncident`, `checkOut`, `completeCleanerJob`) — server-authoritative, assignment-checked, idempotent, transactional, audited; checklist domain (template versioning, snapshot-at-execution-start, item completion); execution gate evaluation (BD-C9); cleaner session/context resolution (`employees.user_id` → active employee → branch authorization → active assignment → job).
- **`features/cleaner/`** (PWA surface over `features/worker`): Zod schemas, stable error codes, route-level data loaders, minimized job views (BD-C1), offline action queue (BD-C5), PWA shell.
- **Routes `app/(cleaner)/cleaner/*`:** `/cleaner` (home: today/upcoming/completed/notification surface), `/cleaner/today`, `/cleaner/jobs/[id]` (execution screen: status, minimized customer data, checklist, notes, photos, incidents, en_route/check-in/start/checkout/complete actions).
- **Media:** private job-scoped photo upload/read (before/after/incident_evidence only) through the existing Media Storage architecture with signed-URL access after server authorization.
- **In-app notification surface** consuming existing job events / notification-outbox intents (BD-C7) — no delivery.
- **PWA infrastructure:** web app manifest, installable experience, service worker with app-shell/static caching only.
- **Offline action queue:** lightweight, idempotency-keyed client queue for safe execution actions with deterministic replay (BD-C5).
- **Full test suite** (domain/RLS/media/offline/PWA/migration-chain/hosted) with explicit non-production fixtures; no seed business content.

## Dependencies

Change 1 (organizations/branches, `profiles`/`memberships` RLS anchor, 0006 authorization helpers) · Change 2 (service identities for checklist template scoping — read-only; Service Catalog does not participate in execution state) · Change 3 (scheduling context only — no capacity consumption; BD-W13 preserved) · Change 4A (pricing untouched; never displayed to cleaners) · Change 5 (booking occupancy authority, outbox conventions, Booking-owned transition contract surface) · Change 6 (`employees`, `employee_branches`, `employee_availability*`, `jobs`, `job_assignments`, `job_events`, `incidents`, `job_snapshot` minimized `customer_display`, `ensureJobForBooking`, `completeJob`, `applyJobDerivedBookingTransition`, eligibility validator, RLS combined-policy pattern, `writeJobEvent`/`auditWorker`/outbox writers).

## Affected domains

**Worker** (primary — execution contracts, checklist, execution timestamps, incidents, RLS extension) · **Booking** (consumed via the existing Booking-owned transition contract only — `assigned/in_progress/completed`; zero direct Booking writes) · **Storage/Media** (private bucket usage per MEDIA_STORAGE) · **Notifications** (in-app consumption of existing intents only) · **Auth** (existing Supabase Auth reused; no new mechanism). No changes to Scheduling behavior, Pricing, Service Catalog execution state, or permissions.

## Migration 0013

Architectural surface (full data model in design §3):

- A. `jobs` execution timestamps: `en_route_at`, `checked_in_at`, `checked_out_at`, `actual_start`, `actual_end` (timestamptz, existing conventions; terminal-metadata CHECKs extended consistently).
- B. Checklist: versioned service-scoped `checklist_templates`; immutable `job_checklist_snapshots` copied at execution start; `job_checklist_items` with status/`completed_at`/`completed_by`/notes.
- C. `job_media` linkage (category CHECK: `before/after/incident_evidence`).
- D. `job_events` event-type CHECK extended for `en_route` and `checklist_completed` (same ALTER pattern as the Change 6 outbox widening; `actor_type` semantics unchanged).
- E. RLS: combined organization/branch/active-assignment policies on every new table; existing RLS not weakened.

No production checklist content, no production media configuration values, no signature fields, no location fields.

## Cleaner PWA surface

Mobile-first, installable, execution-focused. In scope: cleaner home (today/upcoming/completed + in-app notification surface), job detail with minimized customer information (first name, last initial, phone, service address, execution instructions — BD-C1), execution status, en_route, check-in, start work, checklist, notes, incident reporting, before/after/incident photos, checkout, completion. Out of scope: everything in Non-goals below.

## Authentication / context

Existing Supabase Auth session → `employees.user_id` → active employee → `employee_branches` authorization → active assignment → job. Access denied on unauthenticated / no linked employee / inactive employee / missing branch authorization / no active assignment / job not assigned to the cleaner. No separate authentication system; never mixed with customer magic-link auth; never mixed with `/admin/*`.

## Execution lifecycle

`assigned → en_route → checked_in → in_progress → completed`, with the explicitly permitted direct path `assigned → checked_in` (BD-C2). `en_route` is optional and not an assignment prerequisite. Server-authoritative throughout; client state is never authoritative.

## Non-goals (explicit)

No GPS/location capture, tracking, geofencing, background location, or location permission requests (BD-C6) · no customer signature capture/storage/verification/gating (BD-C8) · no push/email/SMS/WhatsApp notification delivery (BD-C7; in-app surface only) · no full offline-first architecture, offline database replication, or offline media upload (BD-C5) · no cleaner self-service availability/leave · no acceptance/decline workflow (BD-W9 statuses remain reserved) · no automatic assignment, ranking, or preferred cleaners · no team cleaning / multiple active assignments (BD-W8) · no payment, payroll, tips, performance analytics · no quality/complaint workflow beyond the existing minimal incident model · no customer-facing checklist editor · no public media gallery or customer-facing photos · no customer messaging/reviews · no recurring bookings · no workforce-derived Scheduling capacity (BD-W13) · **no Admin Foundation scope** (no `/admin/login`, `/admin` dashboard, `/setup`, admin middleware, HQ control board, employee admin forms — separate change; `/admin/*` and `/cleaner/*` remain strictly separated) · no new permissions (cleaner keeps existing `jobs.view` + `search.use`; staff keep `jobs.assign`/`jobs.manage` for override) · no Auth mechanism changes (BD-W12).

## Change 8+ boundary

Notification delivery (push/email/SMS/WhatsApp), GPS/location verification after legal/HR/privacy review, customer signature, cleaner self-service availability/leave, quality workflows, workforce-derived Scheduling capacity, and the Admin Foundation remain separate future changes. This change's architecture must not preclude them: the offline queue is designed to deepen without replacing Worker; the in-app surface can later be driven by delivered notifications; completion-gate evaluation is a validation rule, not a state.

## Risks

- **Offline replay correctness** — mitigated by idempotency keys on every queued action, deterministic ordering, and server-side convergence guarantees inherited from Change 6 (unique constraints + state guards).
- **Media exposure** — mitigated by private-only storage, job-scoped paths, server authorization before any signed URL, category allow-list, and RLS on `job_media`.
- **Completion-gate circumvention** — mitigated by gate evaluation inside the Worker completion transaction (not the client), fail-closed audit, and audited manager override.
- **Double-counting / stale state** — mitigated by stale-state echo responses and server-authoritative transitions (existing Change 6 conventions).
- **Scope bleed into Admin Foundation** — mitigated by the explicit route separation and the non-goals list.

## Acceptance criteria

1. A cleaner authenticated via Supabase Auth with a linked active employee sees exactly their own active-assignment jobs with minimized customer data (BD-C1) and none of the prohibited fields.
2. The full execution flow works end-to-end: `assigned → en_route → checked_in → in_progress → completed`, plus the direct `assigned → checked_in` path, with `en_route_at`/`checked_in_at`/`checked_out_at`/`actual_start`/`actual_end` recorded server-side.
3. A job checklist snapshot is created at execution start from the versioned service template; items record status/completed_at/completed_by/notes; history is immutable after completion; mandatory items gate completion (BD-C3/C9).
4. Cleaner self-completion succeeds only when checked in, all mandatory items complete, and no unresolved high/critical incident exists; low/medium incidents do not block; manager override is server-authoritative, permission-controlled, audited, and idempotent (BD-C9).
5. Completion invokes the existing Worker → Booking contract; the booking reaches `completed` through `applyJobDerivedBookingTransition`; no cleaner route writes Booking tables (BD-C9).
6. Photos: only before/after/incident_evidence; private, job-scoped, signed-URL access after authorization; unauthorized access denied; no offline upload (BD-C4).
7. Offline queue: safe actions replay idempotently after reconnect without duplicate events; stale actions receive deterministic conflict responses; media requires connectivity (BD-C5).
8. No GPS/location permission anywhere in the cleaner surface (BD-C6); no signature anywhere (BD-C8).
9. RLS: a cleaner cannot read another cleaner's jobs, cancelled/reassigned operational jobs, or internal notes; inactive employees are denied; all mutations are server-authorized.
10. In-app notification surface renders operational events (assignment/reassignment/schedule change/cancellation) from existing intents; no delivery infrastructure exists.
11. Migration chain 0001→0013 applies cleanly; full hosted regression Changes 1–7 passes; existing Change 1–6 behavior unchanged.

## Verification strategy

Unit tests (gates, transitions, checklist snapshot, idempotency keys) · domain tests on pglite against the full migration chain 0001→0013 (execution contracts, RLS denials, propagation, offline replay semantics at contract level) · RLS test suite extension · PWA tests (manifest validity, service worker registration, route loading, mobile execution flow) · media tests (authorization matrix, category restrictions, signed-URL behavior) · hosted `cleaner-hosted-verification.test.ts` per the established convention (schema/constraints/RLS/flows/leftovers=0) · full hosted regression Changes 1–7 · typecheck/lint/build · `git diff --check`.
