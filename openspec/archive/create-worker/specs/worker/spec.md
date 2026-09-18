## ADDED Requirements

### Requirement: Server-authoritative job creation from confirmed bookings
Jobs SHALL be created only by the Worker domain, only from confirmed bookings, immediately after the booking confirmation transaction commits (BD-W6/TD-W1). Creation SHALL be idempotent and retry-convergent: retries and concurrent attempts SHALL produce exactly one job per booking (DB-enforced partial unique), and a job-creation failure SHALL never roll back or cancel the confirmed booking.

#### Scenario: Exactly one job per confirmed booking
* **WHEN** the job-creation function runs twice (or concurrently) for the same confirmed booking
* **THEN** exactly one job exists and both attempts report success

#### Scenario: Booking survives job-creation failure
* **WHEN** job creation fails transiently after confirmation
* **THEN** the booking remains confirmed, the failure is observable, and a retry converges to exactly one job

### Requirement: Job number
Each job SHALL carry a human-readable number `JOB-<year>-<sequence>` (e.g. JOB-2026-000123), unique per organization and never reused (BD-W5); the year SHALL derive from the source booking's branch-local `scheduled_start`; the per-organization sequence SHALL be monotonic without yearly reset and allocation SHALL be concurrency-safe; the UUID SHALL remain the internal identifier.

#### Scenario: Concurrent job creation in one organization
* **WHEN** two jobs are created simultaneously in one organization
* **THEN** they receive distinct sequential numbers and both commits succeed

### Requirement: Employee records without mandatory accounts
Employees SHALL be organization-scoped records with an optional nullable Auth linkage (`user_id`, BD-W12); an employee record SHALL be able to exist without application access; application roles SHALL remain distinct from employment (BD-W12); employee numbers `EMP-<sequence>` SHALL be organization-unique, monotonic, never reused, and concurrency-safe.

#### Scenario: Employee without app access
* **WHEN** an employee record is created with no linked Auth user
* **THEN** the record is valid and assignment-eligible, and no Auth account is created

### Requirement: Employee branch authorization
Employee↔branch authorization SHALL be many-to-many via `employee_branches` (BD-W1); no scalar `employees.branch_id` authorization model SHALL exist; assignment eligibility SHALL require branch authorization via this relationship.

#### Scenario: Multi-branch employee
* **WHEN** an employee is authorized for branches A and B
* **THEN** the employee is assignment-eligible in both and in no other branch

### Requirement: Employee statuses
Employee lifecycle statuses SHALL be exactly `active`, `temporarily_unavailable`, `on_leave`, `inactive` (BD-W2); only `active` employees SHALL be assignment-eligible; deactivation SHALL block new assignments while preserving all historical records (WORKER §79).

#### Scenario: Inactive employee rejected
* **WHEN** a manager attempts to assign a job to a non-active employee
* **THEN** the assignment is rejected with a stable error and no assignment row is created

### Requirement: Employment types
Employment types SHALL be exactly `full_time`, `part_time`, `minijob`, `flexible` (BD-W3).

#### Scenario: Invalid employment type
* **WHEN** an employment type outside the canonical set is submitted
* **THEN** validation rejects it

### Requirement: Employee skills and qualification expiry
Skills SHALL be organization-wide `skill_key` strings from the documented namespace (BD-W11) on `employee_skills` with qualification metadata; `level` SHALL have no V1 semantics; an expired mandatory qualification SHALL NOT satisfy a new assignment requirement, while historical assignments SHALL remain unaffected; no skills registry table SHALL exist and no production skill seed content SHALL be introduced.

#### Scenario: Expired qualification blocks assignment
* **WHEN** a job requires a skill whose employee qualification has expired before the job start
* **THEN** the assignment is rejected with a qualification error

### Requirement: Employee availability
Recurring weekly availability with effective dating plus typed date/time exceptions SHALL be stored per employee (TD-W6); exceptions SHALL override the recurring schedule; availability SHALL be consumed only by assignment eligibility — never by Scheduling availability/capacity (BD-W13).

#### Scenario: Unavailable exception overrides schedule
* **WHEN** an `unavailable` exception overlaps a job interval that recurring availability would otherwise cover
* **THEN** the employee is not eligible for that job

