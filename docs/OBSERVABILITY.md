# CLENQO — Observability & Monitoring

**Status:** Source of Truth
**Scope:** Logs, metrics, tracing, health checks, alerts, performance monitoring, provider monitoring, and operational visibility
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL + Vercel
**Primary Principle:** CLENQO must make important system behavior visible, diagnosable, and actionable without exposing sensitive data.

---

## 1. Purpose

This document defines how CLENQO observes and monitors the platform.

The observability system must allow the team to understand:

* whether the platform is healthy;
* whether customers can book successfully;
* whether branches are operating correctly;
* whether cleaners can execute jobs;
* whether payments are working;
* whether notifications are being delivered;
* whether provisioning succeeds;
* where failures occur;
* how long important operations take;
* whether performance is degrading;
* whether security-related anomalies are occurring.

Observability is an operational capability, not merely a collection of logs.

---

# 2. Core Principle

CLENQO follows:

```text
Logs
+
Metrics
+
Traces / Correlation
+
Health Checks
+
Alerts
+
Audit
=
Operational Visibility
```

No single telemetry source should be treated as sufficient.

---

# 3. Observability Goals

The platform should make it possible to answer:

```text
Is CLENQO available?

Can customers book?

Are bookings being confirmed?

Are prices calculating correctly?

Are available slots accurate?

Are jobs being assigned?

Are cleaners completing jobs?

Are payments succeeding?

Are emails being delivered?

Are branches provisioning correctly?

Are errors increasing?

Which branch is affected?

Which operation failed?

Who initiated the operation?

When did it happen?

What changed?
```

---

# 4. Observability Layers

CLENQO observability is divided into:

### Application

* requests;
* server actions;
* route handlers;
* domain services;
* errors;
* latency.

### Database

* query performance;
* connection health;
* slow queries;
* failed transactions;
* constraint violations.

### Infrastructure

* Vercel;
* Supabase;
* storage;
* deployment health.

### External Providers

* Amazon SES;
* payment providers;
* future WhatsApp/SMS;
* future maps and other integrations.

### Business Operations

* booking conversion;
* booking failures;
* job delays;
* payment failures;
* notification failures;
* provisioning failures.

### Security

* authentication failures;
* authorization failures;
* suspicious access;
* rate-limit violations;
* webhook failures.

---

# 5. Structured Logging

Application logs must be structured rather than arbitrary text.

Preferred conceptual format:

```text
timestamp
level
service
operation
requestId
organizationId
branchId
actorId
resourceType
resourceId
durationMs
result
errorCode
metadata
```

Not every field is required for every log.

---

# 6. Log Levels

Use consistent levels:

### DEBUG

Detailed development information.

Not normally enabled at high volume in production.

### INFO

Normal important operational events.

Examples:

```text
booking.created
branch.provisioning.started
notification.queued
job.assigned
```

### WARN

Unexpected but recoverable conditions.

Examples:

```text
provider.retry
slow.query
notification.retry
provisioning.partial_failure
```

### ERROR

An operation failed and requires investigation or recovery.

Examples:

```text
payment.failed
booking.creation.failed
provisioning.failed
database.transaction.failed
```

### FATAL / CRITICAL

Use only for severe platform-level failures requiring immediate attention.

---

# 7. Sensitive Data

Logs must never contain:

* passwords;
* authentication tokens;
* magic-link tokens;
* payment credentials;
* card numbers;
* CVV;
* service-role keys;
* provider secrets;
* raw webhook secrets;
* unnecessary personal data.

Email addresses and phone numbers should be minimized or masked when not required.

---

# 8. Request IDs

Every important request should have a correlation/request ID.

Example:

```text
req_01...
```

The same identifier should be available across relevant:

```text
request
→ domain operation
→ database activity
→ notification
→ provider call
→ audit event
```

This allows a single customer failure to be traced through the system.

---

# 9. Correlation Context

Where appropriate, logs should include:

```text
organizationId
branchId
actorId
resourceId
operation
requestId
```

This makes branch-level investigation possible.

Example:

```text
branch = Berlin
operation = booking.create
result = failed
requestId = ...
```

---

# 10. Audit vs Logs

Operational logs and audit records serve different purposes.

### Logs

Answer:

> What happened technically?

### Audit

Answers:

> What important business action happened, who performed it, and what changed?

Example:

```text
Log:
database request failed after 421ms.

Audit:
HQ Admin changed Branch A pricing profile.
```

Do not use operational logs as a replacement for audit records.

---

# 11. Metrics

Metrics provide aggregate system visibility.

Important categories include:

### Availability

