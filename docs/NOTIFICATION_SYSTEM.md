# CLENQO Notifications and Communications

## 1. Purpose

The CLENQO Notifications and Communications system manages customer, cleaner, branch, and HQ communications triggered by business events.

It connects:

```text
Business Event
      ↓
Notification Event
      ↓
Recipient Resolution
      ↓
Template Resolution
      ↓
Localization
      ↓
Channel
      ↓
Provider
      ↓
Delivery
      ↓
Tracking / Retry
```

Initial communication is email-first.

Future channels may include:

```text
WhatsApp
SMS
Push Notifications
```

---

# 2. Core Communication Principle

> **Business domains generate events; the notification system decides how, when, and through which channel those events are communicated.**

Booking, payment, workforce, and other domains must not contain provider-specific email or WhatsApp logic.

---

# 3. Communication Channels

Initial channel:

```text
email
```

Future channels:

```text
whatsapp
sms
push
```

The architecture should support multiple channels without changing business-domain contracts.

---

# 4. Email Provider

Amazon SES is the initial transactional email provider.

The application should interact with SES through a dedicated provider adapter.

Conceptually:

```text
Notification Engine
      ↓
Email Provider Adapter
      ↓
Amazon SES
```

Provider-specific implementation must remain isolated.

---

# 5. Provider Abstraction

The notification domain should expose a generic interface.

Conceptually:

```text
Notification Channel
        ↓
Provider Adapter
```

This allows future replacement or addition of providers without rewriting business logic.

---

# 6. Notification Events

Notifications are triggered by business events.

Examples:

```text
booking_created
booking_confirmed
booking_rescheduled
booking_cancelled
booking_reminder
job_assigned
job_rescheduled
job_cancelled
job_completed
payment_requested
payment_received
payment_failed
refund_completed
invoice_issued
review_requested
```

The exact event catalog should grow with the platform.

---

# 7. Events vs Notifications

An event means:

> Something happened in the business system.

A notification means:

> Someone should be informed about something.

Example:

```text
booking_confirmed
      ↓
Customer Email
Cleaner/Branch notification if applicable
```

One event may produce multiple notifications.

---

# 8. Notification Event Record

A notification event should preserve enough information to process it safely.

Conceptually:

```text
event_id
event_type
aggregate_type
aggregate_id
branch_id
created_at
payload
```

Sensitive information should not be unnecessarily duplicated.

---

# 9. Event Payload

Payloads should be structured.

Example:

```json
{
  "booking_id": "...",
  "booking_number": "...",
  "scheduled_start": "...",
  "locale": "de"
}
```

Payload contracts should be versioned when necessary.

---

# 10. Recipient Resolution

The notification system determines recipients from the event.

Examples:

```text
Booking confirmed
→ customer

Cleaner assigned
→ assigned cleaner

Critical incident
→ branch manager
```

The event producer should not need to know provider-specific recipient details.

---

# 11. Recipient Types

Initial recipient categories:

```text
customer
cleaner
branch_manager
hq_staff
hq_admin
```

Future recipient groups may be supported.

---

# 12. Customer Contact Information

Customer notifications use the customer's verified/validated contact information available to the application.

The notification system must not invent or infer contact information.

---

# 13. Cleaner Contact Information

Cleaner notifications use the employee's authorized communication details.

Access must remain branch/role scoped.

> **Resolved (BD-C7 — Change 7 decision record):** Change 7 ships an **in-app**
> cleaner notification surface consuming existing Worker event/outbox intents
> (new assignment, reassignment, schedule change, job cancellation, incident
> updates). No delivery infrastructure (push/email/SMS/WhatsApp) and no second
> notification engine are built in Change 7; delivery remains a future
> Notification-domain capability using the employee's authorized contact
> details per this section.

---

# 14. Notification Templates

Messages must use templates rather than hardcoded strings scattered throughout the application.

A template should identify:

```text
event
channel
locale
subject
body
variables
version
status
```

---

# 15. Template Variables

Example:

```text
{{customer_name}}
{{booking_number}}
{{service_name}}
{{date}}
{{time}}
{{total}}
{{manage_booking_url}}
```

Variables must be explicitly defined and validated.

---

# 16. No Arbitrary Template Execution

Templates must not allow arbitrary code execution.

Template rendering must operate on controlled variables.

---

# 17. Template Versioning

Templates should be versioned where historical reproducibility matters.

A notification record should be able to identify which template version generated it.

---

# 18. Template Status

Templates may use:

```text
draft
published
archived
```

Only published templates should be used for normal delivery.

---

# 19. Localization

Notifications must respect the recipient's preferred language where available.

Initial supported languages:

```text
de
en
fr
es
```

The architecture must remain extensible.

---

# 20. Language Resolution

A deterministic fallback should be used:

