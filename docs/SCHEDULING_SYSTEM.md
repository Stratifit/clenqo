# CLENQO Availability and Scheduling

## 1. Purpose

The CLENQO Availability and Scheduling system determines when cleaning services can be offered and how confirmed bookings become operational work.

It connects:

```text
Branch Configuration
        ↓
Operating Hours
        ↓
Service Availability
        ↓
Employee Availability
        ↓
Existing Jobs
        ↓
Service Duration
        ↓
Buffers / Travel
        ↓
Capacity
        ↓
Available Time Slots
        ↓
Booking
        ↓
Job Scheduling
        ↓
Cleaner Assignment
```

The system must prioritize:

* correctness
* no double booking
* branch isolation
* timezone correctness
* deterministic availability
* operational feasibility
* extensibility

---

# 2. Core Scheduling Principle

> **A time slot is available only when CLENQO can realistically fulfill the service under the current branch, service, capacity, employee, and scheduling constraints.**

A visually open slot is not sufficient.

---

# 3. Availability vs Scheduling

These are related but separate concepts.

### Availability

Answers:

> Can CLENQO accept this booking at this time?

### Scheduling

Answers:

> How will CLENQO operationally fulfill this booking?

Conceptually:

```text
Availability
    ↓
Booking
    ↓
Scheduling
    ↓
Assignment
```

---

# 4. Source of Truth

Availability is calculated server-side.

The frontend may request:

```text
available dates
available time slots
```

but the server is authoritative.

A slot displayed as available may become unavailable before confirmation.

Therefore confirmation must always perform a fresh availability check.

---

# 5. Branch Scope

All availability calculations are branch-scoped.

A branch may have its own:

* operating hours
* employees
* services
* service area
* capacity
* holidays
* booking rules
* buffers
* lead times

One branch must never consume another branch's operational capacity.

---

# 6. Timezone

Every branch must have an explicit timezone.

Example:

```text
Europe/Berlin
```

Database timestamps should be stored in UTC.

Availability is calculated in the branch's local timezone.

---

# 7. Daylight Saving Time

The scheduling system must correctly handle daylight saving time.

It must not assume:

```text
one local hour = one fixed UTC hour
```

All recurring schedules must be timezone-aware.

---

# 8. Branch Operating Hours

A branch may define operating hours by weekday.

Example:

```text
Monday      08:00–18:00
Tuesday     08:00–18:00
Wednesday   08:00–18:00
Thursday    08:00–18:00
Friday      08:00–18:00
Saturday    09:00–16:00
Sunday      Closed
```

These are configuration examples only.

Actual values belong to branch configuration.

---

# 9. Operating Hours vs Service Hours

Branch operating hours do not necessarily mean every service can be booked throughout those hours.

For example:

```text
Branch:
08:00–18:00

Night Cleaning:
20:00–23:00
```

A service may have its own permitted schedule.

---

# 10. Service Availability

Each service may define:

```text
available_days
available_time_windows
minimum_notice
maximum_advance_booking
required_skills
minimum_duration
```

A service must be active at the branch before it can be booked.

---

# 11. Service Variant Availability

Variants may have different scheduling rules.

Example:

```text
Regular Cleaning
→ standard hours

Deep Cleaning
→ longer duration

Move-Out Cleaning
→ special availability
```

The availability engine must resolve the selected variant.

---

# 12. Employee Availability

Cleaner availability is based on:

```text
employment status
branch assignment
working schedule
availability
approved leave
exceptions
existing jobs
skills
```

An unavailable employee must not be counted toward capacity.

---

# 13. Employee Working Hours

Employee schedules may differ.

Example:

```text
Cleaner A
09:00–17:00

Cleaner B
12:00–20:00
```

The scheduling engine must work with individual schedules.

---

# 14. Employee Exceptions

Exceptions override normal availability.

Examples:

```text
vacation
sick leave
training
holiday
personal leave
temporary unavailability
```

Exceptions must be date/time scoped.

---

# 15. Employee Skills

A booking may require specific skills.

Examples:

```text
deep_cleaning
commercial_cleaning
move_out
specialized_cleaning
```

Only qualified employees should be considered.

---

# 16. Existing Jobs

Availability must consider jobs already scheduled.

Conceptually:

```text
Employee Schedule
+
Existing Jobs
=
Remaining Availability
```

---

# 17. Job Duration

The availability engine uses the authoritative duration produced by the pricing/service rules.

Example:

```text
Estimated duration = 180 minutes
```