* uptime;
* request success rate;
* error rate;
* health-check status.

### Performance

* request latency;
* database latency;
* pricing latency;
* availability latency;
* booking latency.

### Business

* bookings created;
* bookings confirmed;
* booking failures;
* cancellation rate;
* completion rate.

### Workforce

* jobs assigned;
* assignment failures;
* late jobs;
* check-in failures;
* completion delays.

### Finance

* payment success rate;
* payment failure rate;
* refund count;
* invoice failures.

### Notifications

* messages queued;
* sent;
* delivered;
* failed;
* retry count.

### Provisioning

* branches created;
* provisioning success;
* provisioning failures;
* provisioning duration.

---

# 12. Metric Dimensions

Metrics should support useful dimensions without creating uncontrolled cardinality.

Potential dimensions:

```text
organization
branch
service
booking_type
payment_provider
notification_channel
locale
environment
operation
status
```

Do not use arbitrary customer identifiers as metric dimensions.

---

# 13. Business Health Metrics

The platform should monitor critical operational funnel metrics.

Example:

```text
website visit
→ booking started
→ quote generated
→ booking submitted
→ booking confirmed
→ job assigned
→ job completed
→ payment completed
→ review received
```

This makes it possible to identify where customers or operations are being lost.

---

# 14. Booking Monitoring

Monitor:

* booking attempts;
* booking creation success;
* booking validation failures;
* unavailable-slot attempts;
* pricing failures;
* confirmation failures;
* duplicate/idempotency conflicts;
* cancellations;
* no-shows.

A sudden increase in booking failures should be treated as a high-priority business alert.

---

# 15. Availability Monitoring

Monitor:

* availability requests;
* availability calculation latency;
* no-slot responses;
* availability errors;
* database contention;
* scheduling conflicts.

The system should distinguish:

```text
legitimate no availability
```

from:

```text
availability calculation failure
```

These are not equivalent.

---

# 16. Pricing Monitoring

Monitor:

* quote requests;
* successful calculations;
* validation failures;
* pricing-rule errors;
* quote latency;
* manual overrides;
* quote-required cases.

Unexpected pricing failures should be detected quickly because pricing directly affects conversion and revenue.

---

# 17. Branch Provisioning Monitoring

Branch creation is a critical platform operation.

Track:

```text
provisioning_started
provisioning_completed
provisioning_failed
provisioning_retried
provisioning_duration
```

The dashboard should expose provisioning status.

Example:

```text
Berlin
READY

Hamburg
PROVISIONING

Munich
FAILED — retry available
```

A branch must not appear operationally active when provisioning is incomplete.

---

# 18. Branch Health

Each branch should have a conceptual health status.

Potential states:

```text
healthy
degraded
attention_required
inactive
suspended
```

Branch health may consider:

* website availability;
* booking availability;
* upcoming job coverage;
* employee capacity;
* payment failures;
* notification failures;
* unresolved operational incidents;
* provisioning state.

Health indicators are operational signals and must not replace the authoritative domain states.

---

# 19. HQ Health Dashboard

HQ should eventually have a platform-wide health overview.

Example:

```text
Platform
Healthy

Branches
12 healthy
1 degraded
1 provisioning

Bookings
Normal

Payments
Normal

Notifications
Elevated failures

Background jobs
Normal
```

HQ should be able to drill down from:

```text
Platform
→ Branch
→ Domain
→ Operation
→ Request
```

---

# 20. Cleaner/Job Monitoring

Operational monitoring should identify:

* unassigned jobs;
* late check-ins;
* jobs approaching start time without assignment;
* jobs exceeding expected duration;
* failed completion actions;
* repeated incidents;
* schedule conflicts.

These signals should help managers intervene before customer impact occurs.

---

# 21. Payment Monitoring

Monitor:

* payment attempts;
* authorization failures;
* capture failures;
* refund failures;
* webhook failures;
* reconciliation discrepancies;
* provider latency;
* provider availability.

Financial discrepancies must be investigated independently from ordinary application errors.

---

# 22. Notification Monitoring

Monitor the complete lifecycle:

```text
queued
→ sending
→ sent
→ delivered
```

and:

```text
queued
→ failed
→ retry
→ failed
```

Important metrics:

* delivery rate;
* failure rate;
* bounce rate;
* complaint rate;
* retry count;
* provider latency.

---

# 23. Amazon SES Monitoring

Email delivery should monitor:

* accepted messages;
* bounces;
* complaints;
* rejects;
* delivery failures;
* provider errors.

Bounce and complaint signals should be handled carefully to protect sender reputation.

Future messaging providers should expose equivalent health metrics through provider adapters.

