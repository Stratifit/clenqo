# CLENQO Audit and Activity

## 1. Purpose

The CLENQO Audit and Activity system provides a reliable history of important actions and changes across the platform.

It answers:

* Who performed an action?
* What happened?
* When did it happen?
* Which organization or branch was affected?
* Which resource was affected?
* What changed?
* Was the action successful?
* Can the event be traced back to its source?

Auditability is required for security, operations, finance, administration, troubleshooting, and accountability.

---

# 2. Core Principle

> **Important business and administrative changes must be attributable, traceable, and reviewable.**

The audit system must not be an optional logging layer added only after problems occur.

---

# 3. Audit vs Activity

CLENQO distinguishes between:

### Audit

Security and accountability record of important actions.

### Activity

Human-friendly operational history intended for dashboard users.

They may share underlying event information but serve different purposes.

Example:

```text
Audit:
User 8f... changed pricing profile version 4 → 5

Activity:
Pricing profile updated
```

---

# 4. Audit Source of Truth

Audit records are historical records.

They should not be treated as the authoritative current state of a business object.

For example:

```text
Current Booking
→ Booking Domain

Booking History
→ Audit / Booking Events
```

---

# 5. Audit Events

Important actions should generate structured audit events.

Examples:

```text
branch.created
branch.activated
branch.suspended
branch.archived

user.invited
user.role_changed
user.deactivated

website.updated
website.published

pricing.updated
pricing.published

booking.created
booking.updated
booking.cancelled

employee.created
employee.updated
employee.deactivated

payment.created
payment.refunded

invoice.created
invoice.updated

review.moderated
complaint.updated
```

---

# 6. Event Naming

Audit event names should be:

* consistent
* machine-readable
* descriptive
* versionable where necessary

Preferred format:

```text
resource.action
```

Examples:

```text
branch.created
booking.cancelled
invoice.issued
employee.deactivated
```

---

# 7. Audit Record

An audit record should conceptually contain:

```text
id
organization_id
branch_id
actor_id
actor_type
action
resource_type
resource_id
timestamp
result
metadata
request_id
```

Additional fields may be introduced when justified.

---

# 8. Organization Scope

Where applicable, every audit record should identify the organization.

This allows:

```text
organization
 ↓
audit history
```

to remain isolated.

---

# 9. Branch Scope

Branch-specific events should include the affected branch.

Example:

```text
booking.cancelled
branch = Berlin
```

Global organization events may have no branch.

---

# 10. Actor

The actor identifies who or what initiated the action.

Possible actor types:

```text
user
customer
system
automation
webhook
api
```

---

# 11. User Actor

For authenticated internal users, audit records should reference the relevant user/membership identity.

Historical audit records must remain understandable even if the user later becomes inactive.

---

# 12. System Actor

Automated operations may be recorded as:

```text
actor_type = system
```

Examples:

```text
scheduled reminder
automatic booking transition
provisioning retry
```

---

# 13. Automation Actor

Future automation engines may identify the specific automation responsible.

Example:

```text
actor_type = automation
actor_reference = reminder_job
```

---

# 14. Webhook Actor

External provider callbacks should be attributable.

Example:

```text
actor_type = webhook
provider = payment_provider
event_id = external-event-id
```

---

# 15. Customer Activity

Customer actions that materially affect business data may be audited.

Examples:

```text
booking.created
booking.rescheduled
booking.cancelled
review.submitted
```

---

# 16. Anonymous Actions

Public users may not always be authenticated.

Where useful, anonymous actions may record:

```text
request_id
session identifier
source
```

without unnecessarily storing personal information.

---

# 17. Resource

Every meaningful audit event should identify the affected resource when possible.

Examples:

```text
resource_type = booking
resource_id = UUID
```

or:

```text
resource_type = branch
resource_id = UUID
```

---

# 18. Request ID

Requests should receive a traceable request/correlation identifier where practical.

