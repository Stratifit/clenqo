# CLENQO Workforce and Jobs

## 1. Purpose

The Workforce and Jobs domain manages CLENQO's operational workforce and the execution of cleaning services.

It connects:

```text
Employees
    ↓
Skills & Availability
    ↓
Jobs
    ↓
Assignments
    ↓
Cleaner PWA
    ↓
Check-In
    ↓
Cleaning
    ↓
Check-Out
    ↓
Completion
    ↓
Quality / Payment / Reporting
```

The system must support:

* branch-scoped employees
* cleaner availability
* skills
* job creation
* assignment
* mobile execution
* check-in/check-out
* checklists
* notes
* photos
* incidents
* completion
* operational history

---

# 2. Core Workforce Principle

> **A booking represents the customer commitment; a job represents the work CLENQO must execute.**

The workforce system must therefore remain operationally independent from the customer-facing booking interface.

---

# 3. Employee Model

An employee is an internal CLENQO worker.

Initial employment model may support:

```text
part_time
minijob
flexible
full_time
```

Employment type is operational information and must not be confused with application authorization.

---

# 4. Employee Identity

Employee identity should connect to the authentication system where the employee requires application access.

Conceptually:

```text
Supabase Auth User
      ↓
Profile
      ↓
Employee
      ↓
Branch Membership
```

The employee record contains operational information.

Authentication remains owned by the Auth domain.

---

# 5. Employee Status

Employees should have an explicit operational status.

Possible values:

```text
active
temporarily_unavailable
on_leave
inactive
```

Inactive employees must not be assigned new jobs.

---

# 6. Branch Assignment

Employees may belong to one or more branches where the business model permits it.

Branch access must be explicit.

```text
Employee
├── Branch A
└── Branch B
```

The employee must not automatically gain access to every branch.

---

# 7. Branch Isolation

Branch managers should only see employees within their authorized branch scope.

HQ administrators may manage employees across the organization according to permissions.

RLS must enforce data isolation.

---

# 8. Employee Profile

Operational employee data may include:

```text
first_name
last_name
phone
email
preferred_language
employment_type
status
hire_date
```

Only necessary information should be exposed to other users.

---

# 9. Employee Skills

Employees may have one or more skills.

Examples:

```text
home_cleaning
deep_cleaning
commercial_cleaning
move_out_cleaning
specialized_cleaning
```

Skills may be used by the assignment engine.

---

# 10. Skill Qualification

A skill may optionally have:

```text
qualification_status
qualification_date
expiry_date
```

Expired qualifications must not satisfy skill requirements where certification is mandatory.

---

# 11. Employee Availability

Employee availability is based on:

```text
working schedule
availability
leave
exceptions
existing jobs
branch
status
```

This information feeds the scheduling system.

---

# 12. Working Schedule

An employee may have recurring working hours.

Example:

```text
Monday      09:00–17:00
Tuesday     09:00–17:00
Wednesday   09:00–17:00
Thursday    09:00–17:00
Friday      09:00–17:00
```

Actual schedules are configuration/data, not hardcoded.

---

# 13. Availability Exceptions

Exceptions may include:

```text
vacation
sick leave
training
personal leave
temporary unavailability
schedule adjustment
```

Exceptions override the normal recurring schedule.

---

# 14. Employee Timezone

Employee scheduling should be timezone-aware.

The branch timezone is the default operational timezone unless the employee has an explicitly supported different timezone.

---

# 15. Job Definition

A job is an operational work item generated from a booking or created internally.

A job should contain:

```text
branch
booking
service
scheduled_start
scheduled_end
status
instructions
```

---

# 16. Job Number

Jobs may have a human-readable identifier separate from the booking number.

Example:

```text
JOB-2026-000123
```

Internal UUIDs remain the primary identifiers.

---

# 17. Booking-to-Job Relationship

A confirmed booking normally creates a job.

```text
Booking
   ↓
Job
```

The relationship should be traceable.

A job must not exist for an unrelated customer transaction unless it was intentionally created as an internal operational job.

---

# 18. Multiple Jobs

The architecture should support one booking generating multiple jobs.