---

# 24. Database Monitoring

PostgreSQL/Supabase monitoring should cover:

* query latency;
* slow queries;
* failed queries;
* transaction failures;
* connection issues;
* lock contention;
* constraint violations;
* storage growth;
* index effectiveness where relevant.

Critical queries should be periodically reviewed as branch count and booking volume increase.

---

# 25. RLS Monitoring

Security-sensitive database behavior should be tested and monitored.

Important indicators include:

* unexpected authorization failures;
* repeated cross-scope access attempts;
* policy errors;
* privileged database usage.

RLS failures must not simply be bypassed to make an operation work.

---

# 26. API Performance

Track latency for critical endpoints and server actions.

Priority operations:

```text
website rendering
availability
pricing
booking creation
booking management
dashboard loading
job updates
payment operations
CMS publishing
branch provisioning
```

Use percentile metrics where possible:

```text
p50
p95
p99
```

Average latency alone is insufficient.

---

# 27. Performance Thresholds

Initial thresholds should be treated as operational targets rather than permanent laws.

Examples:

```text
Public website:
fast enough for normal user interaction

Availability:
low enough to feel immediate

Pricing:
low enough to feel instantaneous

Booking confirmation:
fast enough to provide clear feedback

Dashboard:
responsive for normal operational use
```

Specific thresholds should be established from real production measurements.

---

# 28. Health Checks

The platform should expose health checks appropriate to the environment.

Conceptually:

```text
/api/health
```

Health checks may verify:

* application availability;
* database connectivity;
* required configuration;
* critical provider connectivity where appropriate.

Health endpoints must not expose secrets or internal infrastructure details.

---

# 29. Readiness vs Liveness

Where infrastructure requires it, distinguish:

### Liveness

> Is the application process responding?

### Readiness

> Is the application capable of serving normal requests?

A service may be alive but not ready because a critical dependency is unavailable.

---

# 30. External Dependency Health

The platform should distinguish:

```text
CLENQO failure
```

from:

```text
external provider failure
```

Example:

```text
Booking creation: healthy
SES delivery: degraded
```

A temporary email provider outage should not incorrectly mark the entire booking platform as unavailable.

---

# 31. Error Tracking

Production errors should be aggregated and grouped.

Important properties:

```text
error type
operation
route/action
requestId
environment
branch
frequency
first seen
last seen
affected users
```

Error tracking should allow the team to identify regressions after deployment.

---

# 32. Deployment Monitoring

Every production deployment should be observable.

Monitor:

* deployment success;
* application health after deployment;
* error rate;
* latency;
* booking success;
* authentication;
* critical API operations.

A deployment that technically succeeds but causes booking failures is not considered healthy.

---

# 33. Release Smoke Tests

After production deployment, verify critical flows.

Minimum smoke tests:

```text
public website loads
branch website resolves
published content renders
service catalog loads
availability works
pricing works
booking flow works
authentication works
dashboard loads
cleaner job flow works
```

Payment and email provider checks should use safe test/sandbox mechanisms where appropriate.

---

# 34. Alerts

Alerts should be based on actionable conditions.

Good alert:

```text
Booking confirmation failures exceed threshold for 10 minutes.
```

Poor alert:

```text
One booking failed.
```

Alerts should avoid excessive noise.

---

# 35. Alert Severity

Suggested levels:

### Critical

Immediate customer/business impact.

Examples:

* platform unavailable;
* booking system unavailable;
* database unavailable;
* widespread authentication failure.

### High

Major domain degradation.

Examples:

* payment processing failures;
* booking confirmation failures;
* widespread notification failures;
* branch provisioning failures.

### Medium

Limited degradation.

Examples:

* elevated job update errors;
* slow dashboard performance;
* elevated retry rate.

### Low

Operational information.

Examples:

* increasing storage usage;
* approaching capacity;
* dependency updates.

---

# 36. Alert Routing

Alerts should eventually route to appropriate operational channels.

Potential destinations:

* dashboard;
* email;
* future Slack;
* future WhatsApp;
* incident-management tooling.

The initial implementation should remain simple.

Email-based operational alerts are sufficient until operational scale requires more.

---

# 37. Alert Ownership

Each alert should have an implied owner.

Examples:

```text
booking failure → booking/platform owner
payment failure → finance/platform owner
employee scheduling → operations
CMS publishing → website/admin
database outage → platform infrastructure
```

An alert without an actionable owner creates noise rather than reliability.

---

# 38. Alert Deduplication

Repeated identical failures should be grouped.

Example:

```text
500 failed availability requests
```