### Requirement: One active assignment per job
V1 SHALL permit at most one non-terminal (active/pending) assignment per job, enforced by a database partial unique index and transactional validation (BD-W8); the assignment table SHALL remain structurally multi-row for future team cleaning; assignment history SHALL never be deleted.

#### Scenario: Second active assignment rejected
* **WHEN** a second active assignment is attempted on a job that already has one
* **THEN** the database and the domain both reject it

### Requirement: Immediate assignment without acceptance gate
Authorized managers SHALL create assignments directly as `active` (BD-W9); the job becomes `assigned` when the assignment exists; `accepted`/`declined` SHALL remain reserved future statuses with no acceptance timeout in V1; reassignment SHALL be manager-controlled and atomic (old assignment cancelled, history preserved, new assignment active, one transaction).

#### Scenario: Reassignment preserves history
* **WHEN** a manager reassigns an assigned job from cleaner A to cleaner B
* **THEN** A's assignment row is `cancelled` (retained), B's is `active`, and both appear in history

### Requirement: Assignment eligibility validation
Assignment SHALL validate, in order: employee exists; status `active`; branch authorization; required skills; qualification validity at job start; recurring availability covers the interval; no unavailable exception overlaps it; no global cross-branch overlapping assignment for the employee; job timing valid; one-active invariant (design §7). Failures SHALL return stable specific errors; Scheduling feasibility SHALL NOT be re-derived and no second availability engine SHALL exist (S15).

#### Scenario: Cross-branch conflict rejected
* **WHEN** an employee authorized for branches A and B holds an assignment in A overlapping a candidate job in B
* **THEN** the second assignment is rejected by the global conflict check

### Requirement: Assignment concurrency safety
Assignment and reassignment SHALL be single transactions that lock the job row (TD-W7); simultaneous assignment attempts SHALL never produce two non-terminal assignments at commit; retries SHALL be idempotent (same employee already actively assigned = success no-op); all assignment state SHALL be server-authoritative.

#### Scenario: Concurrent assignment race
* **WHEN** two managers assign different cleaners to the same job simultaneously
* **THEN** exactly one assignment commits and the other fails without partial state

### Requirement: Job lifecycle
Jobs SHALL use exactly `pending → assigned → en_route → checked_in → in_progress → completed` with `pending/assigned → cancelled` and no additional states (WORKER §19–20); Change 6 SHALL exercise `pending→assigned` (assignment), booking-driven `cancelled`, and the staff-authoritative `assigned→completed` path; `en_route/checked_in/in_progress` triggers SHALL belong to the Change 7 cleaner surface.

#### Scenario: Staff completion drives booking completion
* **WHEN** authorized staff complete an assigned job
* **THEN** the job is `completed` and the booking transitions to `completed` through the Booking-owned contract

### Requirement: Booking reschedule propagation
When a booking is rescheduled, the same job SHALL be kept with its interval updated (BD-W7b); the existing assignment SHALL be retained and revalidated against the new interval; an invalid assignment SHALL be flagged for manager replacement (event + flag column) and never silently unassigned; all history SHALL be preserved.

#### Scenario: Reschedule retains and revalidates assignment
* **WHEN** an assigned booking is rescheduled to a new interval
* **THEN** the job keeps its identity and assignment, and the assignment is either still valid or flagged — never dropped

### Requirement: Booking cancellation propagation
When an eligible booking is cancelled (never once the booking is `in_progress`), its job SHALL become `cancelled` from `pending/assigned`, assignments SHALL be released (`cancelled`, rows retained), the job SHALL never be deleted, and the cancellation reason SHALL be preserved with events and audit on both domains (BD-W7c).

#### Scenario: Cancelled booking cancels job
* **WHEN** a confirmed booking with a job is cancelled
* **THEN** the job is `cancelled`, assignments are released, and no rows are deleted

### Requirement: Booking no-show propagation
When a booking becomes `no_show`, its job SHALL become `cancelled` and an incident of type `no_show` SHALL be recorded on the job (BD-W7d); no new job state SHALL be created; the booking SHALL remain authoritative for the operational outcome.

#### Scenario: No-show records incident
* **WHEN** a booking is marked `no_show` with an existing job
* **THEN** the job is `cancelled` and a `no_show` incident exists linked to the job