Examples:

```text
large commercial booking
multi-day service
multi-team operation
```

The MVP may initially use one booking → one job.

---

# 19. Job Status

Initial operational states:

```text
pending
assigned
en_route
checked_in
in_progress
completed
cancelled
```

Additional states may be introduced only when they represent a real business requirement.

---

# 20. Job State Machine

Typical flow:

```text
pending
   ↓
assigned
   ↓
en_route
   ↓
checked_in
   ↓
in_progress
   ↓
completed
```

Cancellation is possible from permitted states.

---

# 21. Job Assignment

A job may have one or more assignments.

```text
Job
├── Cleaner A
└── Cleaner B
```

This supports future team cleaning.

---

# 22. Assignment Status

Assignments may use:

```text
pending
accepted
declined
active
completed
cancelled
```

The exact implementation should remain aligned with the job lifecycle.

---

# 23. Assignment Rules

Assignments must validate:

* employee active
* employee authorized for branch
* employee skill
* employee availability
* schedule conflict
* job requirements

---

# 24. Manual Assignment

The first operational implementation may allow authorized dashboard users to assign jobs manually.

```text
Job
 ↓
Select Cleaner
 ↓
Validate
 ↓
Assign
```

The system must still validate scheduling constraints.

---

# 25. Automatic Assignment

Automatic assignment can be introduced later.

Potential factors:

```text
skills
availability
distance
travel time
workload
employee preferences
fairness
service requirements
```

The assignment algorithm must remain isolated from the core job model.

---

# 26. Cleaner PWA

The cleaner experience should be a mobile-first Progressive Web App.

Primary goals:

* fast
* simple
* reliable
* touch-friendly
* low cognitive load
* usable while working

---

# 27. Cleaner PWA Home

The cleaner should see:

```text
Today's Jobs
Next Job
Schedule
Notifications
Profile
```

The primary focus should be the next actionable task.

---

# 28. Cleaner Job List

Jobs should be grouped by:

```text
Today
Tomorrow
Upcoming
Completed
```

Only authorized jobs should appear.

---

# 29. Cleaner Job Detail

A cleaner should see relevant information:

```text
Service
Customer first name
Address
Scheduled time
Duration
Instructions
Checklist
Special notes
```

Sensitive customer information should be minimized.

---

# 30. Customer Privacy for Cleaners

Cleaners should not automatically receive unnecessary customer information.

Examples that may require restriction:

```text
full payment details
internal customer notes
private administrative information
```

The PWA should expose only operationally necessary data.

> **Resolved (BD-C1 — Change 7 decision record):** the cleaner-visible customer
> field set is exactly: **customer first name, last initial, phone number,
> service address, and the cleaning/property instructions required for
> execution** (the phone is the documented operational contact field,
> SECURITY.md §46). The cleaner must NOT see: customer email, payment
> information or payment history, booking history beyond the assigned job,
> internal staff notes, unrelated customer information, or other workers'
> information. The Change 6 minimized `customer_display` job snapshot remains
> the foundation, extended only with the phone number. **History visibility:**
> the cleaner's V1 job history may list completed jobs previously assigned to
> them, always limited to the same minimized snapshot. **Cancelled/reassigned
> jobs:** the cleaner retains operational access only while an assignment is
> active; after reassignment or cancellation the job disappears from the
> operational surface (historical records exist only in the manager/audit
> surfaces). Access remains limited to currently authorized jobs/assignments.

---

# 31. Navigation

The cleaner may need:

```text
Open Maps
```

The application may pass the service address to a mapping application without exposing unnecessary internal data.

---

# 32. Check-In

A cleaner may check in when arriving.

Possible data:

```text
checked_in_at
```

> **Resolved (BD-C2, BD-C6 — Change 7 decision record):** the execution flow is
> `assigned → en_route → checked_in → in_progress → completed` with an explicit
> cleaner "On my way" (`en_route`) action — only the currently assigned cleaner
> may trigger it, the server is authoritative, the action is idempotent, and
> `en_route` is not a prerequisite for assignment or a hard gate for check-in
> (a direct `assigned → checked_in` remains permitted when the Worker
> transition contract allows it). Server-authoritative `en_route_at` is
> recorded. **No GPS/location capture exists in V1**: no check-in or en-route
> coordinates, no continuous/background tracking, no location permission
> request — the PWA works fully without location access. Location verification
> may be reconsidered only after explicit legal/privacy review and a separate
> business decision (LEGAL_COMPLIANCE §40–41).