should normally produce an incident signal rather than 500 separate alerts.

---

# 39. Rate-Limit Monitoring

Monitor:

* authentication abuse;
* magic-link abuse;
* booking spam;
* availability scraping;
* excessive API calls;
* repeated invalid requests.

Rate limiting should protect the platform while preserving normal customer behavior.

---

# 40. Security Signals

Potential security signals include:

* repeated failed authentication;
* repeated authorization failures;
* unusual branch access attempts;
* repeated invalid magic-link attempts;
* webhook signature failures;
* suspicious API volume;
* repeated invalid input patterns;
* privileged-operation anomalies.

Security telemetry should avoid collecting unnecessary personal information.

---

# 41. Privacy

Observability must follow the same privacy principles as the rest of CLENQO.

Telemetry should collect:

```text
enough information to diagnose problems
```

but not:

```text
everything available.
```

Data minimization applies to:

* logs;
* metrics;
* traces;
* error reports;
* debugging payloads.

---

# 42. Production Data Protection

Production customer data must not be copied casually into:

* local debugging;
* test environments;
* screenshots;
* issue trackers;
* development logs.

Use sanitized or synthetic data whenever possible.

---

# 43. Development Environment

Local development should provide useful logs without requiring a production observability stack.

Developers should be able to inspect:

* request flow;
* domain operation;
* validation errors;
* database errors;
* notification events;
* provider mocks.

Local logs may be more verbose than production logs.

---

# 44. Staging Environment

Staging should approximate production behavior sufficiently to test:

* authentication;
* RLS;
* migrations;
* APIs;
* booking;
* pricing;
* availability;
* notifications;
* payment sandbox;
* observability.

Production secrets and real customer data must not be used casually in staging.

---

# 45. Production Environment

Production observability must prioritize:

1. availability;
2. booking reliability;
3. financial correctness;
4. security;
5. operational reliability;
6. performance;
7. provider health.

---

# 46. Background Job Monitoring

When background jobs are introduced, track:

* queued;
* running;
* succeeded;
* failed;
* retrying;
* permanently failed;
* execution duration;
* queue age.

A growing queue is an operational warning.

---

# 47. Queue Health

Important indicators:

```text
queue depth
oldest job age
failure rate
retry rate
processing throughput
```

Example:

```text
Notification queue
Normal

Reminder queue
12 pending

Provisioning queue
3 failed
```

---

# 48. Data Growth Monitoring

Track growth of:

* bookings;
* booking events;
* jobs;
* audit records;
* notification deliveries;
* media;
* logs;
* database size.

This is especially important as CLENQO expands from:

```text
1 branch
→ 5
→ 20
→ 100+
```

---

# 49. Storage Monitoring

Supabase Storage usage should be monitored.

Potential categories:

```text
CMS media
job evidence
employee documents
customer attachments
```

Retention policies should be defined according to business and legal requirements.

---

# 50. Database Capacity

Monitor:

* database storage;
* connection usage;
* query load;
* CPU/resource pressure where available;
* transaction volume;
* index growth.

Scaling decisions should be based on observed demand rather than premature infrastructure complexity.

---

# 51. Cost Monitoring

As the platform grows, monitor major infrastructure cost drivers:

* database;
* storage;
* bandwidth;
* Vercel usage;
* email;
* payment provider fees;
* future messaging;
* future AI workloads.

Cost monitoring should eventually be visible to HQ/platform administrators where appropriate.

---

# 52. Observability Dashboard

The internal dashboard should eventually provide:

```text
Platform Health
Branch Health
Bookings
Operations
Payments
Notifications
Background Jobs
Performance
Errors
Security Signals
Infrastructure
```

The dashboard itself must obey authorization rules.

Branch Managers should see only permitted branch data.

HQ can see cross-branch information.

---

# 53. Branch-Level Observability

Branch Managers should be able to identify operational issues such as:

```text
unassigned jobs
payment failures
notification failures
booking failures
employee capacity problems
customer complaints
```

They should not gain access to unrelated branch telemetry.

---

# 54. HQ-Level Observability

HQ should be able to compare branches.

Examples:

```text
booking failure rate by branch
payment success by branch
job completion by branch
notification failure by branch
website performance by branch
```

Aggregated reporting must still respect data access policies.

---

# 55. Incident Detection

An incident occurs when an operational condition materially affects:

* customers;
* bookings;
* employees;
* payments;
* data integrity;
* security;
* platform availability.

Observability should help detect incidents early.

---

# 56. Incident Response

Basic response flow:

```text
Detect
  ↓
Assess
  ↓
Contain
  ↓
Recover
  ↓
Verify
  ↓
Document
  ↓
Improve
```