The slot must provide sufficient time.

---

# 18. Buffers

Scheduling may include buffers before or after jobs.

Examples:

```text
travel
equipment preparation
parking
handover
cleanup
```

Buffers should be configurable.

---

# 19. Travel Time

Future versions may calculate travel time between jobs.

Possible inputs:

```text
origin
destination
transport mode
traffic estimate
branch policy
```

The initial implementation may use fixed buffers rather than live routing.

---

# 20. Capacity

Availability should support multiple cleaners working simultaneously.

Example:

```text
Branch capacity at 10:00
= 3 available qualified cleaners
```

If two jobs occupy two cleaners:

```text
Remaining capacity = 1
```

---

# 21. Capacity Models

The system should support future capacity strategies.

Examples:

```text
individual cleaner capacity
team capacity
branch capacity
service-specific capacity
```

---

# 22. Booking Slot Granularity

Slots should use configurable intervals.

Examples:

```text
15 minutes
30 minutes
60 minutes
```

The booking engine should not assume every service begins on the hour.

---

# 23. Slot Generation

Conceptually:

```text
Operating Window
 ↓
Generate Candidate Start Times
 ↓
Check Service Rules
 ↓
Check Employee Capacity
 ↓
Check Existing Jobs
 ↓
Check Buffers
 ↓
Check Blackouts
 ↓
Return Available Slots
```

---

# 24. Candidate Slot

A candidate slot is not yet guaranteed.

Example:

```text
14:00–17:00
```

The system must validate it against all relevant constraints.

---

# 25. Availability Result

A slot result should contain enough information for the frontend.

Conceptually:

```json
{
  "start": "...",
  "end": "...",
  "timezone": "Europe/Berlin",
  "available": true
}
```

Internal employee details should not be exposed unnecessarily.

---

# 26. Customer-Facing Availability

Customers should generally see:

```text
09:00
10:00
11:30
14:00
16:00
```

rather than internal employee information.

---

# 27. Internal Availability

Authorized dashboard users may need additional information:

```text
capacity
assigned employees
unassigned jobs
conflicts
```

Access must be permission-controlled.

---

# 28. Booking Lead Time

Branches may require minimum notice.

Example:

```text
minimum_notice = 4 hours
```

A booking inside the cutoff must be rejected or routed to an emergency process.

---

# 29. Emergency Booking

Emergency bookings may bypass normal lead time when explicitly enabled.

They must still satisfy:

* branch availability
* employee availability
* service availability
* operational capacity

An emergency surcharge may be applied by the pricing engine.

---

# 30. Maximum Advance Booking

A branch may limit how far customers can book ahead.

Example:

```text
maximum_advance = 60 days
```

This prevents an unnecessarily large scheduling horizon.

---

# 31. Blackout Dates

Branches may block booking dates.

Examples:

```text
company holiday
maintenance
staff event
temporary closure
```

Blackouts must override normal operating hours.

---

# 32. Holidays

The scheduling system may use a configured holiday calendar.

A holiday can independently define:

```text
closed
open with surcharge
reduced hours
normal operation
```

Scheduling and pricing should treat these as separate concerns.

---

# 33. Sunday Scheduling

Sunday operation should be branch-configurable.

Possible states:

```text
closed
open
open with surcharge
```

The pricing engine handles the surcharge.

The availability engine determines whether the service can occur.

---

# 34. Night Scheduling

Night services require explicit configuration.

The system must not expose night slots simply because the branch has no ordinary booking conflict.

---

# 35. Service Area and Scheduling

A booking outside the branch service area should not be scheduled.

The service-area check occurs before confirmation.

---

# 36. Address-Dependent Scheduling

Future scheduling may consider geography.

Example:

```text
Booking A
10:00
Leipzig North

Booking B
13:00
Leipzig South
```

The system may determine whether the travel time is feasible.

---

# 37. Initial Travel Strategy

The initial implementation should prefer simplicity.

Possible initial approach:

```text
fixed travel buffer
```

Advanced route optimization can be introduced later.

Do not require external routing infrastructure for the first scheduling implementation unless necessary.

---

# 38. Existing Assignment Conflicts

The scheduling engine must reject assignments that create overlapping work.

Example:

```text
Job A
10:00–13:00

Job B
11:00–14:00
```

The same cleaner cannot be assigned to both.

---

# 39. Overlap Detection

Time overlap logic must account for:

```text
start
end
buffers
timezone conversion
```

Boundary behavior must be explicitly defined.

