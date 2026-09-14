# CLENQO — Background Jobs & Automation

**Status:** Source of Truth
**Scope:** Background processing, scheduled jobs, queues, retries, automation workflows, reminders, outbox processing, and asynchronous operations
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL + Vercel
**Primary Principle:** Long-running, delayed, retryable, or asynchronous work must be separated from customer-facing request execution while remaining reliable, observable, and idempotent.

---

## 1. Purpose

This document defines how CLENQO handles work that should not depend on a single synchronous HTTP request.

Examples include:

* email delivery;
* booking reminders;
* payment reconciliation;
* notification retries;
* branch provisioning retries;
* scheduled reports;
* recurring booking generation;
* background cleanup;
* media processing;
* operational alerts;
* future AI workflows.

The goal is to provide reliable asynchronous processing without introducing unnecessary infrastructure too early.

---

# 2. Core Principle

CLENQO follows:

```text
Immediate Business Operation
        ↓
Persist Authoritative State
        ↓
Record Event / Job
        ↓
Background Processing
        ↓
External Action
        ↓
Record Result
```

A temporary failure in a secondary operation should not unnecessarily roll back a successful primary business operation.

Example:

```text
Booking confirmed
        ↓
Notification queued
        ↓
SES temporarily unavailable
        ↓
Retry later
```

The booking remains confirmed.

---

# 3. Synchronous vs Asynchronous Work

Work should remain synchronous when:

* the user needs the result immediately;
* the operation is short;
* the result determines whether the current transaction can continue;
* consistency requires an immediate response.

Examples:

* authentication;
* authorization;
* pricing calculation;
* final availability validation;
* booking confirmation;
* permission checks.

Work should become asynchronous when:

* it can happen after the main operation;
* it may take significant time;
* it requires retries;
* it communicates with unreliable external services;
* it is scheduled for the future;
* it processes large amounts of data.

---

# 4. Initial Architecture

CLENQO should initially prefer a database-backed approach.

Conceptually:

```text
Next.js
   ↓
PostgreSQL
   ↓
Job / Outbox Record
   ↓
Worker / Scheduled Processor
   ↓
Domain Service
   ↓
Provider
```

A dedicated message broker is not required for the initial system.

Avoid introducing Redis, Kafka, RabbitMQ, or similar infrastructure merely because asynchronous processing exists.

---

# 5. Job Types

Background work should have explicit job types.

Examples:

```text
notification.send
notification.retry
booking.reminder
booking.recurring_generate
branch.provision
payment.reconcile
invoice.generate
report.generate
media.process
quality.followup
audit.export
```

Future jobs may include:

```text
ai.operation
marketing.campaign
customer.reactivation
schedule.optimization
```

---

# 6. Job Record

A conceptual background job should contain:

```text
id
job_type
organization_id
branch_id
status
priority
payload
scheduled_at
started_at
completed_at
attempts
max_attempts
last_error
locked_at
created_at
updated_at
```

The exact schema may evolve during implementation.

Payloads must contain references and controlled data rather than unnecessarily duplicating sensitive records.

---

# 7. Job Status

Recommended states:

```text
pending
processing
completed
failed
retrying
cancelled
dead_letter
```

A job must have a clear terminal state.

---

# 8. Job Lifecycle

Typical flow:

```text
pending
   ↓
processing
   ↓
completed
```

Failure:

```text
pending
   ↓
processing
   ↓
failed
   ↓
retrying
   ↓
processing
```

Permanent failure:

```text
processing
   ↓
failed
   ↓
dead_letter
```

---

# 9. Idempotency

Every retryable job must be designed for repeated execution.

A worker must assume:

```text
the same job may execute more than once.
```

The operation must not create duplicate business effects.

Examples:

* duplicate email;
* duplicate invoice;
* duplicate payment capture;
* duplicate recurring booking;
* duplicate branch provisioning;
* duplicate reminder.

---

# 10. Idempotency Keys

Important jobs should have an idempotency key.

Examples:

```text
booking-confirmation:{bookingId}
payment-reconciliation:{providerEventId}
branch-provisioning:{branchId}
reminder:{bookingId}:{reminderType}
recurring-occurrence:{planId}:{occurrenceDate}
```

The key should identify the logical operation.

---

# 11. Outbox Pattern

Important domain events that must reliably trigger asynchronous work should use an outbox-style pattern where appropriate.

Example:

