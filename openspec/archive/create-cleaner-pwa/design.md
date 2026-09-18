# Design: Cleaner Execution PWA (Change 7)

**Status:** Draft — awaiting approval.
**Normative sources:** owner decision records **BD-C1…BD-C9** (2026-09 decision round; committed `5ec79ff`, DOCUMENTATION_AUDIT §4b); the approved Change 6 design (`openspec/archive/create-worker/design.md`, BD-W1–BD-W13, TD-W1–TD-W10); the promoted Worker capability spec (`openspec/specs/worker/spec.md`); WORKER_SYSTEM §19–20/§26–35/§36–38/§39–42/§43–48/§49–53/§61–67/§75–79/§85–89; BOOKING_SYSTEM (booking states, transition contract); SECURITY §10/§45–47; SECURITY_PRIVACY §52–53/§75–77; MEDIA_STORAGE §27–32/§67; NOTIFICATION_SYSTEM §13/§22; LOCALIZATION §51/§55; LEGAL_COMPLIANCE §39–42; DATABASE §23–29; PROJECT_STRUCTURE §6/§13; OBSERVABILITY §9; API_STANDARDS §4. Where wording could diverge, the BD-C record and the promoted Worker spec win.

## 1. Approved decision record (normative, restated — not reopened)

| ID | Binding constraint |
|---|---|
| BD-C1 | Cleaner sees **exactly**: customer first name, last initial, phone, service address, execution instructions. Never: email, payment data/history, unrelated booking/customer history, internal staff notes, other workers' information, unnecessary customer fields. Access bound to the cleaner's **active assignment**. Completed-job history stays minimized (same snapshot rules). Cancelled/reassigned jobs leave the operational surface (active data not exposed after reassignment; historical access only per existing rules). Reuse the Change 6 `job_snapshot.customer_display` minimized snapshot; phone is surfaced as the documented operational contact field. |
| BD-C2 | V1 lifecycle `assigned → en_route → checked_in → in_progress → completed`. `en_route` is cleaner-triggered, server-authoritative, idempotent, records `en_route_at`, is **not** an assignment prerequisite, and the direct `assigned → checked_in` path remains valid (no artificial blocking). **No GPS, no location permission, no coordinate storage, no tracking.** No new Job state. |
| BD-C3 | Service-level checklist definition → copied at execution start → immutable job checklist snapshot → items. Templates versionable; job snapshot/history immutable after completion; retroactive content change impossible. Items record status, `completed_at`, `completed_by`, optional notes. Mandatory items participate in completion gating (BD-C9). No production checklist seed content; no customer-facing editor; Service Catalog does not own execution state. |
| BD-C4 | Photo categories **only** `before`, `after`, `incident_evidence`. Private by default, job-scoped, authorization-controlled, short-lived signed URLs after server authorization. No public gallery, no automatic customer exposure, no offline upload. Limits follow Media Storage configuration (no invented business values). Final bucket name finalized during implementation as MEDIA_STORAGE already anticipates. |
| BD-C5 | Lightweight client-side offline action queue — NOT full offline-first. Safe idempotent actions may queue: en_route, check-in, start work, checklist updates, incident actions where safely supported, checkout, completion. Idempotency keys; server authoritative; deterministic replay and ordering; stale/conflicting actions receive deterministic responses; replay never duplicates events/incidents/checklist updates; unsafe actions never silently succeed offline; media upload requires connectivity. No replication, no unrestricted offline mutation, no permanent authoritative job state on-device. Architecture deepens later without replacing Worker. |
| BD-C6 | **No GPS in V1**: no coordinates, no en-route location, no continuous/background tracking, no geofencing, no location permission request. The PWA works without location permission. Future location verification requires a separate decision after legal/HR/privacy review. |
| BD-C7 | In-app notification surface only; consumes existing job events / notification-outbox intents. No second notification engine. No push/email/SMS/WhatsApp delivery in Change 7 — delivery remains a Notification-domain responsibility. Relevant surfaced events: new assignment, reassignment, schedule change, job cancellation, other approved operational changes. |
| BD-C8 | Customer signature **deferred**. No capture, storage, verification, requirement, or completion gate. No signature fields in migration 0013. Future Quality/Booking decision. |
| BD-C9 | Cleaner self-completion requires: (1) check-in completed; (2) all mandatory checklist items complete; (3) no unresolved **high/critical** incident. Low/medium incidents do not block. Authorized management override: server-authoritative, permission-controlled (`jobs.manage`), explicitly audited, idempotent. Completion uses the existing Worker → Booking contract (`completeJob` → `applyJobDerivedBookingTransition`). No direct Booking-table writes from cleaner UI. No new Job state (gating is a validation rule; incidents remain incidents). |

