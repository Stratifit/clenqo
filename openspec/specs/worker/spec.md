# Worker

**Capability:** `worker`
**Status:** Active capability
**Established by:** `openspec/archive/create-worker/` (implemented 2026-09-18, commit `772ff6c`; hosted Supabase verification 8/8 PASS, full hosted suite 73/73 PASS, local suite 264 PASS) · extended by `openspec/archive/create-cleaner-pwa/` (Change 7 cleaner execution, implemented 2026-09-18, commit `aadce19`; hosted Change 7 verification 7/7 PASS, full hosted Changes 1–7 regression 80/80 PASS, local suite 291 PASS)
**Sources:** `WORKER_SYSTEM.md` (incl. §87–89 golden rule), `REQUIREMENTS.md` EM-001–003, `DATABASE.md` §23–29, `SCHEDULING_SYSTEM.md` §84–86 (S7/S8 boundary), `SECURITY.md` §14/§17, `ARCHITECTURE.md`, `API_STANDARDS.md`, `AUDIT_SYSTEM.md`, `NOTIFICATION_SYSTEM.md`

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.
Requirement wording is normative and testable; WHEN/THEN scenarios are
acceptance criteria. The authoritative V1 decision record is BD-W1–BD-W13.
Cleaner execution (Change 7) is part of this capability. Payment, payroll,
notification delivery (push/email/SMS), team cleaning, automatic assignment,
customer signature, and GPS/location capture remain outside it.

## Requirement: Server-authoritative job creation from confirmed bookings
Jobs SHALL be created only by the Worker domain, only from confirmed bookings, immediately after the booking confirmation transaction commits (BD-W6/TD-W1). Creation SHALL be idempotent and retry-convergent: retries and concurrent attempts SHALL produce exactly one job per booking (DB-enforced partial unique), and a job-creation failure SHALL never roll back or cancel the confirmed booking.

#### Scenario: Exactly one job per confirmed booking
* **WHEN** the job-creation function runs twice (or concurrently) for the same confirmed booking
* **THEN** exactly one job exists and both attempts report success

#### Scenario: Booking survives job-creation failure
* **WHEN** job creation fails transiently after confirmation
* **THEN** the booking remains confirmed, the failure is observable, and a retry converges to exactly one job

## Requirement: Job number
Each job SHALL carry a human-readable number `JOB-<year>-<sequence>` (e.g. JOB-2026-000123), unique per organization and never reused (BD-W5); the year SHALL derive from the source booking's branch-local `scheduled_start`; the per-organization sequence SHALL be monotonic without yearly reset and allocation SHALL be concurrency-safe; the UUID SHALL remain the internal identifier.

#### Scenario: Concurrent job creation in one organization
* **WHEN** two jobs are created simultaneously in one organization
* **THEN** they receive distinct sequential numbers and both commits succeed

## Requirement: Employee records without mandatory accounts
Employees SHALL be organization-scoped records with an optional nullable Auth linkage (`user_id`, BD-W12); an employee record SHALL be able to exist without application access; application roles SHALL remain distinct from employment (BD-W12); employee numbers `EMP-<sequence>` SHALL be organization-unique, monotonic, never reused, and concurrency-safe.

#### Scenario: Employee without app access
* **WHEN** an employee record is created with no linked Auth user
* **THEN** the record is valid and assignment-eligible, and no Auth account is created

## Requirement: Employee branch authorization
Employee↔branch authorization SHALL be many-to-many via `employee_branches` (BD-W1); no scalar `employees.branch_id` authorization model SHALL exist; assignment eligibility SHALL require branch authorization via this relationship.

#### Scenario: Multi-branch employee
* **WHEN** an employee is authorized for branches A and B
* **THEN** the employee is assignment-eligible in both and in no other branch

## Requirement: Employee statuses
Employee lifecycle statuses SHALL be exactly `active`, `temporarily_unavailable`, `on_leave`, `inactive` (BD-W2); only `active` employees SHALL be assignment-eligible; deactivation SHALL block new assignments while preserving all historical records (WORKER §79).

#### Scenario: Inactive employee rejected
* **WHEN** a manager attempts to assign a job to a non-active employee
* **THEN** the assignment is rejected with a stable error and no assignment row is created