```text
Transaction
  ├── update booking
  ├── create booking event
  └── create outbox event
              ↓
       Background processor
              ↓
       Notification / automation
```

This avoids the failure mode where:

```text
database update succeeds
but event dispatch fails
```

and the event is permanently lost.

---

# 12. Outbox vs Job

These concepts are related but different.

### Outbox event

Represents:

> Something important happened.

Example:

```text
booking.confirmed
```

### Background job

Represents:

> Something needs to be processed.

Example:

```text
send booking confirmation email
```

One event may produce multiple jobs.

---

# 13. Notification Processing

Preferred flow:

```text
Booking Service
      ↓
booking.confirmed
      ↓
Notification Event
      ↓
Resolve recipients
      ↓
Select locale/template
      ↓
Create delivery job
      ↓
SES
      ↓
Delivery result
```

Email sending must not be tightly coupled to the booking transaction.

---

# 14. Notification Retry

Transient failures should be retried.

Examples:

* provider timeout;
* temporary network error;
* rate limit;
* temporary provider outage.

Permanent failures should not be retried indefinitely.

Examples:

* invalid recipient;
* invalid template;
* invalid configuration;
* permanently rejected request.

---

# 15. Retry Backoff

Retries should use controlled backoff.

Conceptually:

```text
Attempt 1 → immediate
Attempt 2 → short delay
Attempt 3 → longer delay
Attempt 4 → longer delay
...
```

The exact schedule should be configurable.

Avoid aggressive retry loops.

---

# 16. Maximum Attempts

Every retryable job should have a maximum attempt count.

After the maximum:

```text
failed
→ dead_letter
```

The system should retain enough information for investigation and manual recovery.

---

# 17. Dead-Letter Jobs

Dead-letter jobs represent work that could not be completed automatically.

The admin system should eventually provide:

* failure reason;
* attempt count;
* timestamp;
* affected branch;
* affected resource;
* retry action;
* cancellation action;
* relevant logs/request ID.

Manual retry must itself be idempotent.

---

# 18. Job Locking

Workers must prevent multiple processors from executing the same job simultaneously.

Use database-supported concurrency mechanisms such as:

* row locking;
* claim status;
* lease expiration;
* atomic update.

The exact mechanism should be selected during implementation based on deployment constraints.

---

# 19. Stale Job Recovery

A worker may crash while processing a job.

Example:

```text
processing
   ↓
worker crashes
```

The job must not remain permanently stuck.

Jobs should have a lease/timeout mechanism so stale processing records can become eligible for retry.

---

# 20. Scheduled Jobs

Scheduled operations should use explicit timestamps.

Examples:

```text
booking reminder at T-24h
booking reminder at T-2h
recurring booking generation
invoice reminder
scheduled content publication
report generation
```

Store schedule information in UTC while interpreting business rules using the relevant branch timezone.

---

# 21. Timezone Rules

CLENQO operates across multiple branches and potentially multiple countries.

Therefore:

* database timestamps use UTC;
* branch configuration stores an IANA timezone;
* customer-facing times use the branch/customer context where appropriate;
* scheduled jobs must account for daylight-saving changes;
* recurring schedules must not assume fixed UTC offsets.

Example:

```text
Europe/Berlin
```

must be treated as a timezone, not simply:

```text
UTC+1
```

---

# 22. Booking Reminders

Reminder automation should be generated from confirmed bookings.

Potential reminders:

```text
24 hours before
2 hours before
```

Exact timing should be configurable.

Cancelled or rescheduled bookings must invalidate obsolete reminders.

---

# 23. Reminder Idempotency

A reminder must not be sent twice merely because the scheduler runs more than once.

Example:

```text
bookingId + reminderType
```

should identify the logical reminder.

If the reminder has already been successfully delivered, another scheduler execution must not duplicate it.

---

# 24. Rescheduling

When a booking is rescheduled:

```text
old reminders
→ cancelled/invalidated

new reminders
→ scheduled
```

The old schedule must not continue sending notifications.

---

# 25. Cancellation

When a booking is cancelled:

* future operational jobs should be cancelled where appropriate;
* reminders should be invalidated;
* assignment workflows should stop;
* payment actions should be updated;
* customer notifications may be generated.

Each domain remains responsible for its own authoritative state.

---

# 26. Recurring Bookings

Recurring bookings require controlled background generation.

Example:

```text
Recurring Plan
      ↓
Generate upcoming occurrence
      ↓
Validate availability
      ↓
Calculate price
      ↓
Create booking
      ↓
Schedule notifications
```

Each occurrence must be independently validated.

---

# 27. Recurring Booking Idempotency

A recurring occurrence must have a unique logical identity.

Conceptually:

```text
recurring_plan_id
+
occurrence_date/time
```

must not generate duplicate bookings if the generation job runs twice.

---

# 28. Recurring Availability Failure

If an occurrence can no longer be scheduled:

```text
do not silently create an impossible booking
```

The system should record the failed occurrence and trigger the appropriate customer/manager workflow.

Possible outcomes:

* alternative slot;
* manual review;
* rescheduling;
* skipped occurrence;
* cancellation according to policy.

---

# 29. Branch Provisioning Jobs

Branch provisioning may be synchronous for the initial operation but should support asynchronous recovery.

Example:

```text
Branch created
   ↓
Provisioning
   ↓
Website resources
   ↓
Configuration
   ↓
Ready
```

If a non-critical provisioning step fails:

```text
Ready
```

must not be falsely assigned.

The branch remains in an appropriate provisioning/error state until recovery.

---

# 30. Provisioning Retry

Provisioning retries must be idempotent.

A retry must detect existing resources instead of blindly creating duplicates.

Example:

```text
branch exists
website exists
locales exist
pages partially exist
```

The next attempt should continue safely.

---

# 31. Payment Background Jobs

Background processing may handle:

* payment reconciliation;
* failed payment retries where business rules permit;
* invoice reminders;
* refund reconciliation;
* provider event processing.

Financial jobs require strict idempotency and auditability.

---

# 32. Payment Webhooks

Webhook processing may be asynchronous after:

1. signature verification;
2. event acceptance;
3. event persistence.

Example:

```text
Webhook received
   ↓
Verify signature
   ↓
Persist provider event
   ↓
Queue processing
   ↓
Update payment
   ↓
Reconcile
```

The exact synchronous boundary depends on provider requirements.

---

# 33. Invoice Jobs

Background invoice processing may include:

* generating invoice documents;
* sending invoices;
* reminder emails;
* marking overdue invoices;
* reconciliation.

Invoice state remains owned by the finance domain.

---

# 34. Scheduled Website Publication

Future CMS capabilities may support:

```text
publish_at
unpublish_at
```

A background job can perform the scheduled transition.

Publishing must still:

* validate content;
* verify authorization established when the schedule was created;
* record audit information;
* invalidate/revalidate relevant caches.

---

# 35. Scheduled Promotions

Promotional content may be activated/deactivated automatically.

Business rules must define:

* start;
* end;
* branch;
* locale;
* status;
* priority.

Promotions must not silently modify authoritative pricing unless explicitly connected to the pricing domain.

---

# 36. Background Automation and Domain Ownership

Automation may trigger domain operations.

It must not bypass them.

Example:

```text
Reminder automation
→ bookingService
```

not:

```text
Reminder automation
→ directly modify bookings table
```

Automation is a caller of domain logic, not a replacement for it.

---

# 37. Automation Permissions

Automated operations must have explicit authority.

Actor type may be:

```text
system
automation
webhook
```

The action must remain auditable.

An automation must not automatically inherit unrestricted administrative access merely because it runs on the server.

---

# 38. Automation Audit

Important automated actions should record:

```text
actorType = automation
automationType
operation
resource
branch
timestamp
result
requestId/correlationId
```

This makes automated actions distinguishable from human actions.

---

# 39. Customer Automation

Customer-facing automation may include:

* booking confirmation;
* reminders;
* payment reminders;
* review requests;
* rescheduling notifications;
* service follow-up.

Transactional communication is distinct from marketing communication.

---

# 40. Cleaner Automation

Cleaner-related automation may include:

* assignment notifications;
* upcoming-job reminders;
* schedule changes;
* cancellation notices;
* incomplete-job alerts;
* manager escalation.

Cleaner automation must expose only the information required for the operational task.

---

# 41. Manager Automation

Branch managers may receive:

* unassigned-job alerts;
* late-arrival alerts;
* payment failures;
* customer complaints;
* provisioning failures;
* capacity warnings.

HQ may receive aggregated cross-branch alerts.

---

# 42. Escalation

Important unresolved operational conditions may escalate.

Example:

```text
Job starts in 30 minutes
→ no cleaner assigned
→ branch manager alert
→ still unresolved
→ HQ escalation
```

Escalation timing must be configurable.

---

# 43. Automation Loops

Automation must avoid creating loops.

Example of a dangerous pattern:

```text
booking update
→ notification
→ automation
→ booking update
→ notification
→ ...
```

Automations should use:

* event types;
* idempotency;
* state checks;
* explicit trigger conditions.

---

# 44. Event Filtering

Not every domain event should create an automation.

Automation rules should explicitly declare:

```text
event
+
conditions
+
action
```

Example:

```text
event = job.started_late
condition = delay > configured threshold
action = notify branch manager
```

---

# 45. Automation Configuration

Future dashboard automation settings may allow authorized users to configure:

* enabled/disabled;
* trigger;
* conditions;
* recipients;
* channel;
* timing;
* escalation.

However, configuration must remain constrained to supported operations.

Users must not be allowed to execute arbitrary server code.

---

# 46. Automation Templates

Automation should use predefined workflow templates.

Examples:

```text
Booking Confirmation
Booking Reminder
Cleaner Assignment
Payment Failure
Review Request
Unassigned Job Alert
Branch Provisioning Failure
```

Templates provide consistency and safety.

---

# 47. Automation Versioning

Important automation definitions should be versioned.

If a rule changes:

```text
old automation version
```

should not unpredictably change already-scheduled work unless explicitly intended.

---

# 48. Job Payloads

Job payloads should prefer identifiers over duplicated authoritative data.

Good:

```json
{
  "bookingId": "...",
  "notificationType": "booking_confirmation"
}
```

Avoid storing large copies of:

```text
customer record
booking record
pricing rules
employee record
```

unless a deliberate immutable snapshot is required.

---

# 49. Sensitive Job Data

Job payloads must not contain unnecessary:

* authentication credentials;
* payment credentials;
* magic-link tokens;
* secrets;
* private documents.

Sensitive values should be retrieved securely when needed.

---

# 50. Job Priority

Jobs may eventually have priorities.

Example:

```text
critical
high
normal
low
```

Potential high-priority work:

* payment webhooks;
* booking confirmation;
* operational escalation.

Potential low-priority work:

* analytics aggregation;
* non-critical reporting;
* media processing.

Priority must not allow starvation of lower-priority work.

---

# 51. Rate Limiting Background Work

Background workers should also respect provider limits.

Examples:

```text
SES sending limits
payment provider API limits
future WhatsApp limits
```

Use controlled concurrency and retry backoff.

---

# 52. Worker Architecture

The initial implementation should keep workers simple.

Possible execution mechanisms include:

* scheduled server execution;
* database-backed processing;
* Vercel-compatible scheduled functions;
* dedicated worker process when scale requires it.

The implementation must be compatible with the chosen deployment model.

---

# 53. No Premature Queue Infrastructure

Do not introduce a dedicated queue system before operational requirements justify it.

The initial architecture should prefer:

```text
PostgreSQL
+
outbox/job tables
+
scheduled processing
```

A dedicated queue can be introduced later without changing domain ownership.

---

# 54. Observability

Every important background job should expose:

* job ID;
* job type;
* branch;
* organization;
* attempt count;
* status;
* duration;
* error code;
* last error;
* correlation/request ID.

This connects background failures to the observability system.

---

# 55. Job Metrics

Track:

```text
queue depth
oldest job age
processing rate
success rate
failure rate
retry rate
dead-letter count
execution latency
```

Monitor separately by important job category.

---

# 56. Alerting

Alerts should trigger for conditions such as:

* queue backlog growing;
* critical jobs repeatedly failing;
* dead-letter count increasing;
* notification delivery degrading;
* provisioning failures;
* payment processing failures;
* recurring booking generation failures.

Alerts must remain actionable.

---

# 57. Manual Recovery

Authorized administrators should eventually be able to:

* inspect failed jobs;
* retry a job;
* cancel a job;
* inspect failure information.

Manual recovery actions must be:

* permission-controlled;
* idempotent;
* audited.

---

# 58. Failure Classification

Failures should be classified.

### Transient

Retry.

Examples:

* network timeout;
* provider unavailable;
* temporary rate limit.

### Permanent

Do not automatically retry indefinitely.

Examples:

* invalid input;
* invalid configuration;
* deleted resource;
* invalid recipient.

