## ADDED Requirements

### Requirement: Cleaner session authorization
Cleaner access SHALL resolve exclusively through the existing Supabase Auth session → `employees.user_id` → employee (`status='active'`) → `employee_branches` authorization → own active assignment → job chain; access SHALL be denied with a stable error when the user is unauthenticated, has no linked employee, the employee is not active, branch authorization is missing, or no active assignment binds the user to the job; no separate authentication mechanism SHALL exist and cleaner authentication SHALL NOT be mixed with customer magic-link or `/admin/*` authentication.

#### Scenario: Unlinked user denied
* **WHEN** an authenticated user with no `employees.user_id` linkage requests a cleaner route
* **THEN** access is denied with a stable error and no job data is returned

#### Scenario: Deactivated employee denied
* **WHEN** an employee is deactivated (status not `active`) while their user retains a valid session
* **THEN** every cleaner execution action and cleaner job read is denied

### Requirement: Minimized cleaner job visibility
A cleaner SHALL see, for jobs bound to their own active assignment, exactly the minimized execution data set: customer first name, customer last initial, customer phone, service address, and execution/property instructions from the job snapshot (BD-C1); the cleaner SHALL NOT see customer email, payment data or history, unrelated booking/customer history, internal staff notes, other workers' information, or any additional customer fields; completed-job history SHALL remain subject to the same minimized snapshot rules; cancelled/reassigned jobs SHALL leave the cleaner's operational surface (no active operational data after reassignment).

#### Scenario: Exactly the allowed customer field set
* **WHEN** a cleaner opens their assigned job
* **THEN** the payload contains first name, last initial, phone, service address, and execution instructions — and no email, payment data, internal notes, or unrelated history

#### Scenario: Reassignment removes operational access
* **WHEN** a cleaner's assignment is cancelled by reassignment
* **THEN** the job no longer appears in the cleaner's operational surface and further execution actions are denied

### Requirement: En-route transition
The cleaner SHALL trigger `en_route` on their own assigned job (`assigned → en_route`), recording server-authoritative `en_route_at`; the transition SHALL be idempotent; `en_route` SHALL NOT be an assignment prerequisite and the direct `assigned → checked_in` path SHALL remain valid (BD-C2); no GPS, location permission, coordinates, or tracking SHALL exist anywhere in the en-route flow (BD-C6); no new Job state SHALL be introduced.

#### Scenario: Direct check-in without en-route
* **WHEN** a cleaner checks in directly from `assigned` without en-route
* **THEN** the job transitions to `checked_in` and no artificial blocking occurs

#### Scenario: En-route without location
* **WHEN** a cleaner triggers en-route on a device that has not granted location permission
* **THEN** the transition succeeds, `en_route_at` is recorded, and no location data is requested or stored

### Requirement: Check-in, start work, and checkout
Check-in SHALL transition `assigned/en_route → checked_in` recording `checked_in_at` and `actual_start`; start work SHALL transition `checked_in → in_progress`; checkout SHALL record `checked_out_at` and `actual_end` without completing the job; all timestamps SHALL be server-authoritative; every transition SHALL be idempotent (repeat = acknowledged no-op, no duplicate events) and concurrency-safe (simultaneous transitions serialize; exactly one wins) (BD-C2/§5).

#### Scenario: Double-tapped check-in
* **WHEN** the check-in action fires twice (retry or double-tap)
* **THEN** the job is `checked_in` once with one `check_in` event and both attempts report the authoritative state

#### Scenario: Concurrent transitions from two devices
* **WHEN** the same cleaner triggers conflicting transitions from two devices simultaneously
* **THEN** exactly one transition commits and the other receives a deterministic stale-state echo

### Requirement: Checklist snapshot at execution start
At execution start (first execution action), the job SHALL receive an immutable checklist snapshot copied from the published service-scoped checklist template version (BD-C3): the snapshot SHALL record template provenance (template id + version) and frozen item definitions; item content SHALL NOT change retroactively when template configuration changes; templates SHALL be versionable (`draft/published/retired`); item completion SHALL record status, `completed_at`, `completed_by`, and optional notes; history SHALL be immutable after job completion; no production checklist content SHALL be seeded and no customer-facing editor SHALL exist; the Service Catalog SHALL NOT own execution state.

#### Scenario: Template change does not alter active snapshots
* **WHEN** a published template is superseded by a new version after jobs received snapshots of the old version
* **THEN** existing job snapshots and items remain unchanged

#### Scenario: Item completion recorded
* **WHEN** the assigned cleaner completes a checklist item with a note
* **THEN** the item status, `completed_at`, `completed_by`, and note persist and a `checklist_completed` event exists

### Requirement: Completion gates (BD-C9)
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