## Requirement: Employment types
Employment types SHALL be exactly `full_time`, `part_time`, `minijob`, `flexible` (BD-W3).

#### Scenario: Invalid employment type
* **WHEN** an employment type outside the canonical set is submitted
* **THEN** validation rejects it

## Requirement: Employee skills and qualification expiry
Skills SHALL be organization-wide `skill_key` strings from the documented namespace (BD-W11) on `employee_skills` with qualification metadata; `level` SHALL have no V1 semantics; an expired mandatory qualification SHALL NOT satisfy a new assignment requirement, while historical assignments SHALL remain unaffected; no skills registry table SHALL exist and no production skill seed content SHALL be introduced.

#### Scenario: Expired qualification blocks assignment
* **WHEN** a job requires a skill whose employee qualification has expired before the job start
* **THEN** the assignment is rejected with a qualification error

## Requirement: Employee availability
Recurring weekly availability with effective dating plus typed date/time exceptions SHALL be stored per employee (TD-W6); exceptions SHALL override the recurring schedule; availability SHALL be consumed only by assignment eligibility — never by Scheduling availability/capacity (BD-W13).

#### Scenario: Unavailable exception overrides schedule
* **WHEN** an `unavailable` exception overlaps a job interval that recurring availability would otherwise cover
* **THEN** the employee is not eligible for that job

## Requirement: One active assignment per job
V1 SHALL permit at most one non-terminal (active/pending) assignment per job, enforced by a database partial unique index and transactional validation (BD-W8); the assignment table SHALL remain structurally multi-row for future team cleaning; assignment history SHALL never be deleted.

#### Scenario: Second active assignment rejected
* **WHEN** a second active assignment is attempted on a job that already has one
* **THEN** the database and the domain both reject it

## Requirement: Immediate assignment without acceptance gate
Authorized managers SHALL create assignments directly as `active` (BD-W9); the job becomes `assigned` when the assignment exists; `accepted`/`declined` SHALL remain reserved future statuses with no acceptance timeout in V1; reassignment SHALL be manager-controlled and atomic (old assignment cancelled, history preserved, new assignment active, one transaction).

#### Scenario: Reassignment preserves history
* **WHEN** a manager reassigns an assigned job from cleaner A to cleaner B
* **THEN** A's assignment row is `cancelled` (retained), B's is `active`, and both appear in history

## Requirement: Assignment eligibility validation
Assignment SHALL validate, in order: employee exists; status `active`; branch authorization; required skills; qualification validity at job start; recurring availability covers the interval; no unavailable exception overlaps it; no global cross-branch overlapping assignment for the employee; job timing valid; one-active invariant (design §7). Failures SHALL return stable specific errors; Scheduling feasibility SHALL NOT be re-derived and no second availability engine SHALL exist (S15).

#### Scenario: Cross-branch conflict rejected
* **WHEN** an employee authorized for branches A and B holds an assignment in A overlapping a candidate job in B
* **THEN** the second assignment is rejected by the global conflict check

## Requirement: Assignment concurrency safety
Assignment and reassignment SHALL be single transactions that lock the job row (TD-W7); simultaneous assignment attempts SHALL never produce two non-terminal assignments at commit; retries SHALL be idempotent (same employee already actively assigned = success no-op); all assignment state SHALL be server-authoritative.

#### Scenario: Concurrent assignment race
* **WHEN** two managers assign different cleaners to the same job simultaneously
* **THEN** exactly one assignment commits and the other fails without partial state

## Requirement: Job lifecycle
Jobs SHALL use exactly `pending → assigned → en_route → checked_in → in_progress → completed` with `pending/assigned → cancelled` and no additional states (WORKER §19–20); Change 6 SHALL exercise `pending→assigned` (assignment), booking-driven `cancelled`, and the staff-authoritative `assigned→completed` path; the `en_route/checked_in/in_progress` execution triggers belong to the cleaner surface implemented by Change 7 (see Cleaner execution requirements below).

#### Scenario: Staff completion drives booking completion
* **WHEN** authorized staff complete an assigned job
* **THEN** the job is `completed` and the booking transitions to `completed` through the Booking-owned contract