Location tracking must not be introduced unnecessarily.

---

# 33. Check-In Rules

Check-in should normally be allowed only:

* for an assigned job
* within an appropriate time window
* by the assigned employee

Authorized managers may have override capability.

---

# 34. Check-In Accuracy

The system must use server-generated timestamps.

The client cannot be trusted to provide the authoritative check-in time.

---

# 35. Starting Work

After check-in:

```text
checked_in
 ↓
in_progress
```

The start action should be recorded as an event.

---

# 36. Cleaning Checklist

Jobs may have a checklist.

Example:

```text
☐ Kitchen
☐ Bathroom
☐ Bedrooms
☐ Floors
☐ Dusting
☐ Waste
```

Checklist items should be service-specific where required.

---

# 37. Checklist Templates

Future checklist templates may be associated with:

```text
service
service variant
branch
job type
```

The checklist should be generated when the job starts rather than dynamically changing historical requirements during execution.

> **Resolved (BD-C3 — Change 7 decision record):** V1 uses a **service-level
> checklist definition copied into a job-specific immutable checklist snapshot
> when execution begins** (Service Checklist Definition → job starts → Job
> Checklist Snapshot → items → cleaner completes items). Item completion
> records status, `completed_at`, `completed_by`, and optional notes;
> historical checklist state is immutable after completion and never changes
> retroactively when service configuration changes. Checklist templates are
> versionable. There is no arbitrary customer-facing checklist editor in
> Change 7, and branch/service-specific checklist configuration respects the
> existing branch/service ownership boundaries. No production checklist items
> are invented or seeded in Change 7. Mandatory items gate completion only per
> §51/BD-C9.

---

# 38. Checklist Completion

Each item may contain:

```text
status
completed_at
completed_by
notes
```

The job can require all mandatory items before completion.

---

# 39. Photos

The cleaner may capture photos where configured.

Possible purposes:

```text
before condition
after condition
damage
quality evidence
incident
```

> **Resolved (BD-C4 — Change 7 decision record):** V1 enables exactly three
> categories — **before**, **after**, and **incident-evidence** photos. Damage
> and quality-evidence capture remain disabled until a later decision. Photos
> are private by default, job-scoped, authorized through the Worker/Cleaner
> access model, and served only via short-lived signed URLs after
> authorization (MEDIA_STORAGE §27/§32). No public URLs, no customer-visible
> gallery; customer exposure of selected photos remains a future,
> explicitly-classified feature (§42). Size/type limits are configured through
> the Media Storage implementation (per-category allow-lists), not invented as
> arbitrary values; the bucket name is finalized during implementation as
> MEDIA_STORAGE §10 anticipates.

Photos should be stored securely in Supabase Storage.

---

# 40. Photo Metadata

A photo record may include:

```text
job_id
uploaded_by
storage_path
category
created_at
```

Do not store image binaries in PostgreSQL.

---

# 41. Photo Privacy

Photos may contain personal information.

Access must be restricted according to role and purpose.

Public exposure is prohibited unless explicitly authorized.

---

# 42. Customer-Visible Photos

Future functionality may allow selected photos to appear in the customer portal.

This must require explicit classification/permission.

Cleaner-uploaded photos must not automatically become customer-visible.

---

# 43. Incidents

Cleaners need a way to report operational incidents.

Examples:

```text
property damage
unsafe condition
customer unavailable
access problem
missing equipment
unexpected condition
```

---

# 44. Incident Record

An incident should contain:

```text
job
reported_by
type
description
severity
created_at
status
```

---

# 45. Incident Severity

Possible levels:

```text
low
medium
high
critical
```

The final definitions should be established by operations.

---

# 46. Incident Escalation

Critical incidents may trigger immediate notifications to:

```text
branch manager
operations staff
HQ
```

according to configured escalation rules.

---

# 47. Cleaner Notes

Cleaners may add operational notes.

Notes should be associated with the job.

Example:

```text
"Customer requested extra attention to the kitchen floor."
```

---

# 48. Internal Notes

Some notes are staff-only.

The system must distinguish:

```text
customer-visible notes
internal notes
```

Permissions must enforce the distinction.

---

# 49. Check-Out

After completing the service, the cleaner checks out.

The system records:

```text
checked_out_at
```

and may calculate:

```text
actual_duration
```

---

# 50. Actual Duration

Actual duration should be recorded separately from estimated duration.

```text
estimated_duration = 180 min
actual_duration = 195 min
```

This data can later improve forecasting.

---

# 51. Completion Validation

Before completion, the system may require:

* mandatory checklist completed
* required incident handled
* required photos uploaded
* check-in completed
* check-out completed

Requirements should be service/branch configurable.

> **Resolved (BD-C9 — Change 7 decision record):** V1 completion gates are:
> 1) the cleaner must have checked in before completing the job; 2) mandatory
> checklist items must be completed; 3) an unresolved **high or critical**
> incident blocks cleaner self-completion (low/medium incidents do not block);
> 4) authorized management may resolve or override blockers through an
> explicit, server-authoritative, audited action; 5) the cleaner never
> transitions Booking state directly — successful job completion invokes the
> existing Worker → Booking transition contract; 6) completion timestamps are
> server-authoritative; 7) completion is idempotent. Blocked completion is a
> validation rule, not a new job state.

---

# 52. Completing a Job

Typical flow:

```text
Checklist
 ↓
Notes
 ↓
Photos
 ↓
Check-Out
 ↓
Completion Validation
 ↓
Job Completed
 ↓
Booking Completed
```

---

# 53. Booking Completion

The booking should transition to `completed` based on the operational completion rules.

The job remains the operational source for execution details.

---

# 54. Quality Integration

Completed jobs may trigger quality processes.

Examples:

```text
review request
quality check
manager inspection
customer complaint workflow
```

The Quality domain owns those processes.

---

# 55. Payment Integration

Completion may trigger payment processing when the branch uses payment-after-completion.

Conceptually:

```text
Job Completed
 ↓
Booking Completed
 ↓
Payment Request / Invoice
```

The payment system remains separate.

---

# 56. Cleaner Tips

If tipping is supported:

```text
Customer Tip
 ↓
Cleaner
```

The business rule may specify that 100% of the tip belongs to the cleaner.

The financial system must record this separately from service revenue.

---

# 57. Equipment

Future versions may track:

```text
equipment
supplies
vehicle
keys
```

Do not introduce inventory complexity into the MVP unless operationally necessary.

---

# 58. Cleaner Availability Updates

The cleaner may eventually report:

```text
availability
unavailability
leave request
schedule preference
```

Manager approval rules should apply where required.

---

# 59. Employee Leave

Leave should affect availability.

Conceptually:

```text
Leave
 ↓
Employee Unavailable
 ↓
Scheduling Updates
 ↓
Affected Jobs Identified
```

Existing assigned jobs must be handled explicitly.

---

# 60. Assignment Conflict Handling

If an assigned cleaner becomes unavailable:

```text
Detect conflict
 ↓
Flag job
 ↓
Notify manager
 ↓
Find replacement
```

The system must not silently leave a job unassigned.

---

# 61. Cleaner Job Notifications

The cleaner should receive notifications for:

* new assignment
* assignment change
* cancellation
* schedule change
* important incident/update

The notification engine owns delivery.

> **Resolved (BD-C7 — Change 7 decision record):** Change 7 ships an **in-app**
> notification surface only. Notification intents continue to originate from
> the Worker event/outbox system; no push, email, SMS, or WhatsApp delivery is
> implemented in Change 7 and no second notification engine is created. Push
> delivery remains a future Notification-domain capability.

---

# 62. Offline Resilience

The PWA should tolerate temporary connectivity problems where practical.

Critical actions such as:

```text
check-in
check-out
checklist update
incident submission
```