---

# 40. Concurrent Booking Protection

Availability checks alone are insufficient.

Two customers may request the same slot simultaneously.

Confirmation must use transactional/concurrency-safe mechanisms.

Conceptually:

```text
Check
 ↓
Reserve / Commit
 ↓
Re-check conflict
 ↓
Confirm
```

---

# 41. Temporary Holds

Where checkout takes time, the system may create a temporary slot hold.

A hold should contain:

```text
slot
branch
expiration
session/request identifier
```

Expired holds must release capacity.

---

# 42. Hold Expiration

Example:

```text
10-minute hold
```

is an example only.

The actual duration is configuration.

The system must not create permanent holds from abandoned checkout sessions.

---

# 43. Recurring Scheduling

Recurring plans create future bookings.

Each generated booking must independently pass availability validation.

A recurring schedule must not assume that every future occurrence remains available.

---

# 44. Recurring Conflict

If one future occurrence cannot be scheduled:

```text
Recurring Plan
 ↓
Occurrence 1 → confirmed
Occurrence 2 → confirmed
Occurrence 3 → conflict
```

The system should flag the affected occurrence rather than silently creating an invalid job.

---

# 45. Recurring Resolution

Possible future resolution options:

```text
alternative time
alternative cleaner
customer notification
manual scheduling
skip occurrence
```

---

# 46. Job Scheduling

Once a booking is confirmed:

```text
Booking
 ↓
Job
 ↓
Schedule
 ↓
Assignment
```

The job represents the operational work.

---

# 47. Booking vs Job

A booking represents the customer transaction.

A job represents the operational task.

One booking may eventually produce:

```text
one job
```

or, for more complex services:

```text
multiple jobs
```

The architecture must support this distinction.

---

# 48. Job Status

The operational job may use states such as:

```text
pending
assigned
en_route
checked_in
in_progress
completed
cancelled
```

The final state machine belongs to the workforce/job domain.

---

# 49. Assignment

The scheduling system determines feasible assignments.

Assignment may initially be:

```text
manual
```

with automatic assignment added later.

---

# 50. Automatic Assignment Readiness

The architecture should support automatic assignment based on:

```text
skill
availability
location
workload
preferences
fairness
cost
```

The initial system should not implement complex optimization unless required.

---

# 51. Assignment Candidate Ranking

Future automatic assignment may rank candidates.

Example conceptual order:

```text
qualified
 ↓
available
 ↓
branch-compatible
 ↓
time-compatible
 ↓
travel-compatible
 ↓
workload-balanced
```

The exact algorithm belongs to the assignment domain.

---

# 52. Employee Assignment Changes

If an assigned cleaner becomes unavailable:

```text
Detect conflict
 ↓
Unassign
 ↓
Find replacement
 ↓
Notify affected parties
```

This should be auditable.

---

# 53. Schedule Changes

When a booking is rescheduled:

```text
Old slot released
 ↓
New slot validated
 ↓
New slot reserved
 ↓
Booking updated
 ↓
Job schedule updated
```

The operation should be atomic where practical.

---

# 54. Schedule Cancellation

When a booking is cancelled:

```text
Booking cancelled
 ↓
Job cancelled
 ↓
Assignment released
 ↓
Capacity restored
```

The exact transition depends on job status.

---

# 55. Manual Scheduling

Authorized staff should be able to manually schedule jobs.

Manual scheduling must still validate:

* cleaner availability
* skill
* time conflict
* branch
* job duration

Staff authorization does not automatically override scheduling constraints.

---

# 56. Scheduling Override

Certain authorized users may override a constraint.

Example:

```text
emergency operational decision
```

Overrides must require explicit permission and create an audit record.

> **Decision S17 (2026-09):** the override capability is **deferred to a
> later dedicated security decision**. No scheduling override permission
> exists in Change 3, and none of the existing catalog permissions is
> silently remapped to grant override power. V1 scheduling configuration is
> governed exclusively by the existing `branches.view` / `branches.edit`
> permissions (see §86).

---

# 57. Dashboard Scheduling

The admin dashboard should eventually provide:

```text
calendar
day schedule
week schedule
employee schedule
branch schedule
unassigned jobs
conflicts
```

---

# 58. Schedule Conflict Detection

The dashboard should highlight conflicts such as:

```text
double booking
employee unavailable
missing skill
outside working hours
insufficient travel time
branch closed
```

---

# 59. Availability API

Conceptually:

```text
getAvailability({
  branchId,
  serviceId,
  variantId,
  dateRange,
  bookingInputs
})
```

The exact API contract is defined during implementation.

---

# 60. Server-Side Validation

Availability requests must be validated with Zod before entering the domain layer.

Client-provided availability results must never be trusted during confirmation.

---

# 61. Availability Caching

Availability may be cached for performance.

However:

> **Cached availability is informational; final booking confirmation must validate against current authoritative state.**

---

# 62. Cache Invalidation

Availability-related changes may require invalidation when:

* booking created
* booking cancelled
* booking rescheduled
* employee availability changed
* employee leave added
* job assignment changed
* branch hours changed
* service availability changed

---

# 63. Performance

Availability queries must remain efficient.

The system should use appropriate indexes on:

* branch
* scheduled start
* scheduled end
* employee
* job status
* booking status

Avoid loading an entire branch schedule for every customer request.

---

# 64. Scheduling Horizon

The system should avoid calculating an unnecessarily large date range.

Typical customer requests may query:

```text
next 7 days
next 14 days
next 30 days
```

depending on branch configuration.

---

# 65. Data Integrity

Database constraints and transactions should protect:

* branch ownership
* valid employee assignments
* valid job relationships
* valid timestamps
* booking/job relationships

Application-level scheduling logic remains necessary.

---

# 66. Scheduling Events

Important scheduling events should be recorded.

Examples:

```text
slot_held
slot_released
booking_scheduled
booking_rescheduled
job_created
job_assigned
job_unassigned
schedule_conflict
```

---

# 67. Notifications

Scheduling events may trigger:

```text
customer notification
cleaner notification
manager notification
```

The notification engine remains responsible for delivery.

---

# 68. Customer Notifications

Customers may receive notifications when:

* booking is confirmed
* time changes
* booking is cancelled
* cleaner assignment is relevant
* reminder is due

Do not expose unnecessary internal scheduling details.

---

# 69. Cleaner Notifications

Cleaners may receive:

* new assignment
* assignment change
* cancellation
* reminder
* schedule update

The cleaner experience is handled through the PWA.

---

# 70. Operational Safety

The system should avoid assigning a cleaner to an impossible schedule.

Examples:

```text
overlapping jobs
insufficient travel time
outside working hours
required skill missing
employee inactive
```

---

# 71. Employee Status

Only employees in an operationally eligible state should be considered.

Examples:

```text
active
temporarily unavailable
on leave
inactive
```

The exact employee lifecycle is defined in the workforce domain.

---

# 72. Branch Closure

If a branch becomes closed:

* new booking availability must stop
* existing bookings should not automatically disappear
* affected operational bookings should be flagged
* authorized staff must handle rescheduling/cancellation

---

# 73. Service Deactivation

If a service is disabled:

* new bookings must stop
* existing bookings remain valid unless business policy says otherwise

This prevents configuration changes from corrupting historical operations.

---

# 74. Historical Scheduling

Completed jobs must preserve their historical schedule.

Future changes to:

* branch hours
* employee schedules
* service duration
* pricing

must not rewrite historical operational records.

---

# 75. Observability

Useful scheduling metrics include:

```text
availability_requests
availability_failures
booking_conflicts
slot_hold_expirations
schedule_conflicts
assignment_failures
rescheduling_rate
```

Logs must avoid unnecessary customer-sensitive data.

---

# 76. Testing Strategy

Scheduling requires automated tests for:

```text
operating hours
service windows
employee availability
leave
existing jobs
duration
buffers
overlaps
timezones
DST
holidays
lead time
advance booking
blackouts
capacity
concurrent booking
holds
rescheduling
cancellation
recurring bookings
```

---

# 77. Timezone Test Cases

Tests must include transitions around daylight saving time.

Examples should cover:

```text
spring transition
autumn transition
```

and branch-local time interpretation.

---

# 78. Concurrency Test Cases

The system should test:

```text
two customers
same branch
same service
same time
simultaneous confirmation
```

Expected result:

```text
Only valid available capacity is accepted.
```

---

# 79. MVP Scheduling

Initial implementation should support:

```text
branch operating hours
service availability
service duration (via the Pricing Engine interface contract)
existing jobs
buffers (operational + fixed travel)
time slots
lead time
advance booking limit
blackout dates
server-side availability
confirmation re-check
basic manual assignment
branch concurrency cap (default 3)
temporary slot holds (single reservation mechanism)
15-minute slot grid
24-hour minimum notice
90-day maximum advance
14-day customer-facing availability horizon
15-minute operational buffer
30-minute fixed travel buffer
manual schedule exceptions
deterministic DST handling
```