Example:

```text
Request
 ↓
Booking Creation
 ↓
Payment Request
 ↓
Notification
```

A shared correlation ID can help diagnose the complete operation.

---

# 19. Result

Audit records should distinguish outcomes.

Possible values:

```text
success
failure
denied
```

---

# 20. Authorization Failures

Important authorization failures may be logged.

Example:

```text
booking.update
result = denied
```

The audit record should avoid exposing sensitive information.

---

# 21. Sensitive Data

Audit records must not become a second uncontrolled database containing copies of sensitive information.

Avoid storing:

* passwords
* authentication tokens
* magic-link tokens
* payment credentials
* card numbers
* CVV
* unnecessary personal data

---

# 22. Before and After Values

For configuration changes, the system may store relevant before/after information.

Example:

```text
pricing_rate:
before = 30
after = 32
```

Only appropriate fields should be captured.

---

# 23. Sensitive Field Redaction

If a changed object contains sensitive fields, those fields must be:

```text
redacted
excluded
hashed
```

as appropriate.

---

# 24. Metadata

Audit metadata should be structured.

Example:

```text
{
  "field": "default_locale",
  "previous": "de",
  "new": "en"
}
```

Avoid arbitrary unbounded payloads.

---

# 25. Metadata Size

Audit metadata must remain bounded.

Large objects, uploaded files, complete customer records, or entire database rows should not be copied into audit records.

---

# 26. Audit Immutability

Audit records should be treated as append-only.

Normal application users must not be able to:

```text
edit
rewrite
delete
```

historical audit records.

---

# 27. Administrative Audit Access

Authorized HQ users may view audit history.

Branch users may view only records within their authorized scope.

---

# 28. Audit Permissions

Possible permissions:

```text
audit.view
audit.view_branch
audit.view_sensitive
audit.export
```

Exact permissions remain subject to the authorization model.

---

# 29. Branch Isolation

A Branch Manager viewing audit history must not see unrelated branch activity.

RLS and server-side authorization must enforce this.

---

# 30. HQ Audit View

HQ may filter audit history by:

```text
branch
actor
resource
action
date
result
```

---

# 31. Branch Audit View

Branch managers may see relevant local activity.

Example:

```text
Branch Berlin

Booking cancelled
Employee assigned
Job completed
Website content published
```

---

# 32. Audit Search

Audit search should support structured filters rather than unrestricted text search over sensitive payloads.

Useful filters:

```text
action
resource type
actor
branch
date range
result
```

---

# 33. Activity Timeline

Important business resources should support human-readable activity timelines.

Examples:

```text
Booking
 ├── Created
 ├── Confirmed
 ├── Assigned
 ├── Started
 └── Completed
```

---

# 34. Booking Activity

A booking timeline may show:

```text
booking created
price calculated
confirmation sent
cleaner assigned
customer rescheduled
payment received
booking completed
review requested
```

---

# 35. Job Activity

A job timeline may show:

```text
job created
assignment created
assignment accepted
cleaner checked in
job started
job completed
```

---

# 36. Branch Activity

Branch history may show:

```text
branch created
website provisioned
manager assigned
services configured
pricing published
branch activated
```

---

# 37. Customer Activity

Authorized staff may see appropriate customer activity.

Privacy-sensitive events must remain restricted.

---

# 38. Employee Activity

Authorized managers may see relevant operational activity.

Employment-sensitive information must not be exposed unnecessarily.

---

# 39. Website Activity

CMS history may show:

```text
page edited
section updated
media replaced
SEO changed
page published
```

---

# 40. Pricing Activity

Pricing history is particularly important.

Example:

```text
Pricing Version 3
€30/hour

Published by HQ Admin

Pricing Version 4
€32/hour

Published by HQ Admin
```

---

# 41. Financial Activity

Financial events should be auditable.

Examples:

```text
payment received
payment failed
refund issued
invoice created
invoice marked paid
manual adjustment
```