## Requirement: Booking reschedule propagation
When a booking is rescheduled, the same job SHALL be kept with its interval updated (BD-W7b); the existing assignment SHALL be retained and revalidated against the new interval; an invalid assignment SHALL be flagged for manager replacement (event + flag column) and never silently unassigned; all history SHALL be preserved.

#### Scenario: Reschedule retains and revalidates assignment
* **WHEN** an assigned booking is rescheduled to a new interval
* **THEN** the job keeps its identity and assignment, and the assignment is either still valid or flagged — never dropped

## Requirement: Booking cancellation propagation
When an eligible booking is cancelled (never once the booking is `in_progress`), its job SHALL become `cancelled` from `pending/assigned`, assignments SHALL be released (`cancelled`, rows retained), the job SHALL never be deleted, and the cancellation reason SHALL be preserved with events and audit on both domains (BD-W7c).

#### Scenario: Cancelled booking cancels job
* **WHEN** a confirmed booking with a job is cancelled
* **THEN** the job is `cancelled`, assignments are released, and no rows are deleted

## Requirement: Booking no-show propagation
When a booking becomes `no_show`, its job SHALL become `cancelled` and an incident of type `no_show` SHALL be recorded on the job (BD-W7d); no new job state SHALL be created; the booking SHALL remain authoritative for the operational outcome.

#### Scenario: No-show records incident
* **WHEN** a booking is marked `no_show` with an existing job
* **THEN** the job is `cancelled` and a `no_show` incident exists linked to the job

## Requirement: Derived booking transitions via contract
Job→Booking derived transitions (`assigned`, `in_progress`, `completed`) SHALL occur only through an explicit Booking-owned, idempotent, state-guarded, audited transition contract called after the Worker transaction commits (BD-W7a/TD-W4); neither domain SHALL write the other's tables directly; derived transitions SHALL never feed back into Worker mutations (structural loop prevention).

#### Scenario: Assignment reflects on booking
* **WHEN** a job is assigned
* **THEN** the booking becomes `assigned` via the contract, and the contract cannot trigger further job mutations

## Requirement: Incidents (minimal model)
Incidents SHALL record job, reporter, documented type (including `no_show`), optional severity/description, and status (DATABASE §29); no quality/complaint workflow SHALL exist in Change 6.

#### Scenario: Minimal incident record
* **WHEN** an incident is reported on a job
* **THEN** the record persists with type/actor/timestamp and no quality workflow is triggered

## Requirement: Organization and branch isolation
All worker tables SHALL enforce organization/branch RLS using the established combined-policy pattern; branch-scoped managers SHALL only see their branches; cleaners SHALL see only their own employee row, own assignments, and jobs with their own active assignment (TD-W2); no application-role write policies SHALL exist (mutations flow through the privileged domain layer).

#### Scenario: Cleaner cannot see other cleaners' jobs
* **WHEN** a cleaner-role user queries jobs
* **THEN** only jobs with their own active assignment are visible

## Requirement: Transactional fail-closed audit and append-only events
Worker mutations SHALL write audit records transactionally (audit failure aborts the operation) and job events SHALL be append-only (updates/deletes rejected by trigger) (WORKER §66–67).

#### Scenario: Audit failure rolls back
* **WHEN** the audit insert fails during an assignment
* **THEN** the entire assignment transaction rolls back

## Requirement: Idempotency across worker mutations
Job creation, assignment, reassignment, cancellation propagation, and derived booking transitions SHALL be safe against retries (WORKER §82), reusing the established idempotency conventions.

#### Scenario: Duplicate completion submission
* **WHEN** a completion action is submitted twice
* **THEN** the second attempt is an acknowledged no-op with no duplicate events

## Requirement: Scheduling occupancy unification
Bookings SHALL remain the single authoritative Scheduling occupancy source (BD-W13/TD-W10); the Change 3 speculative jobs occupancy probe SHALL be removed so jobs never double-count; slot holds, capacity cap, and booking-driven occupancy SHALL behave exactly as in Change 5.