```text
recipient preference
 ↓
booking/customer preference
 ↓
branch default locale
 ↓
organization default locale
 ↓
platform fallback
```

---

# 21. Customer vs Website Locale

The language selected on the website and the customer's preferred notification language may be related but should not be assumed to be permanently identical.

The customer preference should be stored where appropriate.

---

# 22. Cleaner Locale

Cleaners may have a preferred language.

Notifications to cleaners should use their configured locale when supported.

---

# 23. Date and Time Formatting

Notifications must format:

* date
* time
* timezone

according to the relevant branch/recipient context.

The raw UTC timestamp must not be shown to customers.

---

# 24. Currency Formatting

Financial notifications must format currency using the booking/invoice currency and locale-aware formatting.

---

# 25. Booking Confirmation Email

A booking confirmation should contain:

```text
booking number
service
date
time
address summary
price
important instructions
manage booking link
contact information
```

---

# 26. Booking Management Link

The confirmation email may include a secure magic-link URL.

The link must:

* be unpredictable
* be scoped to the customer's booking
* expire or use an appropriate secure session model
* not expose other bookings

---

# 27. Booking Reminder

A reminder may contain:

```text
service
date
time
address summary
preparation instructions
contact information
```

Reminder timing should be configurable.

---

# 28. Rescheduling Notification

When a booking changes:

```text
old date/time
new date/time
booking number
updated price if applicable
```

The customer should clearly understand what changed.

---

# 29. Cancellation Notification

Cancellation communication should include:

```text
booking number
service
scheduled time
cancellation status
fee if applicable
refund information if applicable
```

---

# 30. Payment Request

For payment-after-completion:

```text
Job Completed
 ↓
Payment Request
 ↓
Customer Email
```

The email should provide a secure payment path.

---

# 31. Payment Confirmation

Successful payment notification may contain:

```text
amount
currency
booking/invoice
payment date
payment method summary
receipt
```

Sensitive provider data must not be exposed unnecessarily.

---

# 32. Payment Failure

A failed payment notification should:

* explain that payment was unsuccessful
* provide a safe retry path
* identify the relevant booking/invoice
* avoid exposing technical provider errors

---

# 33. Invoice Notification

Invoice emails may contain:

```text
invoice number
amount
currency
issue date
due date
payment instructions
invoice document/link
```

---

# 34. Refund Notification

Refund notifications should contain:

```text
refund amount
currency
booking/invoice reference
refund status
```

---

# 35. Cleaner Assignment Notification

A cleaner assignment message may contain:

```text
job
service
date
time
address
special operational instructions
```

Only information necessary for the job should be shared.

---

# 36. Job Change Notification

If a job is rescheduled, reassigned, or cancelled, affected cleaners should receive the appropriate notification.

---

# 37. Incident Notification

Critical operational incidents may notify:

```text
branch manager
operations staff
HQ
```

according to escalation rules.

---

# 38. Review Request

After job completion:

```text
Job Completed
 ↓
Review Request
```

The review request should contain a secure review link.

---

# 39. Notification Preferences

Users may eventually control certain notification preferences.

Possible categories:

```text
transactional
operational
marketing
```

Transactional notifications generally cannot be disabled when legally or operationally required.

---

# 40. Marketing vs Transactional

The system must clearly separate:

```text
transactional communication
```

from:

```text
marketing communication
```

Marketing consent rules must not accidentally suppress critical service notifications.

---

# 41. Consent

Where required, the system should preserve appropriate consent information for marketing communications.

Consent data must be auditable.

---

# 42. Unsubscribe

Marketing messages must support the appropriate unsubscribe mechanism.

Transactional messages should not use marketing unsubscribe behavior as a reason to suppress essential booking/service information.

---

# 43. Notification Delivery Record

Every attempted notification should have a delivery record.

Conceptually:

```text
notification_event
 ↓
delivery
```

A delivery may record:

```text
channel
recipient
provider
status
provider_reference
sent_at
delivered_at
failed_at
error_code
```

---

# 44. Delivery Status

Possible states:

```text
queued
sending
sent
delivered
failed
cancelled
```

Provider capabilities may determine which states are available.

---

# 45. Email Delivery

SES may provide delivery/bounce/complaint information.

The application should process supported provider events and update delivery state.

---

# 46. Bounce Handling

Repeated hard bounces should be handled appropriately.

The system may mark an email address as problematic without deleting historical customer records.

---

# 47. Complaint Handling

Provider complaint events should be processed carefully.

Marketing communication should respect complaint/suppression status.

Transactional communication must follow applicable rules.

---

# 48. Retry Strategy

Temporary delivery failures should be retryable.

Retries must use:

```text
bounded attempts
backoff
idempotency
```

Permanent failures should not be retried indefinitely.

---

# 49. Retry Safety

A retry must not accidentally send duplicate messages when the previous attempt actually succeeded but the application did not receive the final response.