The V1 MVP explicitly EXCLUDES:

```text
skill-based availability filtering (assignment-time validation only)
overnight / cross-midnight services
emergency bookings
employee/workforce-derived capacity (arrives with the Phase 2 workforce change)
```

The authoritative V1 decision record is §86 (S1–S18).

---

# 80. Future Scheduling Capabilities

Future versions may add:

* route optimization
* real-time traffic
* automatic assignment
* cleaner preferences
* workload balancing
* skill optimization
* travel-zone pricing
* capacity forecasting
* demand forecasting
* AI-assisted scheduling
* multi-cleaner teams
* advanced recurring scheduling

---

# 81. Architectural Boundary

The availability/scheduling domain owns:

```text
availability calculation
schedule constraints
time-slot generation
schedule conflicts
operational scheduling
```

It does not own:

```text
pricing calculation
payment processing
email delivery
CMS content
authentication
customer identity
```

---

# 82. Integration Model

The core relationship is:

```text
Service / Pricing
       ↓
Duration
       ↓
Availability
       ↓
Booking
       ↓
Job
       ↓
Assignment
```

Each domain should communicate through explicit contracts.

---

# 83. Golden Scheduling Rule

> **CLENQO must never promise a cleaning slot that the branch cannot realistically fulfill. Availability must be calculated from authoritative operational constraints, and every booking confirmation must perform a final concurrency-safe validation before committing the schedule.**

---

# 84. V1 Reservation Model (Decision S1)

The V1 reservation mechanism is a **scheduling-owned temporary slot hold**.

Rules:

* Scheduling owns temporary slot holds.
* A booking draft is non-blocking.
* There is no persisted blocking `pending` booking state in V1.
* A hold is created only after a real availability check.
* A session may have only one active hold.
* Hold creation is idempotent.
* Hold lifecycle:

```text
created → held → consumed / released / expired
```

* Hold TTL is configurable per branch.
* Default TTL = 15 minutes.
* Expiry is enforced by read-time validation plus periodic cleanup/sweep.
* Booking confirmation must perform a final authoritative availability re-check.
* Confirmation consumes the valid hold atomically with booking creation.
* Abandoned checkout creates no booking.
* Expired/released holds restore capacity.
* Audit events:

```text
slot_held
slot_released
slot_consumed
```

> **Resolves audit finding MEDIUM-9** (`docs/DOCUMENTATION_AUDIT.md`): the
> slot hold is the **SINGLE** temporary capacity-blocking mechanism in V1;
> a booking draft does not independently block capacity. `BOOKING_SYSTEM.md`
> §19 and §31–32 describe the customer-facing checkout experience, not a
> second reservation mechanism.

---

# 85. Scheduling / Assignment Boundary (Decision S15)

> "Scheduling answers whether the requested work can be performed in the requested interval from branch, service, capacity, and conflict constraints — it counts eligible resources but never selects one. Assignment answers which eligible, available worker is chosen to perform it — it may rank and select only among candidates Scheduling has already established as feasible; neither domain performs the other's question."

Scheduling never emits a chosen worker; assignment algorithms consume only
the feasibility-filtered candidate set Scheduling produces.

---

# 86. V1 Decision Annex — S1–S18

The following decisions were approved 2026-09 (business + technical review)
and are **normative for Change 3** (`openspec/changes/create-scheduling-availability/`).

### S1 — Reservation / Hold Model

Reservation mechanism = scheduling-owned temporary slot hold. Draft is
non-blocking. No persisted blocking pending booking. Hold consumed by
confirmation. One active hold per session. Idempotent. Read-time expiry +
periodic sweep. Final confirmation re-checks availability transactionally.
See §84.

### S1b — Hold Duration

Default TTL = **15 minutes**, configurable per branch.

### S2 — Operating Hours Model

Operating hours use a relational weekly template with:

```text
branch
weekday
interval index
local start/end time
effective_from
effective_until
```

Multiple intervals per day are allowed. Exceptions override the weekly
template. Historical schedules are immutable after completion.

### S2b — Default Branch Operating Hours

Seed defaults (configurable per branch):

```text
Monday–Friday:  08:00–18:00
Saturday:       09:00–14:00
Sunday:         closed
```

### S3 / S3b — Slot Grid

Slot grid default = **15 minutes**. Configurable per branch.