#### Scenario: No double counting
* **WHEN** a confirmed booking has a job and availability is queried for an overlapping interval
* **THEN** the interval is occupied exactly once — by the booking, not again by the job

## Requirement: No workforce-derived scheduling capacity
V1 Scheduling capacity SHALL remain the branch-level concurrency cap (default 3, per-branch configurable) with no workforce input (BD-W13); skills SHALL be validated at assignment time only (S8); workforce-derived capacity SHALL remain deferred to a future dedicated decision.

#### Scenario: Availability unchanged by workforce data
* **WHEN** employees, availability, or skills change
* **THEN** customer-visible availability slots are unchanged

## Requirement: Internal operations authorization
Employee administration SHALL require `employees.view`/`employees.manage`; job viewing/search `jobs.view`; job requirements `jobs.manage`; assignment operations `jobs.assign` — existing catalog permissions only, branch-scoped by membership (design §8).

#### Scenario: Branch manager scoped to own branches
* **WHEN** a branch manager lists employees or jobs
* **THEN** only their authorized branches' records are returned

## Requirement: Non-goals (explicit deferrals)
The following SHALL NOT exist and are explicitly deferred, not silently absent: push notification delivery and email/SMS/WhatsApp delivery, cleaner self-service availability/leave, acceptance/decline workflow, team cleaning, automatic assignment, payment, payroll, performance analytics, customer signature (BD-C8), GPS/location capture (BD-C6), full offline-first synchronization — the Change 7 offline support is only the lightweight idempotent action queue (BD-C5) (BD-W10; WORKER §85–86; BD-C decision record).

#### Scenario: No delivery or location artifacts
* **WHEN** the cleaner surface, notification flow, and schema are inspected
* **THEN** no push/email/SMS delivery code, no location columns or permissions, and no signature capture exist

---

# Cleaner Execution (Change 7)

## Requirement: Cleaner session authorization
Cleaner access SHALL resolve exclusively through the existing Supabase Auth session → `employees.user_id` → employee (`status='active'`) → `employee_branches` authorization → own active assignment → job chain; access SHALL be denied with a stable error when the user is unauthenticated, has no linked employee, the employee is not active, branch authorization is missing, or no active assignment binds the user to the job; no separate authentication mechanism SHALL exist and cleaner authentication SHALL NOT be mixed with customer magic-link or `/admin/*` authentication.

#### Scenario: Unlinked user denied
* **WHEN** an authenticated user with no `employees.user_id` linkage requests a cleaner route
* **THEN** access is denied with a stable error and no job data is returned

#### Scenario: Deactivated employee denied
* **WHEN** an employee is deactivated (status not `active`) while their user retains a valid session
* **THEN** every cleaner execution action and cleaner job read is denied

## Requirement: Minimized cleaner job visibility
A cleaner SHALL see, for jobs bound to their own active assignment, exactly the minimized execution data set: customer first name, customer last initial, customer phone, service address, and execution/property instructions from the job snapshot (BD-C1); the cleaner SHALL NOT see customer email, payment data or history, unrelated booking/customer history, internal staff notes, other workers' information, or any additional customer fields; completed-job history SHALL remain subject to the same minimized snapshot rules; cancelled/reassigned jobs SHALL leave the cleaner's operational surface (no active operational data after reassignment).

#### Scenario: Exactly the allowed customer field set
* **WHEN** a cleaner opens their assigned job
* **THEN** the payload contains first name, last initial, phone, service address, and execution instructions — and no email, payment data, internal notes, or unrelated history

#### Scenario: Reassignment removes operational access
* **WHEN** a cleaner's assignment is cancelled by reassignment
* **THEN** the job no longer appears in the cleaner's operational surface and further execution actions are denied

## Requirement: En-route transition
The cleaner SHALL trigger `en_route` on their own assigned job (`assigned → en_route`), recording server-authoritative `en_route_at`; the transition SHALL be idempotent; `en_route` SHALL NOT be an assignment prerequisite and the direct `assigned → checked_in` path SHALL remain valid (BD-C2); no GPS, location permission, coordinates, or tracking SHALL exist anywhere in the en-route flow (BD-C6); no new Job state SHALL be introduced.