### Requirement: Completion drives the booking contract
Cleaner completion SHALL invoke the existing Worker → Booking transition contract (`completeJob` → `applyJobDerivedBookingTransition`) post-commit so the source booking reaches `completed`; no cleaner route, action, or component SHALL write Booking tables directly (BD-C9/BD-W7a).

#### Scenario: Booking completes through the contract
* **WHEN** a cleaner completes their assigned job
* **THEN** the booking transitions to `completed` exclusively through the Booking-owned contract and no cleaner code path wrote booking rows

### Requirement: Cleaner incident reporting
The cleaner SHALL create permitted operational incidents on their own active-assignment jobs through the existing Worker incidents model (existing taxonomy, severities, statuses) — no separate cleaner incident domain SHALL exist (BD-C9/§6); high/critical unresolved incidents SHALL block self-completion per the completion-gates requirement.

#### Scenario: Cleaner reports access problem
* **WHEN** the assigned cleaner reports an `access_problem` incident with severity
* **THEN** the incident persists through the existing incidents model with actor and timestamp, and completion gating applies its severity rules

### Requirement: Job media (private, categorized)
Photo media SHALL support exactly the categories `before`, `after`, and `incident_evidence` (BD-C4); media SHALL be private, job-scoped, stored per the existing Media Storage architecture, and readable only through short-lived signed URLs issued after server authorization; `incident_evidence` media SHALL require a linked incident; limits SHALL come from Media Storage configuration (no invented values); media SHALL never be publicly accessible, exposed to customers, or uploadable offline (BD-C5).

#### Scenario: Unauthorized cross-job media access denied
* **WHEN** a cleaner requests a signed URL for media on a job without their active assignment
* **THEN** authorization fails and no signed URL is issued

#### Scenario: Category restriction enforced
* **WHEN** an upload with a category outside {before, after, incident_evidence} is attempted
* **THEN** the upload is rejected at both the domain and storage layers

### Requirement: Offline action queue (lightweight)
The cleaner PWA SHALL provide a lightweight offline action queue limited to safe idempotent execution actions (en_route, check-in, start work, checklist updates, incident actions where safely supported, checkout, completion) (BD-C5); every queued action SHALL carry an idempotency key; replay SHALL occur in deterministic order on reconnect; the server SHALL remain authoritative; stale/conflicting replays SHALL return deterministic responses; replay SHALL never duplicate events, incidents, or checklist updates; unsafe operations SHALL never silently succeed offline; media upload SHALL require connectivity; no offline database replication, unrestricted offline mutation, or on-device authoritative state SHALL exist.

#### Scenario: Replay after reconnect converges
* **WHEN** a queued check-in and checklist update replay after connectivity returns
* **THEN** both apply exactly once in order and a duplicate replay of the same idempotency key is an acknowledged no-op

#### Scenario: Stale queued action
* **WHEN** a queued completion replays after the job was cancelled server-side
* **THEN** the replay returns a deterministic conflict response and the queue surfaces the server echo without duplicating events

### Requirement: In-app notification surface
The cleaner PWA SHALL surface relevant operational events (new assignment, reassignment, schedule change, job cancellation, other approved operational changes) from the existing job-event/notification-outbox intents (BD-C7); no second notification engine SHALL be created and no push/email/SMS/WhatsApp delivery SHALL be implemented in Change 7.

#### Scenario: Reassignment surfaces in-app
* **WHEN** a job is reassigned to the cleaner
* **THEN** the event appears in the cleaner's in-app surface sourced from the existing event/outbox intent, with no delivery infrastructure invoked

### Requirement: Cleaner RLS isolation
All Change 7 tables SHALL enforce organization/branch RLS using the established combined-policy pattern; the cleaner role SHALL read checklist snapshots/items and media only for jobs with their own active assignment; `jobs`/`job_assignments` policies SHALL remain unchanged from Change 6; mutations SHALL remain server-authorized with no application-role write policies; route protection SHALL complement but never replace RLS and server-action authorization.

#### Scenario: Cross-cleaner isolation
* **WHEN** a cleaner-role user queries checklist snapshots, items, or media
* **THEN** only records of jobs with their own active assignment are returned

### Requirement: No GPS and no signature (explicit non-goals)
Change 7 SHALL NOT contain GPS coordinates, location tracking, geofencing, background location, or location-permission requests (BD-C6), and SHALL NOT contain customer signature capture, storage, verification, or completion gating (BD-C8); future location verification requires a separate decision after legal/HR/privacy review; future signature belongs to a Quality/Booking decision.

#### Scenario: No location artifacts
* **WHEN** the migration, contracts, and cleaner surface are inspected after Change 7
* **THEN** no location columns, permission requests, or tracking code exist

#### Scenario: No signature artifacts
* **WHEN** the migration and completion flow are inspected after Change 7
* **THEN** no signature fields, capture steps, or completion gates exist