## 2. Domain boundaries

Worker owns employees, employee branches, skills, availability, jobs, assignments, incidents, the job lifecycle, execution authorization, assignment validation, and the Booking↔Worker contracts. The Cleaner PWA owns only the cleaner-facing interaction surface and execution UX — it is an execution **interface**, never a second Worker domain: no duplicated state model, no client-side authoritative state, no direct Booking/Scheduling/Pricing mutations. Scheduling answers "can the work be performed?" (untouched, BD-W13); Assignment answers "which worker performs it?" (Change 6 validator); the Cleaner PWA answers only "how is the assigned work executed and reported?". Booking remains the customer commitment; cleaner completion reaches Booking exclusively through the Booking-owned transition contract. Service Catalog does not participate in execution state (checklist templates are Worker-owned, §3.2). Notification delivery stays outside.

## 3. Data model (conceptual; implemented by migration 0013)

Conventions: 0012 pattern — UUID PKs; `organization_id` NOT NULL everywhere; `branch_id` NOT NULL on branch-scoped tables; `timestamptz` UTC; `created_at/updated_at`; RLS enabled at creation with combined policies via 0006 helpers; no FORCE. Append-only `job_events` guard trigger untouched.

**3.1 `jobs` execution timestamps (ALTER):** add `en_route_at timestamptz?`, `checked_in_at timestamptz?`, `checked_out_at timestamptz?`, `actual_start timestamptz?`, `actual_end timestamptz?`. Column-set consistency CHECKs extended in the 0012 style: `en_route_at` set iff status reached `en_route`-or-later; `checked_in_at` required for `checked_in/in_progress/completed`; `checked_out_at` required for `completed`; `actual_start` ≤ `actual_end` when both set; existing `ck_jobs_terminal_metadata` semantics preserved (completed ⇒ `completed_at`, cancelled ⇒ `cancelled_at`+reason). No GPS/location columns ever (BD-C6). No signature columns (BD-C8).

**3.2 `checklist_templates`** — Worker-owned versioned definitions (BD-C3): `organization_id`, `branch_id?` (NULL = org-wide default for the service), `service_id uuid` FK→services (scoping only — the Service Catalog does not own execution state), `version int` NOT NULL, `status text` CHECK (`draft/published/retired`) default `draft`, `name text`, `is_mandatory_default boolean` default false, `created_by uuid?`, UNIQUE `(organization_id, service_id, version)` where branch_id is null and the same partially for branch-scoped rows (branch override replaces the org default). Only `published` templates snapshot into jobs. No production seed rows (BD-C3).

**3.3 `job_checklist_snapshots`** — immutable per-job copy taken at execution start (first cleaner action that begins execution: check-in or en_route, whichever occurs first): `job_id` FK, `template_id` FK (provenance), `template_version int`, `service_id`, `snapshot jsonb` (frozen item definitions: `key`, `label`, `mandatory`, `sort_order`), `created_at`. CHECK: one snapshot per job (UNIQUE `(job_id)`). No UPDATE path in the domain; retention is permanent (immutable execution history).

**3.4 `job_checklist_items`** — execution state per snapshot item: `job_id` FK, `snapshot_id` FK, `item_key text`, `label text` (copied at snapshot), `mandatory boolean` (copied at snapshot), `sort_order int`, `status text` CHECK (`pending/completed`) default `pending`, `completed_at timestamptz?`, `completed_by uuid?` (auth user), `notes text?`. UNIQUE `(job_id, item_key)`; CHECK `(status = 'completed') = (completed_at is not null)`; `completed_at` set iff completed. Immutable after job completion (domain-level guard; no update path once `jobs.status='completed'`).

**3.5 `job_media`** — linkage only (BD-C4; binary objects live in private Supabase Storage, not the DB): `organization_id`, `branch_id`, `job_id` FK, `incident_id uuid?` FK→incidents (required when category = `incident_evidence`), `category text` CHECK (`before/after/incident_evidence`), `storage_path text` NOT NULL (job-scoped path per MEDIA_STORAGE §67), `mime_type text`, `byte_size bigint`, `uploaded_by uuid?`, `created_at`. UNIQUE `(job_id, storage_path)`. Category allow-list is enforced here AND at the storage layer; size/type limits come from Media Storage configuration (no invented values).