---

# 42. Refund Audit

Refunds should record:

```text
actor
amount
reason
booking/payment
timestamp
result
```

Manual refunds require appropriate permission.

---

# 43. Permission Changes

Role and permission changes must be auditable.

Examples:

```text
manager assigned
manager removed
role changed
branch access granted
branch access revoked
```

---

# 44. User Lifecycle

The following should be auditable:

```text
invited
activated
role changed
branch assigned
branch removed
deactivated
```

---

# 45. Branch Lifecycle

Branch state transitions should be recorded.

Example:

```text
draft
 ↓
provisioning
 ↓
ready
 ↓
active
 ↓
suspended
 ↓
archived
```

---

# 46. Provisioning Audit

Automatic branch provisioning should record major stages.

Example:

```text
branch.created
website.provisioned
locales.provisioned
pages.provisioned
configuration.provisioned
branch.ready
```

---

# 47. Provisioning Failure

If provisioning fails:

```text
provisioning.failed
```

should contain enough diagnostic information to investigate without exposing secrets.

---

# 48. Provisioning Retry

A retry should be separately traceable.

Example:

```text
provisioning.failed
provisioning.retry_started
provisioning.completed
```

---

# 49. Audit and Idempotency

Idempotent operations must avoid producing misleading duplicate business effects.

Repeated retries may still generate technical attempt records where useful.

The system should distinguish:

```text
business operation
```

from:

```text
processing attempt
```

---

# 50. Audit and Transactions

For important transactional operations, business-state changes and their corresponding audit event should be coordinated.

Where appropriate:

```text
Database Transaction
 ├── Business Change
 └── Audit Record
```

This avoids recording successful changes that never actually committed.

---

# 51. Outbox Pattern

For events that must be delivered outside the database, an outbox-style approach may be used.

Example:

```text
Transaction
 ├── Business Change
 └── Outbox Event
        ↓
Background Worker
        ↓
External System
```

---

# 52. Audit vs Outbox

These systems have different purposes.

```text
Audit
→ historical accountability

Outbox
→ reliable event delivery
```

They may share event information but should not be conflated.

---

# 53. Audit vs Domain Events

Domain events represent business events.

Audit records represent accountability.

Example:

```text
Domain Event:
booking.cancelled

Audit:
User X cancelled Booking Y
```

---

# 54. Audit vs Notification

Notifications are communications.

Audit records are historical evidence.

```text
Booking cancelled
 ├── Audit record
 ├── Domain event
 └── Customer notification
```

Each serves a different purpose.

---

# 55. Audit Retention

Audit retention should follow legal, security, and business requirements.

Important financial and administrative records may require longer retention than ordinary activity data.

---

# 56. Deletion Requests

Privacy-related deletion processes must distinguish between:

```text
personal data
```

and:

```text
legitimate audit records
```

Retention requirements must be evaluated before removing or anonymizing information.

---

# 57. User Deletion

Deleting or deactivating a user must not make historical audit records meaningless.

The system should preserve the necessary historical actor reference or use an appropriate anonymization strategy.

---

# 58. Branch Archiving

Archived branches should retain appropriate audit history.

Historical branch activity must remain attributable.

---

# 59. Audit Storage

Initial implementation should use PostgreSQL.

Example conceptual table:

```text
audit_logs
```

with appropriate indexes.

---

# 60. Audit Indexes

Common indexes may include:

```text
organization_id
branch_id
actor_id
resource_type + resource_id
action
created_at
```

Exact indexing should follow real query patterns.

---

# 61. Partitioning

Audit partitioning should not be introduced prematurely.

If audit volume becomes large, partitioning by time may become appropriate.

---

# 62. Audit Query Performance

Audit views should use:

* pagination
* date bounds
* indexes
* permission-aware filtering

Never load an organization's entire audit history into the browser.

---

# 63. Pagination