#### Scenario: Direct check-in without en-route
* **WHEN** a cleaner checks in directly from `assigned` without en-route
* **THEN** the job transitions to `checked_in` and no artificial blocking occurs

#### Scenario: En-route without location
* **WHEN** a cleaner triggers en-route on a device that has not granted location permission
* **THEN** the transition succeeds, `en_route_at` is recorded, and no location data is requested or stored

## Requirement: Check-in, start work, and checkout
Check-in SHALL transition `assigned/en_route → checked_in` recording `checked_in_at` and `actual_start`; start work SHALL transition `checked_in → in_progress`; checkout SHALL record `checked_out_at` and `actual_end` without completing the job; all timestamps SHALL be server-authoritative; every transition SHALL be idempotent (repeat = acknowledged no-op, no duplicate events) and concurrency-safe (simultaneous transitions serialize; exactly one wins) (BD-C2/§5).

#### Scenario: Double-tapped check-in
* **WHEN** the check-in action fires twice (retry or double-tap)
* **THEN** the job is `checked_in` once with one `check_in` event and both attempts report the authoritative state

#### Scenario: Concurrent transitions from two devices
* **WHEN** the same cleaner triggers conflicting transitions from two devices simultaneously
* **THEN** exactly one transition commits and the other receives a deterministic stale-state echo

## Requirement: Checklist snapshot at execution start
At execution start (first execution action), the job SHALL receive an immutable checklist snapshot copied from the published service-scoped checklist template version (BD-C3): the snapshot SHALL record template provenance (template id + version) and frozen item definitions; item content SHALL NOT change retroactively when template configuration changes; templates SHALL be versionable (`draft/published/retired`); item completion SHALL record status, `completed_at`, `completed_by`, and optional notes; history SHALL be immutable after job completion; no production checklist content SHALL be seeded and no customer-facing editor SHALL exist; the Service Catalog SHALL NOT own execution state.

#### Scenario: Template change does not alter active snapshots
* **WHEN** a published template is superseded by a new version after jobs received snapshots of the old version
* **THEN** existing job snapshots and items remain unchanged

#### Scenario: Item completion recorded
* **WHEN** the assigned cleaner completes a checklist item with a note
* **THEN** the item status, `completed_at`, `completed_by`, and note persist and a `checklist_completed` event exists

## Requirement: Completion gates (BD-C9)
Cleaner self-completion SHALL succeed only when: (1) the job is checked in; (2) every mandatory checklist item is completed; (3) no unresolved incident of severity `high` or `critical` exists on the job; low/medium incidents SHALL NOT block; gate evaluation SHALL occur inside the completion transaction and SHALL NOT introduce a new Job state; authorized management override SHALL be server-authoritative, permission-controlled, explicitly audited, and idempotent; completion SHALL be idempotent with server-authoritative timestamps.

#### Scenario: Mandatory item blocks completion
* **WHEN** a cleaner attempts completion with a pending mandatory checklist item
* **THEN** completion is rejected with a stable error identifying the unmet gate and the job state is unchanged

#### Scenario: Critical incident blocks, low incident does not
* **WHEN** one job has an open `critical` incident and another has an open `low` incident, each attempted for completion
* **THEN** the first is rejected and the second completes

#### Scenario: Manager override
* **WHEN** authorized management overrides a completion blocker
* **THEN** the override is audited with override metadata, is idempotent, and completion proceeds through the normal path

## Requirement: Completion drives the booking contract
Cleaner completion SHALL invoke the existing Worker → Booking transition contract (`completeJob` → `applyJobDerivedBookingTransition`) post-commit so the source booking reaches `completed`; no cleaner route, action, or component SHALL write Booking tables directly (BD-C9/BD-W7a).

#### Scenario: Booking completes through the contract
* **WHEN** a cleaner completes their assigned job
* **THEN** the booking transitions to `completed` exclusively through the Booking-owned contract and no cleaner code path wrote booking rows

## Requirement: Cleaner incident reporting
The cleaner SHALL create permitted operational incidents on their own active-assignment jobs through the existing Worker incidents model (existing taxonomy, severities, statuses) — no separate cleaner incident domain SHALL exist (BD-C9/§6); high/critical unresolved incidents SHALL block self-completion per the completion-gates requirement.