**3.6 `job_events` (ALTER):** widen the `event_type` CHECK with `en_route` and `checklist_completed` (same `drop constraint`/`add constraint` pattern as the Change 6 outbox widening; append-only trigger and `actor_type` CHECK `staff/system/customer` unchanged — cleaner actions use `staff` with employee linkage in metadata, TD-W8 minimization discipline).

**3.7 Explicitly absent:** no location/GPS tables or columns (BD-C6), no signature structures (BD-C8), no offline-replication tables, no push subscription tables, no customer-facing gallery structures, no payroll/performance tables, no second incidents model, no cleaner preferences beyond `employees.preferred_language`.

## 4. Cleaner authentication & session context

Existing Supabase Auth only (no new mechanism; never mixed with customer magic-link; never mixed with `/admin/*`). Resolution chain, evaluated once per request in a single `features/cleaner` context helper (reusing `getAuthenticatedUserId` + a Worker-owned resolution function — no duplicated authorization logic):

```
auth.uid() → employees.user_id → employee (status='active' required)
           → employee_branches (operational authorization)
           → job_assignments (own, assignment_status='active')
           → jobs (assigned job)
```

Deny (stable error, no data leak) when: unauthenticated; no linked employee; employee not `active` (deactivated/temporarily_unavailable/on_leave cannot execute); no valid branch authorization; no active assignment; job not assigned to this cleaner. Application role (`cleaner`) remains a role, not an employment type (BD-W12); deactivation blocks execution immediately while history rows remain. TD-C: the exact helper shape (`getCleanerContext()` returning `{ employeeId, employee, branchAuthorizations }`) is resolved at implementation, but the chain and deny rules are normative.

## 5. Execution contracts (server actions over Worker domain)

All mutations are Worker-owned functions (extending `features/worker`), invoked from cleaner server actions which hold **zero business logic**. Every contract: authenticates via §4; verifies the caller's own **active** assignment on the job; enforces the transition guard; mutates in one transaction with row locks; writes `job_events` (append-only) + fail-closed audit via the existing `writeJobEvent`/`auditWorker` writers; returns the authoritative post-state (stale-state echo) or a stable error.

**Transition matrix (server-enforced, extends the Change 6 surface; no new states):**

| From | Action | To | Notes |
|---|---|---|---|
| assigned | enRoute | en_route | BD-C2; sets `en_route_at`; optional |
| assigned | checkIn | checked_in | direct path permitted (BD-C2); sets `checked_in_at`, `actual_start` |
| en_route | checkIn | checked_in | sets `checked_in_at`, `actual_start` |
| checked_in | startWork | in_progress | sets `actual_start` if not set |
| checked_in / in_progress | checkOut | in_progress / checked_out-equivalent | sets `checked_out_at` (`actual_end`); checkout is a recorded event preceding completion |
| in_progress (or checked_in) | complete | completed | BD-C9 gates + §6; sets `completed_at`, `actual_end` |

No-op/idempotent semantics: repeating an already-applied transition returns the current authoritative state (success no-op, no duplicate events) — identical to the Change 6 convention. Invalid transitions return stable conflict errors echoing server state.

- **enRoute** — `assigned→en_route`; sets `en_route_at`; event `en_route`; no location data accepted or stored (BD-C6).
- **checkIn** — `assigned/en_route→checked_in`; sets `checked_in_at`, `actual_start`; event `check_in`; server timestamps authoritative.
- **startWork** — `checked_in→in_progress`; sets `actual_start` if unset; event `job_started`; also triggers checklist snapshot creation if not yet present (§3.3 — snapshot exists from the first execution action).
- **updateChecklistItem** — snapshot item `pending→completed` (and notes); validates the item belongs to the caller's active-assignment job; event `checklist_completed` (with `all_mandatory_complete` in metadata); sets `completed_at`/`completed_by`; idempotent on repeat; rejected once the job is terminal.
- **reportExecutionIncident** — cleaner-created operational incidents through the **existing Worker incidents model** (`insertIncident` + `incident_reported` event; type/severity from the existing 0012 taxonomy). No separate cleaner incident domain. Incident-evidence photos may attach via `job_media` (§7). High/critical unresolved incidents later block completion (BD-C9).
- **checkOut** — sets `checked_out_at`, `actual_end`; event `check_out`; does **not** complete the job.
- **completeCleanerJob** — evaluates BD-C9 gates **inside the transaction**: checked-in present; every mandatory snapshot item `completed`; no incident `open` with severity `high|critical`. Failures return a stable specific error (gate echo). On success: status `completed`, `completed_at`, `actual_end`, `job_completed` event, audit — then, **post-commit**, the Booking-owned contract `applyJobDerivedBookingTransition(bookingId, 'completed')` (existing TD-W4 contract; booking walks `assigned→in_progress→completed` idempotently as already implemented). Cleaner routes never write Booking tables.
- **Manager override** — staff completion/override via the existing `jobs.manage`/`jobs.assign` permission path (Change 6 surface): overrides BD-C9 blockers, is server-authoritative, explicitly audited (`override: true` metadata), idempotent. No cleaner route exposes it.