The goal is not only to restore service but to prevent recurrence.

---

# 57. Incident Record

Important incidents should record:

* timestamp;
* affected system;
* affected branches;
* severity;
* symptoms;
* root cause;
* mitigation;
* resolution;
* duration;
* customer impact;
* follow-up actions.

Incident records should not contain unnecessary personal information.

---

# 58. Root Cause Analysis

For significant incidents, investigate:

```text
What failed?
Why did it fail?
Why was it not detected earlier?
What prevented automatic recovery?
What customer/business impact occurred?
What should change?
```

---

# 59. Observability and OpenSpec

Observability requirements belong in OpenSpec changes whenever a feature introduces meaningful operational behavior.

For example:

```text
New payment integration
→ payment metrics
→ provider failure logging
→ webhook monitoring
→ reconciliation visibility
```

A feature is not complete if its important failure modes cannot be diagnosed.

---

# 60. Testing Observability

Test:

* logs emitted for important failures;
* request IDs preserved;
* sensitive values redacted;
* audit events created;
* health checks behave correctly;
* alerts trigger under defined conditions;
* provider failures are distinguishable;
* branch scope is respected;
* metrics are correctly attributed.

Observability itself must be tested.

---

# 61. MVP Observability

The initial production system should include:

### Logging

* structured server logs;
* request IDs;
* safe error logging.

### Health

* application health;
* database connectivity;
* deployment verification.

### Monitoring

* application errors;
* critical API latency;
* booking failures;
* payment failures;
* notification failures;
* provisioning failures.

### Audit

* high-value business actions.

### Operations

* basic branch/platform health indicators.

### Security

* authorization failures;
* webhook failures;
* rate-limit signals.

---

# 62. Future Observability

Future capabilities may include:

* distributed tracing;
* advanced metrics infrastructure;
* centralized log search;
* dedicated error-tracking platform;
* advanced alerting;
* incident management;
* anomaly detection;
* SLO/SLA monitoring;
* synthetic monitoring;
* automated remediation;
* AI-assisted incident analysis.

These should be introduced when actual platform complexity justifies them.

---

# 63. Service-Level Objectives

As CLENQO reaches production scale, define measurable objectives for critical capabilities.

Examples:

```text
website availability
booking availability
booking success
payment processing
notification delivery
dashboard availability
```

SLOs should be based on actual business requirements and measured production behavior.

---

# 64. Golden Observability Signals

CLENQO should continuously watch four fundamental signals:

```text
Latency
Traffic
Errors
Saturation
```

These provide a foundation for understanding system health.

Business-specific signals should then be layered on top.

---

# 65. Architecture Rules

The following are mandatory:

1. Important system behavior must be observable.
2. Logs must be structured.
3. Request IDs must connect important operations.
4. Sensitive information must not be logged.
5. Audit records and operational logs remain separate.
6. Critical business operations require meaningful metrics.
7. Customer-impacting failures must be detectable.
8. Branch-level health must respect branch authorization.
9. External provider failures must be distinguishable from internal failures.
10. Production deployments require post-deployment verification.
11. Health checks must not expose secrets.
12. Observability must not bypass RLS or authorization.
13. Metrics must avoid uncontrolled high-cardinality data.
14. Alerts must be actionable.
15. Background jobs must be observable once introduced.
16. Production telemetry must follow data-minimization principles.
17. Observability requirements must accompany important new features.
18. Monitoring must support diagnosis, not merely status display.

---

# 66. Definition of Done

An observability implementation is complete when:

* [ ] Critical operations emit structured telemetry.
* [ ] Request/correlation IDs are available.
* [ ] Sensitive data is redacted.
* [ ] Important business metrics exist.
* [ ] Critical errors are detectable.
* [ ] Health checks exist where appropriate.
* [ ] External dependency failures are visible.
* [ ] Branch attribution is correct.
* [ ] Authorization scope is respected.
* [ ] Audit events exist for important mutations.
* [ ] Production deployment smoke checks exist.
* [ ] Critical alerts are defined.
* [ ] Logs and metrics are useful for diagnosis.
* [ ] Tests cover important observability behavior.
* [ ] Documentation is synchronized.
* [ ] OpenSpec acceptance criteria pass.

---

# 67. Golden Observability Rule

> **If an important operation can fail, CLENQO must provide enough safe, scoped, and actionable telemetry to determine what failed, where it failed, when it failed, and what business impact it caused.**

Observability must evolve with the platform, remaining simple enough for the current scale while providing a clear path from the first branch to a large multi-country network.