#### Scenario: Cleaner reports access problem
* **WHEN** the assigned cleaner reports an `access_problem` incident with severity
* **THEN** the incident persists through the existing incidents model with actor and timestamp, and completion gating applies its severity rules

## Requirement: Job media (private, categorized)
Photo media SHALL support exactly the categories `before`, `after`, and `incident_evidence` (BD-C4); media SHALL be private, job-scoped, stored per the existing Media Storage architecture, and readable only through short-lived signed URLs issued after server authorization; `incident_evidence` media SHALL require a linked incident; limits SHALL come from Media Storage configuration (no invented values); media SHALL never be publicly accessible, exposed to customers, or uploadable offline (BD-C5).

#### Scenario: Unauthorized cross-job media access denied
* **WHEN** a cleaner requests a signed URL for media on a job without their active assignment
* **THEN** authorization fails and no signed URL is issued

#### Scenario: Category restriction enforced
* **WHEN** an upload with a category outside {before, after, incident_evidence} is attempted
* **THEN** the upload is rejected at both the domain and storage layers

## Requirement: Offline action queue (lightweight)
The cleaner PWA SHALL provide a lightweight offline action queue limited to safe idempotent execution actions (en_route, check-in, start work, checklist updates, incident actions where safely supported, checkout, completion) (BD-C5); every queued action SHALL carry an idempotency key; replay SHALL occur in deterministic order on reconnect; the server SHALL remain authoritative; stale/conflicting replays SHALL return deterministic responses; replay SHALL never duplicate events, incidents, or checklist updates; unsafe operations SHALL never silently succeed offline; media upload SHALL require connectivity; no offline database replication, unrestricted offline mutation, or on-device authoritative state SHALL exist.

#### Scenario: Replay after reconnect converges
* **WHEN** a queued check-in and checklist update replay after connectivity returns
* **THEN** both apply exactly once in order and a duplicate replay of the same idempotency key is an acknowledged no-op

#### Scenario: Stale queued action
* **WHEN** a queued completion replays after the job was cancelled server-side
* **THEN** the replay returns a deterministic conflict response and the queue surfaces the server echo without duplicating events

## Requirement: In-app notification surface
The cleaner PWA SHALL surface relevant operational events (new assignment, reassignment, schedule change, job cancellation, other approved operational changes) from the existing job-event/notification-outbox intents (BD-C7); no second notification engine SHALL be created and no push/email/SMS/WhatsApp delivery SHALL be implemented in Change 7.

#### Scenario: Reassignment surfaces in-app
* **WHEN** a job is reassigned to the cleaner
* **THEN** the event appears in the cleaner's in-app surface sourced from the existing event/outbox intent, with no delivery infrastructure invoked

## Requirement: Cleaner RLS isolation
All Change 7 tables SHALL enforce organization/branch RLS using the established combined-policy pattern; the cleaner role SHALL read checklist snapshots/items and media only for jobs with their own active assignment; `jobs`/`job_assignments` policies SHALL remain unchanged from Change 6; mutations SHALL remain server-authorized with no application-role write policies; route protection SHALL complement but never replace RLS and server-action authorization.

#### Scenario: Cross-cleaner isolation
* **WHEN** a cleaner-role user queries checklist snapshots, items, or media
* **THEN** only records of jobs with their own active assignment are returned

## Requirement: No GPS and no signature (explicit non-goals)
Change 7 SHALL NOT contain GPS coordinates, location tracking, geofencing, background location, or location-permission requests (BD-C6), and SHALL NOT contain customer signature capture, storage, verification, or completion gating (BD-C8); future location verification requires a separate decision after legal/HR/privacy review; future signature belongs to a Quality/Booking decision.

#### Scenario: No location artifacts
* **WHEN** the migration, contracts, and cleaner surface are inspected after Change 7
* **THEN** no location columns, permission requests, or tracking code exist

#### Scenario: No signature artifacts
* **WHEN** the migration and completion flow are inspected after Change 7
* **THEN** no signature fields, capture steps, or completion gates exist