**Concurrency & idempotency:** every contract locks the job row (`SELECT … FOR UPDATE`, TD-W7 pattern) so concurrent transitions serialize; unique constraints are the backstop; idempotency keys from the offline queue (§8) map to the same convergence guarantees (retry = no-op when state already applied). Two devices logged in as the same cleaner converge deterministically; a reassignment mid-session causes the next action to fail the active-assignment check with the authoritative state echoed; cancellation mid-session likewise. Network retries replay the same idempotency key → no duplicate events.

## 6. Completion gates (BD-C9, normative evaluation order)

Inside the completion transaction: (1) `checked_in_at` present; (2) zero mandatory `job_checklist_items` with `status='pending'`; (3) zero `incidents` rows `status='open'` with `severity in ('high','critical')` on the job. Low/medium open incidents do not block. Gate failure returns `COMPLETION_BLOCKED` with the specific unmet gates. Manager override bypasses gates with `jobs.manage` + audit. No new Job state is introduced; a blocked job simply remains in its current state with a deterministic error.

## 7. Media security (BD-C4)

Private Supabase Storage only (bucket finalized during implementation per MEDIA_STORAGE §149/§160; job-scoped paths `jobs/<org>/<branch>/<job>/<category>/…` per §67). Flow: cleaner (authorized per §4, active assignment) requests upload/read → **server authorization** (category ∈ {before, after, incident_evidence}; job active-assignment bound; size/type from Media Storage configuration; `incident_evidence` requires an incident on the job) → controlled storage operation → `job_media` row → reads via **short-lived signed URLs** minted only after authorization. Never public URLs; no customer exposure; no gallery. Uploads require connectivity (offline media explicitly out of scope, BD-C5). Duplicate uploads are deduplicated by `(job_id, storage_path)` and idempotent retry keys.

## 8. Offline action queue (BD-C5, lightweight)

Client-side queue in `features/cleaner` (IndexedDB/localStorage — final mechanism is an implementation detail; architecture is normative): each entry = `{ action, idempotency_key, payload, created_at }` for the safe set (enRoute, checkIn, startWork, updateChecklistItem, reportExecutionIncident, checkOut, completeCleanerJob). Rules: enqueue only when a request fails from connectivity (never for validation errors); replay sequentially in creation order on reconnect; each replay sends the idempotency key; server convergence (§5) makes replays no-ops when already applied; deterministic stale/conflict responses replace the queued entry with the server echo; entries surface as explicit pending states in the UI; unsafe/unqueued operations show explicit errors — nothing silently succeeds offline. No offline media upload; no offline reads promised beyond the app shell; no authoritative state lives only on-device; the queue is additive — deepening it later does not replace Worker or the contracts.

## 9. PWA architecture (minimum required)

Web app manifest (installable, mobile viewport, icons), service worker with **static/app-shell caching only** (routes, assets) — never customer/job data caching, never API-response caching beyond per-request lifetimes; update strategy = on-activate cleanup with user-visible update prompt; authentication persists via the existing Supabase Auth cookie session. No offline replication, no push subscription, no background sync (BD-C5/C6/C7). The PWA layer is infrastructure only; all behavior flows through §5 contracts.

## 10. Localization & timezone

Existing CLENQO localization architecture; UI language from `employees.preferred_language` with the established fallback chain (LOCALIZATION §51/§55); all four launch languages supported by convention (de/en/fr/es). User-facing dates/times render in the **branch-local timezone** (jobs carry `timezone` from Change 6); execution timestamps stored UTC `timestamptz` per database conventions. No hardcoded city/locale.

## 11. Events, audit, observability