### Unknown

Retry conservatively and alert if repeated.

---

# 59. Dependency Failure

If an external provider fails:

```text
business state
≠
provider state
```

The system should preserve the authoritative CLENQO state and record the external failure for recovery where appropriate.

Example:

```text
booking = confirmed
email = failed/retrying
```

rather than:

```text
booking = failed
```

simply because the confirmation email failed.

---

# 60. Data Integrity

Background processing must respect the same database invariants as synchronous operations.

Jobs must not bypass:

* foreign keys;
* RLS;
* domain validation;
* authorization;
* state-transition rules;
* financial controls.

---

# 61. Security

Background execution is privileged infrastructure and must be treated as a security boundary.

Protect:

* job endpoints;
* scheduled triggers;
* worker credentials;
* provider credentials;
* job payloads;
* administrative retry controls.

Never expose internal job execution endpoints publicly without authentication and appropriate authorization.

---

# 62. Testing

Background jobs require tests for:

### Normal execution

Job completes successfully.

### Retry

Transient failure retries.

### Permanent failure

Permanent failure reaches terminal state.

### Idempotency

Repeated execution does not duplicate effects.

### Concurrency

Two workers cannot incorrectly process the same job.

### Stale recovery

A crashed worker does not permanently block processing.

### Scheduling

Jobs execute at correct business times.

### Timezone

DST and branch timezone behavior are correct.

### Authorization

Manual job controls are protected.

---

# 63. Time-Based Testing

Scheduled workflows must be tested around:

* daylight-saving changes;
* midnight;
* month-end;
* year-end;
* leap years;
* holidays;
* branch timezone boundaries.

Do not assume a day always has exactly 24 hours.

---

# 64. MVP Background Processing

The MVP should implement the minimum reliable asynchronous foundation:

* notification events;
* database-backed outbox/job records where required;
* email delivery processing;
* email retries;
* booking reminders;
* idempotency;
* failed-job visibility;
* basic observability;
* branch provisioning recovery;
* payment webhook processing foundation.

---

# 65. Future Background Automation

Future capabilities may include:

* advanced workflow builder;
* multi-step automation;
* SMS;
* WhatsApp;
* push notifications;
* automated customer reactivation;
* workforce optimization;
* AI-assisted scheduling;
* AI operational alerts;
* accounting synchronization;
* advanced reporting jobs;
* automated branch onboarding.

These must continue to use explicit domain contracts.

---

# 66. Architecture Rules

The following are mandatory:

1. Long-running work must not unnecessarily block user requests.
2. Important asynchronous work must be durable.
3. Retryable operations must be idempotent.
4. Jobs must have explicit states.
5. Jobs must have bounded retries.
6. Failed jobs must be diagnosable.
7. Stale jobs must be recoverable.
8. Background automation must use domain services.
9. Automation must not bypass authorization or RLS.
10. External provider failures must not corrupt authoritative business state.
11. Scheduled work must respect branch timezones.
12. Recurring operations must be idempotent.
13. Important automated actions must be audited.
14. Sensitive job payloads must be minimized.
15. Queue infrastructure must not be introduced prematurely.
16. Background jobs must be observable.
17. Manual recovery must be permission-controlled and audited.
18. Automation must not create uncontrolled event loops.

---

# 67. Definition of Done

A background job or automation feature is complete when:

* [ ] Job/event purpose is documented.
* [ ] Ownership is defined.
* [ ] Job state is defined.
* [ ] Input/payload is validated.
* [ ] Idempotency strategy exists.
* [ ] Retry strategy exists.
* [ ] Permanent failure behavior exists.
* [ ] Concurrency behavior is defined.
* [ ] Stale-job recovery is defined where required.
* [ ] Timezone behavior is defined.
* [ ] Authorization is enforced.
* [ ] Sensitive data is protected.
* [ ] Audit requirements are implemented.
* [ ] Observability exists.
* [ ] Metrics exist for important workflows.
* [ ] Tests cover success and failure paths.
* [ ] OpenSpec acceptance criteria pass.
* [ ] Documentation is synchronized.

---

# 68. Golden Automation Rule

> **Background work must be durable, idempotent, observable, recoverable, authorization-aware, and independent from the success of the primary business operation whenever possible.**

CLENQO should automate repetitive work without turning automation into an uncontrolled source of business state.

The domain remains authoritative; automation executes approved workflows around it.