should be designed to avoid accidental data loss.

---

# 63. Offline Strategy

> **Resolved (BD-C5 — Change 7 decision record):** V1 uses a **lightweight
> offline action queue**, not a full offline-first application. Only idempotent
> execution actions may be queued locally (en_route, check-in, start work,
> checklist item updates, incident creation, and check-out/completion where
> technically safe); queued actions replay when connectivity returns and the
> server remains authoritative — stale or conflicting replays receive
> deterministic server responses, and duplicate replays never duplicate
> events, incidents, or checklist updates. No authoritative job state lives
> only on-device, unrestricted offline browsing is not promised, and offline
> media upload is out of scope for V1 (photos may require connectivity). When
> an action cannot be safely queued, the UI shows an explicit pending/error
> state. The design must allow increasing offline complexity later without
> replacing the Worker domain.

The initial implementation may use a lightweight approach:

```text
local pending state
 ↓
connection restored
 ↓
server synchronization
```

Synchronization must be idempotent.

Do not build a complex offline-first architecture unless field conditions require it.

---

# 64. Duplicate Action Protection

A cleaner pressing:

```text
Complete Job
```

multiple times must not create multiple completion events or duplicate downstream actions.

---

# 65. Server Authority

The server remains authoritative for:

* job status
* assignment
* check-in timestamp
* check-out timestamp
* completion
* employee permissions

Client state is never authoritative.

---

# 66. Job Events

Important job events should be recorded.

Examples:

```text
job_created
job_assigned
assignment_accepted
assignment_declined
job_started
check_in
checklist_completed
incident_reported
job_completed
check_out
job_cancelled
```

---

# 67. Audit Trail

Administrative changes should also produce audit logs.

Examples:

```text
manager manually reassigns job
admin changes job time
manager overrides completion
```

---

# 68. Job Search

Authorized dashboard users should be able to search by:

* job number
* booking number
* customer
* cleaner
* date
* status
* branch

---

# 69. Job Dashboard

The operations dashboard should provide:

```text
Today's Jobs
Unassigned
Assigned
In Progress
Completed
Issues
```

---

# 70. Daily Operations View

Branch managers should have a concise operational view:

```text
Total Jobs
Unassigned
Starting Soon
In Progress
Completed
At Risk
Incidents
```

---

# 71. At-Risk Jobs

A job may be flagged as at risk when:

```text
not assigned
cleaner unavailable
late
schedule conflict
incident unresolved
customer access issue
```

This should help managers intervene before service failure.

---

# 72. Late Job Detection

Future automation may detect:

```text
expected check-in time passed
```

and notify the appropriate operational user.

---

# 73. Service Completion Evidence

The system should preserve operational evidence when required:

```text
check-in
check-out
checklist
photos
notes
incidents
```

This supports quality and dispute resolution.

---

# 74. Employee Performance Data

The system may later calculate:

```text
on-time rate
completion rate
customer rating
average duration
incident rate
```

These metrics must be interpreted carefully and must not automatically become disciplinary decisions.

---

# 75. Privacy

Workforce data may include sensitive employee information.

The application must apply:

* least privilege
* branch scoping
* RLS
* role-based permissions
* data minimization

---

# 76. Cleaner Access

A cleaner should access only:

```text
their profile
their assignments
their permitted jobs
their operational notifications
```

They must not access another cleaner's jobs merely by changing a URL or identifier.

---

# 77. Branch Manager Access

A branch manager may access:

```text
employees
jobs
assignments
branch schedules
operational incidents
```

only for authorized branches.

---

# 78. HQ Access

HQ users with the appropriate permissions may access cross-branch workforce data.

HQ access must still use explicit authorization.

---

# 79. Workforce Deactivation

When an employee becomes inactive:

```text
No new assignments
```

Existing jobs must be reviewed.

The system should identify affected future assignments.

---

# 80. Data Integrity

Database constraints must protect:

* valid employee references
* valid branch references
* valid job references
* valid assignments
* unique relationships
* valid status transitions where enforceable

---

# 81. Transactional Operations

Critical operations should use transactions where multiple records must change together.