Reuse `writeJobEvent` (append-only), `auditWorker` (fail-closed transactional), and the notification-outbox writers — no second event/audit/logging architecture. Event coverage: `en_route`, `check_in`, `job_started`, `checklist_completed`, `check_out`, `job_completed`, `incident_reported` (all in the widened CHECK). Audit: every execution mutation, gate override, incident action, media authorization grant. Observability per WORKER §83/OBSERVABILITY §9: structured logs with job_id/booking_id/employee_id correlation; metrics for execution transitions, completion blocks (per gate), offline replays, media denials. Sensitive-data minimization per WORKER §66/AUDIT §50 (no customer PII in event payloads beyond existing snapshot discipline; nothing logged that isn't already minimized).

## 12. RLS & security summary

New tables RLS-enabled with combined policies via 0006 helpers (no FORCE, no application-role write policies — mutations flow through the privileged domain layer, 0007 pattern):
- `checklist_templates`, `job_checklist_snapshots`, `job_checklist_items`, `job_media`: org-wide `hq_admin/hq_staff`; branch managers via `has_branch_access`; **cleaner role: snapshots/items/media only for jobs with their own active assignment** (exists-subselect on `job_assignments`, TD-W2 pattern); templates readable by cleaners only via their branch authorizations (org/branch default).
- `jobs`/`job_assignments` policies are **unchanged** (Change 6 already scopes cleaners to own-assignment jobs).
- Deny surface verified by tests: cross-cleaner jobs, reassigned/cancelled operational jobs, inactive employees, unauthenticated users, internal notes (never rendered in any cleaner view — BD-C1), email/payment (never present in the cleaner data path).
- Route protection complements but never replaces RLS + server-action authorization (API_STANDARDS §4: authenticate → authorize → validate → domain service).

## 13. Testing strategy

**Unit:** transition matrix (incl. `assigned→checked_in` direct path, en_route optionality, idempotent repeats); BD-C9 gate evaluation (each gate, low/medium non-blocking, override); checklist snapshot immutability; offline queue ordering/idempotency-key semantics.
**Domain (pglite, chain 0001→0013):** cleaner context resolution denials (no user/no employee/inactive/no branch/no assignment); en_route/check-in/start/checkout/complete happy paths + timestamps; direct check-in; checklist snapshot creation at execution start; item completion + `completed_at/completed_by`; mandatory gating blocks completion; high/critical incident blocks; low/medium doesn't; manager override audited + idempotent; completion drives booking `completed` via the contract (no direct booking writes — assert booking events only); idempotent double-submissions; concurrent transition race (row lock) → one winner; reassignment/cancellation mid-execution denies further cleaner actions; incidents via existing model; media rows (categories, incident linkage, dedup); RLS denials on all new tables incl. cleaner own-assignment scope and cross-cleaner denial; events append-only; audit fail-closed.
**RLS suite:** extension of `tests/db/` pattern for every new table.
**Media:** authorization matrix (authorized upload/read, denied cross-job/cross-cleaner/unauthenticated, category restrictions, `incident_evidence` requires incident, signed-URL issuance only after authorization).
**Offline:** queue enqueue/replay/duplicate-key no-op/stale conflict/deterministic ordering/explicit pending UI state; media requires connectivity.
**PWA:** manifest validity, service worker registration + app-shell-only caching (assert no API/data caching), route loading, mobile execution flow smoke.
**Migration:** 0001→0013 chain; 0013 idempotent-reapply safety consistent with prior migrations.
**Hosted:** `tests/hosted/cleaner-hosted-verification.test.ts` per the established convention (schema/constraints/RLS/flows/leftovers=0) + full hosted regression Changes 1–7.

## 14. Implementation constraints

- Zero new permissions; zero new Job states; zero new event types beyond the two CHECK additions; zero Booking-table writes from cleaner code; zero location/signature artifacts.
- All execution mutations flow `server action → features/cleaner loader → features/worker contract`; route handlers and components hold no business logic (API_STANDARDS §4; PROJECT_STRUCTURE §6/§13).
- Reuse Change 6 idempotency, stale-echo, transaction, audit, and RLS conventions — no parallel mechanisms (BD-C7 "no second engine" applies to events/audit equally).
- No production business values: no checklist seed content, no media limits invented (configuration only), no employee/seed data (TD-W9 discipline).
- Documentation sync post-implementation (tasks §18) without altering the BD-C decision record unless a genuine contradiction emerges.

## 15. Non-goals (restated)

See proposal Non-goals — GPS (BD-C6), signature (BD-C8), delivery (BD-C7), full offline-first (BD-C5), self-service, acceptance workflow, automatic assignment, team cleaning, payment/payroll/analytics, quality workflow, public gallery, customer messaging, Admin Foundation scope, new permissions, auth changes.