### Requirement: Derived booking transitions via contract
Job→Booking derived transitions (`assigned`, `in_progress`, `completed`) SHALL occur only through an explicit Booking-owned, idempotent, state-guarded, audited transition contract called after the Worker transaction commits (BD-W7a/TD-W4); neither domain SHALL write the other's tables directly; derived transitions SHALL never feed back into Worker mutations (structural loop prevention).

#### Scenario: Assignment reflects on booking
* **WHEN** a job is assigned
* **THEN** the booking becomes `assigned` via the contract, and the contract cannot trigger further job mutations

### Requirement: Incidents (minimal model)
Incidents SHALL record job, reporter, documented type (including `no_show`), optional severity/description, and status (DATABASE §29); no quality/complaint workflow SHALL exist in Change 6.

#### Scenario: Minimal incident record
* **WHEN** an incident is reported on a job
* **THEN** the record persists with type/actor/timestamp and no quality workflow is triggered

### Requirement: Organization and branch isolation
All worker tables SHALL enforce organization/branch RLS using the established combined-policy pattern; branch-scoped managers SHALL only see their branches; cleaners SHALL see only their own employee row, own assignments, and jobs with their own active assignment (TD-W2); no application-role write policies SHALL exist (mutations flow through the privileged domain layer).

#### Scenario: Cleaner cannot see other cleaners' jobs
* **WHEN** a cleaner-role user queries jobs
* **THEN** only jobs with their own active assignment are visible

### Requirement: Transactional fail-closed audit and append-only events
Worker mutations SHALL write audit records transactionally (audit failure aborts the operation) and job events SHALL be append-only (updates/deletes rejected by trigger) (WORKER §66–67).

#### Scenario: Audit failure rolls back
* **WHEN** the audit insert fails during an assignment
* **THEN** the entire assignment transaction rolls back

### Requirement: Idempotency across worker mutations
Job creation, assignment, reassignment, cancellation propagation, and derived booking transitions SHALL be safe against retries (WORKER §82), reusing the established idempotency conventions.

#### Scenario: Duplicate completion submission
* **WHEN** a completion action is submitted twice
* **THEN** the second attempt is an acknowledged no-op with no duplicate events

### Requirement: Scheduling occupancy unification
Bookings SHALL remain the single authoritative Scheduling occupancy source (BD-W13/TD-W10); the Change 3 speculative jobs occupancy probe SHALL be removed so jobs never double-count; slot holds, capacity cap, and booking-driven occupancy SHALL behave exactly as in Change 5.

#### Scenario: No double counting
* **WHEN** a confirmed booking has a job and availability is queried for an overlapping interval
* **THEN** the interval is occupied exactly once — by the booking, not again by the job

### Requirement: No workforce-derived scheduling capacity
V1 Scheduling capacity SHALL remain the branch-level concurrency cap (default 3, per-branch configurable) with no workforce input (BD-W13); skills SHALL be validated at assignment time only (S8); workforce-derived capacity SHALL remain deferred to a future dedicated decision.

#### Scenario: Availability unchanged by workforce data
* **WHEN** employees, availability, or skills change
* **THEN** customer-visible availability slots are unchanged

### Requirement: Internal operations authorization
Employee administration SHALL require `employees.view`/`employees.manage`; job viewing/search `jobs.view`; job requirements `jobs.manage`; assignment operations `jobs.assign` — existing catalog permissions only, branch-scoped by membership (design §8).

#### Scenario: Branch manager scoped to own branches
* **WHEN** a branch manager lists employees or jobs
* **THEN** only their authorized branches' records are returned

### Requirement: Non-goals (explicit deferrals)
The following SHALL NOT exist in Change 6 and are explicitly deferred, not silently absent: Cleaner PWA/routes/execution flows (Change 7), checklists, photos/Storage, offline mode, push delivery, cleaner self-service, acceptance/decline workflow, team cleaning, automatic assignment, payment, payroll, notification delivery, customer signature (BD-W10; WORKER §85–86).

#### Scenario: No cleaner routes
* **WHEN** the application surface is inspected after Change 6
* **THEN** no cleaner-facing routes or PWA components exist