Examples:

```text
assign job
reschedule job
cancel job
complete job
replace cleaner
```

---

# 82. Idempotency

Critical workforce actions should be safe against retries.

Examples:

```text
assignment
check-in
check-out
completion
incident submission
```

---

# 83. Observability

Useful metrics include:

```text
jobs_created
jobs_assigned
assignment_failures
late_jobs
completed_jobs
cancelled_jobs
no_shows
incidents
average_actual_duration
```

---

# 84. Testing Strategy

Automated tests should cover:

```text
employee authorization
branch isolation
skills
availability
leave
assignment
overlap
check-in
check-out
checklists
incidents
photos
completion
cancellation
duplicate actions
offline synchronization
```

---

# 85. MVP Workforce Scope

Initial implementation should include:

```text
employee records
branch assignment
employee status
skills
basic availability
jobs
manual assignment
cleaner PWA
job details
check-in
check-out
checklist
notes
basic photos
incidents
job completion
booking completion
notifications
```

> **Change 7 decision record (BD-C1…BD-C9, resolved 2026-09):** the Cleaner
> Execution PWA implements this MVP scope with the following resolved
> boundaries — minimized customer data (first name, last initial, phone,
> service address, execution instructions; no email/payment/internal notes;
> BD-C1) · `en_route` included as a cleaner action with server-authoritative
> `en_route_at` (BD-C2) · service-defined checklist copied into an immutable
> job snapshot at execution start, versionable templates, no seeded content
> (BD-C3) · before/after/incident-evidence photos only, private, job-scoped,
> signed-URL access (BD-C4) · lightweight offline action queue for idempotent
> execution actions, never full offline-first (BD-C5) · **no GPS/location
> capture whatsoever** (BD-C6) · in-app notification surface consuming
> existing event/outbox intents, no delivery infrastructure (BD-C7) ·
> **customer signature deferred** to a future Quality/Booking decision
> (BD-C8) · completion gates = checked-in + mandatory checklist complete +
> no unresolved high/critical incident, manager override audited, idempotent,
> booking transition only via the existing contract (BD-C9).
>
> **Implemented (Change 7, `create-cleaner-pwa`):** the execution surface is
> live under `/cleaner` (Today / Tomorrow / Upcoming / Completed lists + job
> detail) backed by Worker-owned server-authoritative contracts
> (`features/worker/execution.ts`): enRoute → checkIn → startWork →
> checklist updates → incident reporting → before/after/incident_evidence
> media → checkOut → completion with BD-C9 gates evaluated transactionally
> and deterministic `COMPLETION_BLOCKED` results; `assigned → checked_in`
> remains permitted without en_route. Checklist templates are service-
> scoped and versioned; job snapshots are immutable at execution start.
> Media is private, job-scoped, signed-URL-only (BD-C4). The installable
> PWA (manifest + service worker, app-shell caching only) includes the
> lightweight idempotent offline action queue — no offline media, no
> sensitive-data caching. Migration `0013_cleaner_execution.sql` adds the
> execution timestamps, checklist structures, and `job_media`.

---

# 86. Future Workforce Capabilities

Future versions may add:

* automatic assignment
* route optimization
* travel-time optimization
* cleaner preferences
* team assignments
* equipment management
* advanced offline mode
* payroll integration
* performance analytics
* workforce forecasting
* AI-assisted scheduling

---

# 87. Architectural Boundary

The Workforce and Jobs domain owns:

```text
employees
skills
employee operational availability
jobs
assignments
job execution
checklists
incidents
completion
```

It does not own:

```text
authentication
customer booking
pricing
payment processing
CMS
notification delivery
```

---

# 88. Integration Model

The primary flow is:

```text
Booking
   ↓
Job
   ↓
Availability
   ↓
Assignment
   ↓
Cleaner PWA
   ↓
Execution
   ↓
Completion
   ↓
Quality / Payment / Notifications
```

---

# 89. Golden Workforce Rule

> **Every operational job must have a clear branch, service, schedule, status, and assignment state, while every cleaner action must be authorized, timestamped, auditable, and safely connected to the underlying booking.**