Provider/reference tracking should be used where possible.

---

# 50. Notification Queue

Notifications should be processed asynchronously where appropriate.

Conceptually:

```text
Business Transaction
      ↓
Notification Event
      ↓
Queue / Worker
      ↓
Provider
```

A valid booking should not fail simply because email delivery is temporarily unavailable.

---

# 51. Transactional Boundary

Critical business data should be committed before dependent communication is treated as successful.

Example:

```text
Booking Transaction
 ↓
Committed
 ↓
Notification Processing
```

---

# 52. Outbox Pattern

Where reliability requires it, the system may use an outbox/event pattern.

Example:

```text
Database Transaction
├── Booking
├── Booking Event
└── Notification Outbox Event
```

A worker then processes the outbox event.

This prevents lost notifications caused by application crashes between database commit and message dispatch.

---

# 53. Initial Processing Strategy

The first implementation may use a simple reliable database-backed event/outbox mechanism rather than introducing a large external message broker.

> **Implemented (Change 5, minimal outbox):** migration `0011_booking.sql`
> creates `notification_outbox` and the booking flow writes rows
> transactionally with the business operation for four event types:
> `booking_confirmation_email`, `booking_cancellation_email`,
> `booking_reschedule_email`, and `magic_link_email`. Rows remain `pending`;
> the delivery worker, retry loop, and channels are the Notification
> change's scope.

Do not add Kafka or similar infrastructure without a demonstrated need.

---

# 54. Notification Scheduling

Some notifications are immediate.

Others are scheduled.

Examples:

```text
booking confirmation → immediate
payment confirmation → immediate
booking reminder → scheduled
review request → scheduled/immediate
```

---

# 55. Reminder Scheduling

Reminder jobs must be idempotent.

A booking should not generate duplicate reminders because of worker retries.

---

# 56. Cancelled Booking Reminders

If a booking is cancelled before a reminder is sent:

```text
Reminder
→ cancelled/suppressed
```

The system must not send a misleading reminder.

---

# 57. Rescheduled Booking Reminders

If a booking changes:

```text
Old reminder
→ invalidated
New reminder
→ scheduled
```

---

# 58. Notification Links

Links in messages should use secure application routes.

Examples:

```text
booking management
payment
invoice
review
```

Sensitive actions should require secure authorization.

---

# 59. Link Security

Notification links must not expose:

```text
database IDs unnecessarily
internal admin routes
provider credentials
private staff information
```

---

# 60. Notification Authorization

The notification system must verify that the recipient is actually entitled to receive the information.

An event must not automatically grant access to its payload.

---

# 61. Branch Scope

Notification processing must preserve branch context.

Branch users should not accidentally receive notifications containing another branch's operational information.

---

# 62. HQ Notifications

HQ users may receive organization-wide notifications according to their permissions and notification subscriptions.

---

# 63. Branch Manager Notifications

Branch managers may receive:

* new bookings
* unassigned jobs
* critical incidents
* payment/financial alerts where authorized
* operational failures

Exact categories should be configurable.

---

# 64. Cleaner Notifications

Cleaners should receive only operational information relevant to their assignments.

---

# 65. Customer Notifications

Customers should receive information related only to their own bookings/services.

---

# 66. Notification Templates and CMS

Notification templates are related to content management but should not become arbitrary public CMS pages.

A dedicated notification template model should control:

```text
subject
body
variables
locale
version
status
```

---

# 67. Dashboard Notification Management

Authorized administrators should eventually be able to:

* view templates
* edit templates
* preview templates
* manage translations
* publish templates
* inspect delivery status

---

# 68. Template Preview

Dashboard preview should render templates with safe sample data.

It must not expose real customer data unnecessarily.

---

# 69. Template Validation

Before publication, validate:

* required variables
* supported locale
* valid subject
* supported event
* valid template syntax

---

# 70. Provider Errors

Provider errors should be normalized.

Example:

```text
provider_timeout
invalid_recipient
rate_limited
authentication_failure
temporary_failure
permanent_failure
```

The application should not depend on raw provider error strings throughout the codebase.

---

# 71. Rate Limits

Notification sending must respect provider rate limits.

The worker should use controlled concurrency and retry behavior.

---

# 72. Email Deliverability

Production email requires:

* verified sending domain
* SPF configuration
* DKIM
* appropriate DNS configuration
* bounce/complaint handling
* sensible sending reputation practices

These are deployment concerns but must be reflected in the notification architecture.

---

# 73. Sender Addresses

CLENQO may use different sender identities where configured.

Examples:

```text
hello@...
bookings@...
support@...
```

Actual domains and addresses are environment/branch configuration.

---

# 74. Reply-To

Notification templates may define a reply-to address where appropriate.

---

# 75. Branch Branding

Branch communications may include approved:

* branch name
* contact information
* logo
* local address
* service information

Core brand standards remain centrally controlled.

---

# 76. Localization and Branding

The system must resolve:

```text
branch
+
locale
+
template version
```

to produce the correct message.

---

# 77. Notification Attachments

Future notifications may contain:

* invoices
* receipts
* documents

Attachments should be generated securely and must not expose unrelated files.

---

# 78. Storage

Generated documents should use controlled storage.

Public permanent URLs should not be used for private financial documents.

Signed/authorized access should be preferred.

---

# 79. Security

The notification system must protect against:

* template injection
* unauthorized recipients
* leaked magic links
* sensitive-data exposure
* forged provider callbacks
* duplicate delivery
* malicious user-controlled content

---

# 80. User-Generated Content

Customer or cleaner-provided text inserted into messages must be escaped/sanitized appropriately.

Never interpret user content as template instructions.

---

# 81. Logging

Logs should contain useful operational information without unnecessarily storing:

* full email bodies
* sensitive customer data
* payment credentials
* authentication tokens
* magic-link secrets

---

# 82. Observability

Useful metrics include:

```text
notifications_queued
notifications_sent
notifications_delivered
notifications_failed
bounce_rate
complaint_rate
retry_count
provider_latency
```

---

# 83. Notification Monitoring

Dashboard users should eventually be able to inspect:

```text
delivery status
failure reason
provider reference
retry state
```

according to permission.

---

# 84. Testing Strategy

Automated tests should cover:

```text
event generation
recipient resolution
template rendering
variables
localization
fallback
provider adapter
webhooks
retries
idempotency
duplicate events
cancelled reminders
rescheduled reminders
authorization
branch isolation
```

---

# 85. Email Testing

Development should use a safe email testing mechanism rather than accidentally sending production emails.

Production provider credentials must never be used casually during development.

---

# 86. Provider Abstraction Testing

Business-domain tests should not require a live SES account.

Use a mock/fake provider implementation for most automated tests.

---

# 87. WhatsApp Future Architecture

Future WhatsApp support should follow:

```text
Business Event
      ↓
Notification Engine
      ↓
WhatsApp Adapter
      ↓
WhatsApp Provider
```

Business domains should not directly call WhatsApp APIs.

---

# 88. SMS Future Architecture

SMS should follow the same abstraction:

```text
Notification Engine
      ↓
SMS Adapter
      ↓
Provider
```

---

# 89. Multi-Channel Delivery

A future event may use multiple channels.

Example:

```text
Critical Job Change
├── Email
└── WhatsApp
```

Channel selection should be policy-driven.

---

# 90. Channel Fallback

Future policies may support:

```text
Email fails
 ↓
WhatsApp fallback
```

Fallback must be explicitly configured.

It must not create uncontrolled duplicate communication.

---

# 91. Marketing Automation

Marketing automation should remain separate from transactional notifications.

Future capabilities may include:

* customer campaigns
* reactivation
* recurring-service reminders
* promotions
* newsletters

These require appropriate consent and segmentation.

---

# 92. Notification Preferences

A future preferences model may support:

```text
email
whatsapp
sms
push
```

with categories:

```text
transactional
operational
marketing
```

---

# 93. Data Retention

Delivery records may be retained for operational/audit purposes.

Retention should follow applicable legal and business requirements.

---

# 94. Privacy

Communication records may contain customer and employee information.

Use:

* least privilege
* branch isolation
* RLS
* secure storage
* controlled access
* data minimization

---

# 95. Reliability Principle

Notification failure must not corrupt a valid business transaction.

Example:

```text
Booking succeeds
Email fails
```

Expected result:

```text
Booking = valid
Notification = retryable failure
```

---

# 96. MVP Notification Scope

Initial implementation should include:

```text
email notifications
Amazon SES adapter
notification events
templates
de/en/fr/es
booking confirmation
booking cancellation
booking change
basic reminders
payment notifications
invoice notifications
delivery records
retry handling
idempotency
basic dashboard visibility
```

---

# 97. Future Communication Capabilities

Future versions may add:

* WhatsApp
* SMS
* push notifications
* advanced preference management
* marketing automation
* multi-channel fallback
* advanced campaigns
* customer communication history
* AI-assisted communication

---

# 98. Architectural Summary

The communication architecture is:

```text
Business Domain
      ↓
Domain Event
      ↓
Notification Event
      ↓
Recipient Resolution
      ↓
Template + Locale
      ↓
Channel Adapter
      ↓
Provider
      ↓
Delivery Record
      ↓
Retry / Status / Audit
```

---

# 99. Golden Communication Rule

> **CLENQO business domains must never depend directly on communication providers. Every important communication must originate from an auditable business event, use an authorized localized template, reach the correct recipient through an abstracted channel, and remain safely retryable without corrupting or duplicating the underlying business transaction.**