Audit results should use cursor-based or appropriately bounded pagination when scale requires it.

---

# 64. Export

Authorized users may export audit records.

Exports should:

* respect scope
* respect filters
* exclude unnecessary sensitive information
* be auditable

---

# 65. Audit Export Logging

Sensitive audit exports may themselves generate an audit event.

Example:

```text
audit.exported
```

---

# 66. Activity UI

Activity timelines should be understandable to normal administrators.

Example:

```text
Today · 10:42

Pricing updated

Standard Cleaning:
€30 → €32

by HQ Admin
```

---

# 67. Technical Details

Technical identifiers may be available through an expanded detail view.

The default UI should prioritize human-readable information.

---

# 68. Error Visibility

Audit records should not expose:

* stack traces
* secrets
* tokens
* internal credentials

to ordinary dashboard users.

---

# 69. Security Monitoring

Audit data may eventually feed security monitoring.

Potential signals:

```text
many failed authorization attempts
unusual financial actions
unexpected permission changes
bulk exports
```

---

# 70. Suspicious Activity

Future security systems may flag unusual activity.

Example:

```text
100 refund attempts
from one account
within 5 minutes
```

The analytics/security system may alert authorized administrators.

---

# 71. Audit Alerts

Audit events may trigger alerts for high-risk operations.

Examples:

```text
organization admin removed
large refund
payment configuration changed
branch archived
bulk customer export
```

Thresholds and rules must be explicit.

---

# 72. Audit Integrity

The system should protect audit records from unauthorized modification.

Potential future measures include:

* append-only permissions
* restricted database roles
* integrity checks
* immutable archival storage

---

# 73. Service Role Protection

Supabase service-role credentials must never be exposed to clients.

Privileged audit operations remain server-side.

---

# 74. RLS

RLS should prevent unauthorized users from reading audit data.

Special care is required because audit records can contain sensitive operational information.

---

# 75. Application Authorization

RLS alone is not sufficient for complex audit views.

Server-side authorization should determine:

```text
who
can see
which audit scope
```

---

# 76. Multi-Branch Audit

HQ should be able to inspect cross-branch activity where authorized.

Example:

```text
All Branches
 ├── Berlin
 ├── Leipzig
 ├── Hamburg
 └── Munich
```

Branch users remain isolated.

---

# 77. Global Events

Some events are organization-wide.

Example:

```text
organization.settings.updated
```

These may have no branch ID.

---

# 78. Branch Events

Other events belong to a specific branch.

Example:

```text
branch.website.published
branch.booking.cancelled
```

---

# 79. Resource Relationships

Audit interfaces should allow navigation from an audit record to the affected resource where authorized.

Example:

```text
Audit Record
 ↓
Booking
 ↓
Booking Details
```

---

# 80. Deleted Resources

If the original resource is archived or deleted, the audit record should remain understandable.

Avoid relying entirely on live joins to display historical meaning.

---

# 81. Snapshot Metadata

Where necessary, limited descriptive metadata may be captured to preserve historical context.

Example:

```text
resource_type = branch
resource_id = UUID
resource_name_at_time = "Berlin"
```

This must not become a full duplicate record.

---

# 82. Historical Names

If a branch or user changes name, historical records should remain interpretable.

The system should distinguish current identity from historical context.

---

# 83. Audit Consistency

All major domains should follow common audit conventions.

Avoid separate incompatible audit formats for:

```text
booking
finance
CMS
workforce
quality
```

---

# 84. Central Audit Service

A shared audit service should provide a consistent interface.

Conceptually:

```text
audit.record({
  action,
  resource,
  actor,
  scope,
  result,
  metadata
})
```

The exact implementation may evolve.

---

# 85. Domain Responsibility

Each domain determines which business actions are audit-worthy.

The central audit infrastructure determines how those events are stored and accessed.

---

# 86. Avoid Logging Everything

Not every technical operation needs a permanent audit record.

Do not flood the audit system with:

```text
every page render
every API GET
every UI interaction
```

unless required for a specific security/analytics purpose.

---

# 87. High-Value Audit Events

Prioritize:

```text
security changes
permission changes
financial actions
pricing changes
branch lifecycle
customer-data access
CMS publication
operational overrides
```

---

# 88. Customer Data Access

Future sensitive-data access logging may record when authorized staff access particularly sensitive customer information.

This should be implemented selectively rather than logging every ordinary page view.

---

# 89. Internal Notes

Access to sensitive internal notes should remain permission-controlled.

If regulatory or security requirements justify it, access may be audited.

---

# 90. API Actions

Important API operations should use the same audit system as dashboard actions.

There must not be a less-controlled path through the API.

---

# 91. Background Jobs

Automated jobs performing business mutations should generate appropriate audit records.

Example:

```text
system
→ booking reminder cancelled
```

or:

```text
automation
→ recurring booking occurrence generated
```

---

# 92. Webhook Processing

External webhooks that change business state should be traceable.

Example:

```text
Payment Provider
 ↓
Webhook
 ↓
Payment Updated
 ↓
Audit
```

---

# 93. Audit Testing

Tests should verify:

* correct actor
* correct organization
* correct branch
* correct resource
* correct action
* correct result
* authorization
* immutability
* sensitive-field redaction
* transaction behavior
* retry behavior

---

# 94. Authorization Testing

At minimum test:

```text
HQ Admin
→ organization-wide access

Branch Manager
→ assigned branch only

Cleaner
→ restricted operational scope

Unauthorized User
→ denied
```

---

# 95. Branch Isolation Testing

Attempted cross-branch access must fail.

Examples:

```text
Branch A user
→ Branch B audit
```

must be denied.

---

# 96. Financial Audit Testing

Verify that:

```text
payment
refund
invoice
manual adjustment
```

actions create appropriate historical records.

---

# 97. Pricing Audit Testing

Verify:

```text
pricing draft
pricing update
pricing publication
pricing override
```

are appropriately traceable.

---

# 98. CMS Audit Testing

Verify:

```text
page edit
section edit
media replacement
SEO update
publication
```

produce appropriate history.

---

# 99. Provisioning Testing

Branch provisioning tests must verify:

```text
branch creation
→ expected resources
→ expected audit events
```

and:

```text
failed provisioning
→ retry
→ no destructive duplication
```

---

# 100. Observability

Audit infrastructure should itself be monitored.

Track:

```text
audit write failures
queue failures
storage errors
query latency
export failures
```

A failed audit write should be treated seriously for high-value actions.

---

# 101. Audit Failure Policy

For critical operations, the system must define whether the business transaction:

```text
fails if audit cannot be recorded
```

or:

```text
continues with durable retry
```

This decision should be explicit per operation.

---

# 102. No Silent Audit Loss

Important audit events must never disappear silently because of transient infrastructure failures.

---

# 103. Audit UI

Initial dashboard functionality should include:

```text
Activity
Audit Logs
Resource History
```

where permitted.

---

# 104. MVP Audit Scope

The MVP should include:

```text
audit_logs
actor tracking
organization scope
branch scope
resource tracking
action tracking
timestamps
result
structured metadata
core administrative events
financial events
pricing events
CMS publication events
booking events
employee events
branch lifecycle
permission changes
```

---

# 105. Future Audit Capabilities

Future versions may add:

* advanced security monitoring
* sensitive-data access auditing
* immutable archival
* anomaly detection
* automated alerts
* compliance reporting
* advanced change diffs
* centralized security investigations

---

# 106. Golden Audit Rule

> **CLENQO must be able to explain important changes after they happen. Audit records are append-oriented, permission-controlled, branch-aware, privacy-conscious, and attributable to a human, system, automation, or external event. Audit history provides accountability without becoming a duplicate operational database or an uncontrolled store of sensitive information.**