### S4 — Minimum Notice

Minimum notice default = **24 hours**. Configurable per branch.

### S5 — Maximum Advance Booking Window

Maximum advance booking window default = **90 days**. Configurable per branch.

### S6 — Buffer Model

Service duration is owned by the Pricing Engine. Scheduling consumes the
authoritative duration through an interface contract. Operational and travel
buffers are separate from service duration.

**Implemented (Change 4A):** the temporary placeholder duration provider was
deleted; Scheduling's `DurationProvider` seam is now wired to the real Pricing
Engine resolver (`features/pricing/durationProvider.ts`), which shares the
quote engine's duration rule evaluation. `DurationSelection` accepts typed
optional `propertyDetails`, validated with Zod; duration rules declare their
consumed factors and missing required details raise a validation error.
Scheduling still performs no duration calculation of its own.

### S6b — Buffer Defaults

```text
operational buffer = 15 minutes
travel buffer      = 30 minutes
```

Both configurable per branch.

### S7 / S7b — V1 Capacity

V1 capacity uses a **branch-level concurrency cap**. Workforce-derived
capacity is deferred to Phase 2. Default maximum concurrent jobs = **3**,
configurable per branch.

### S8 — Skills

Skills are **NOT** used for availability calculation in V1. Skills validation
occurs at assignment time only. No skill-based availability in Change 3.

### S9 / S9b — Holidays and Exceptions

Use a unified typed branch schedule exception model:

```text
closed
reduced_hours
blackout
holiday_override
```

V1 uses manual branch exceptions only. No external holiday/calendar provider.

### S10 — Same-Day / Emergency

Same-day ordinary bookings are allowed only when the 24-hour minimum-notice
rule is satisfied. Emergency bookings are disabled in V1.

### S11 — Recurring

Recurring-plan creation/rules belong to the Booking phase. Change 3 provides
only the scheduling foundation needed to validate recurring occurrences
independently. Recurring-plan CRUD is not implemented here. Future occurrence
validation must never silently create invalid occurrences.

### S12 — Horizons

Maximum advance booking window = **90 days** (S5). Customer-facing
availability query horizon default = **14 days**. The customer-facing horizon
is distinct from the internal scheduling horizon; customers may navigate to
dates within the 90-day booking window even though the default availability
query returns 14 days.

### S13 — Overnight

No overnight bookings in V1. A booking must complete within one branch-local
calendar day. The underlying data model should remain wrap-capable for future
extension.

### S14 — DST Handling

DST handling must be deterministic:

* nonexistent spring-forward recurring local times are rejected in
  configuration;
* concrete candidate starts that fall into nonexistent local times are
  skipped;
* ambiguous fall-back local times use the earlier/first occurrence;
* local intervals are materialized into UTC before comparisons.

### S15 — Scheduling vs Assignment

Use the exact §85 boundary sentence.

### S16 — Confirmation Concurrency

Final confirmation sequence:

1. Validate request.
2. Read effective catalog offering.
3. Authoritative availability engine re-computation.
4. Create/validate slot hold.
5. Execute one transaction that:
   * performs final availability re-check including holds/bookings/capacity,
   * consumes the hold,
   * creates booking + booking items,
   * creates pricing snapshot,
   * creates booking event,
   * creates job,
   * creates required audit events,
   * commits atomically.
6. After commit:
   * notifications,
   * outbox processing,
   * cache invalidation,
   * other asynchronous side effects.

Use DB-level protection and idempotency to prevent double booking.

### S17 — Configuration Ownership / Permissions

Branch scheduling hours/exceptions/configuration use the existing
`branches.view` and `branches.edit` permissions. No new scheduling permission
is introduced in Change 3. Override capability is deferred to a later
dedicated security decision (see §56).

### S18 — Availability Pipeline

1. Read branch schedule/configuration.
2. Apply schedule exceptions.
3. Resolve service offering and applicable service scheduling rules.
4. Obtain authoritative duration from the Pricing Engine interface contract.
5. Materialize local intervals into UTC using deterministic DST-safe rules.
6. Generate candidate starts on the configured grid.
7. Filter by: minimum notice, maximum advance, customer-facing horizon,
   occupied intervals, buffers, capacity.
8. Return customer-safe slots without exposing internal workforce details or
   performing pricing calculations.

The implementation must not duplicate pricing or duration calculation inside
Scheduling. As of Change 4A the authoritative duration source is the
implemented Pricing Engine (P21); the placeholder provider no longer exists.
