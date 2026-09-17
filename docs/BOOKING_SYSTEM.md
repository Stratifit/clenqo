# CLENQO Booking System

## 1. Purpose

The CLENQO Booking System manages the complete lifecycle of a cleaning booking from customer request to completed service.

It connects:

```text
Public Website
      ↓
Booking Experience
      ↓
Customer
      ↓
Pricing Engine
      ↓
Availability
      ↓
Booking
      ↓
Job
      ↓
Cleaner Assignment
      ↓
Service Execution
      ↓
Completion
      ↓
Review / Payment / Invoice
```

The booking system must be reliable, deterministic, secure, branch-aware, and extensible.

---

# 2. Core Booking Principle

> **A booking is a real business transaction, not simply a form submission.**

Creating a booking must therefore validate:

* branch
* service
* service variant
* property/service details
* requested date
* requested time
* availability
* pricing
* customer information
* booking rules
* applicable surcharges
* applicable discounts
* required policies

before the booking becomes confirmed.

---

# 3. Customer Experience

Customers do not need to create an account to book.

Initial flow:

```text
Branch Website
 ↓
Book a Cleaning
 ↓
Select Service
 ↓
Enter Cleaning Details
 ↓
Select Date & Time
 ↓
Calculate Price
 ↓
Enter Customer Details
 ↓
Review Booking
 ↓
Confirm
 ↓
Confirmation
```

The experience should be mobile-first.

---

# 4. No Mandatory Customer Account

The initial booking experience must not require:

```text
username
password
account creation
```

Customer information is collected during booking.

Customer access after booking uses secure magic links.

---

# 5. Customer Information

Required information should generally include:

```text
first_name
last_name
email
phone
```

Additional information may include:

```text
company
preferred_language
special_instructions
```

Only necessary information should be collected.

---

# 6. Booking Types

Initial booking types:

```text
one_time
recurring
move_in
move_out
commercial
airbnb
```

The exact service type and booking type should remain separate concepts.

---

# 7. Branch Context

Every booking belongs to a branch.

Conceptually:

```text
Website
 ↓
Branch
 ↓
Services
 ↓
Pricing
 ↓
Availability
 ↓
Booking
```

A customer must not be able to create a booking for a branch through an unrelated branch website context without explicit support.

---

# 8. Service Selection

The first booking step allows the customer to choose a service.

Initial services include:

```text
Home Cleaning
Business / Commercial Cleaning
Deep Cleaning
Move-In / Move-Out Cleaning
```

The actual service catalog comes from the branch configuration.

Disabled services must not be bookable.

---

# 9. Service Variants

A service may contain variants.

Example:

```text
Home Cleaning
├── Regular Cleaning
├── Deep Cleaning
└── Recurring Cleaning
```

The selected variant becomes part of the booking.

---

# 10. Service Add-Ons

Customers may select optional add-ons.

Examples:

```text
Inside Oven
Inside Refrigerator
Windows
Laundry
Extra Bathroom
Pet Hair Treatment
```

Only add-ons available for the selected branch/service may be selected.

---

# 11. Property / Service Details

The booking flow must collect enough information for pricing and operations.

Depending on the service, this may include:

```text
property_type
number_of_rooms
number_of_bathrooms
floor_area
number_of_floors
occupancy
condition
pets
last_cleaning
special_requirements
```

The exact fields depend on the service.

---

# 12. Conditional Questions

The booking form should only show questions relevant to the selected service.

Example:

```text
Home Cleaning
→ bedrooms
→ bathrooms
→ floor area
→ pets
```

while:

```text
Commercial Cleaning
→ business type
→ floor area
→ operating hours
→ number of rooms
```

This reduces customer friction.

---

# 13. Booking Address

The service location must be collected before confirmation.

Required information may include:

```text
street
house_number
postal_code
city
country
```

Additional access information may include:

```text
building access
floor
elevator
parking
key instructions
```

Sensitive access information must be protected.

---

# 14. Service Area Validation

The system must determine whether the requested address is within the branch service area.

Conceptually:

```text
Customer Address
 ↓
Branch Service Area
 ↓
Eligible?
```

If outside the supported area:

```text
Booking cannot proceed
```

or the system may offer a contact/assessment flow.

---

# 15. Date Selection

Customers choose an available service date.

The availability system must consider:

* branch operating hours
* employee availability
* existing jobs
* service duration
* required buffer
* holidays
* blocked periods
* booking rules

Availability must not be hardcoded into the frontend.

---

# 16. Time Selection

The system should present valid time slots.

Example:

```text
09:00
10:00
11:30
14:00
16:00
```

Actual slots are generated from availability and operational constraints.

---

# 17. Availability Source of Truth

The server is the source of truth for availability.

The frontend may display available slots.

However, before confirmation the server must re-check availability.

This prevents stale browser data from creating conflicting bookings.

---

# 18. Double Booking Protection

Two simultaneous booking attempts must not be able to reserve the same unavailable resource.

The system should use appropriate:

* database transactions
* locking
* constraints
* availability checks

depending on the scheduling model.

---

# 19. Booking Hold

Where required, the system may temporarily hold a selected slot while the customer completes checkout.

The temporary reservation mechanism is **scheduling-owned**: slot holds are created, validated, expired, and consumed by the scheduling domain (`SCHEDULING_SYSTEM.md` §84, decision S1). Booking drafts do not independently block capacity, and there is no persisted blocking `pending` reservation state in V1.

Conceptually:

```text
Available
 ↓
Temporary Hold
 ↓
Confirmed
```

or:

```text
Temporary Hold
 ↓
Expired
 ↓
Available
```

Hold duration should be limited.

The first implementation should avoid unnecessarily long holds.

---

# 20. Pricing Integration

The booking system calls the pricing engine.

Conceptually:

```text
Booking Inputs
 ↓
Pricing Engine
 ↓
Price Result
```

The pricing engine determines:

* base service price
* duration
* difficulty
* add-ons
* surcharges
* discounts
* tax
* final total

---

# 21. Pricing Is Not UI Logic

The frontend must never independently calculate the authoritative booking price.

It may show estimates.

The server-side pricing engine remains authoritative.

---

# 22. Price Recalculation

The price should be recalculated whenever pricing-relevant booking data changes.

Examples:

```text
service changed
property size changed
bathrooms changed
add-on added
date changed
special surcharge applies
```

---

# 23. Price Snapshot

When the booking becomes confirmed, store a pricing snapshot.

The snapshot should preserve:

```text
pricing profile
pricing version
inputs
base price
add-ons
discounts
surcharges
tax
total
currency
```

This ensures historical prices remain reproducible.

---

# 24. Pricing Transparency

Customers should understand the final amount.

Example:

```text
Cleaning
€100

Add-ons
€20

Sunday surcharge
€25

Total
€145
```

The exact presentation depends on the pricing configuration.

---

# 25. Surcharges

The booking engine must support configured surcharges.

Initial concepts:

```text
Night
Sunday
Holiday
Emergency
```

The actual percentages/amounts come from the branch pricing configuration.

---

# 26. Discounts

Discounts should be modeled explicitly.

Possible future discount types:

```text
percentage
fixed_amount
promotion_code
recurring_customer
contract
campaign
```

Discounts must be validated server-side.

---

# 27. Taxes

Tax calculations should be performed by the financial/pricing layer according to the applicable configuration.

Bookings should preserve the resulting tax amount.

Historical bookings must not be recalculated using future tax rules.

---

# 28. Booking Number

Every confirmed booking should have a human-readable booking number.

Example:

```text
CLN-2026-000123
```

The UUID remains the internal identifier.

---

# 29. Booking Status

Initial booking states:

```text
draft
pending
confirmed
assigned
in_progress
completed
cancelled
no_show
```

The state machine must define valid transitions.

---

# 30. State Machine

Conceptually:

```text
draft
  ↓
pending
  ↓
confirmed
  ↓
assigned
  ↓
in_progress
  ↓
completed
```

Cancellation may occur from permitted states:

```text
pending → cancelled
confirmed → cancelled
assigned → cancelled
```

The exact transition rules must be implemented explicitly.

---

# 31. Draft Booking

Draft bookings may exist temporarily during the booking process.

They must not be treated as confirmed revenue or operational work.

Draft records may have a limited lifecycle.

---

# 32. Pending Booking

Pending means the booking has been submitted but still requires a confirmation step or processing.

The exact use depends on the selected payment/confirmation model.

---

# 33. Confirmed Booking

Confirmed means:

* booking details validated
* price accepted
* required availability validated
* booking successfully created
* confirmation can be sent

A confirmed booking is an operational commitment.

---

# 34. Assigned Booking

Assigned means the corresponding job has one or more assigned cleaners.

The booking and job remain separate entities.

---

# 35. In Progress

In Progress means the cleaner has started the job.

This should normally be triggered by job check-in or an authorized operational action.

---

# 36. Completed

Completed means the service has been completed according to operational rules.

The system should preserve:

```text
actual start
actual end
completion notes
assigned cleaner(s)
```

---

# 37. Cancelled

Cancellation should record:

```text
cancelled_at
cancelled_by
cancellation_reason
```

The booking should not be deleted.

---

# 38. Cancellation Policy

Initial customer cancellation policy:

```text
24+ hours:
Free

12–24 hours:
25%

2–12 hours:
50%

Under 2 hours:
100%
```

Decision BD-2 (2026-09): the policy is **branch-scoped, configurable,
versioned, and effective-dated**. Each booking captures the applicable policy
snapshot at confirmation; later policy changes never retroactively modify an
existing confirmed booking. The tiers above are the documented default
content, with the confirmed interval reading:

```text
[24h, infinity) → 0%      (exactly 24h → 0%)
[12h, 24h)      → 25%     (exactly 12h → 25%)
[2h, 12h)       → 50%     (exactly 2h  → 50%)
[0h, 2h)        → 100%
```

Policy configuration changes must produce the documented
`cancellation_policy.updated` audit event (LEGAL_COMPLIANCE §71). The storage
model for branch policy versions is deferred to the Booking implementation
design.

---

# 39. Cancellation Calculation

Cancellation windows are calculated relative to the **scheduled service
START** (`scheduled_start`), never `scheduled_end` (decision BD-2.1). The
notice is `scheduled_start − cancellation_request_time`, computed on absolute
UTC instants and presented in the branch timezone. A customer cancellation is
**not permitted once the current time has reached `scheduled_start`**
(decision BD-2.5): the customer window ends at service start, the documented
post-start operational outcome is `no_show` (§78), and completed bookings are
never cancellable.

The cancellation fee is calculated from the booking's **immutable pricing
snapshot** (decision BD-2.2):

```text
cancellation_fee =
  applicable_policy_percentage
  × authoritative booking total (including applicable tax, excluding tips)
```

rounded half-up to the currency's minor unit (the Pricing Engine rounding
convention). The current Pricing Engine must never be invoked to recalculate
a historical booking; the confirmed booking's snapshot is authoritative.
Pricing owns creating and preserving the snapshot; Booking owns applying the
cancellation policy to it.

The server must calculate the final fee.

The customer cannot submit their own cancellation percentage.

---

# 40. Cancellation Exceptions

The system should allow future exceptions such as:

```text
branch cancellation
weather/safety event
service failure
administrative cancellation
force majeure
```

Authorized staff may override normal cancellation rules when justified.
Overrides must be audited.

Decision BD-2.4 (2026-09): waiving or reducing a calculated cancellation fee
requires the dedicated permission **`bookings.override`** — generic
`bookings.edit` / `bookings.cancel` do not authorize a fee override. In V1 it
is granted to **HQ Admin only** (the `pricing.override` precedent); HQ Staff,
Branch Managers, cleaners, and customers cannot override cancellation fees.
Every override must be audited, preserving at minimum: actor, timestamp,
booking, original calculated fee, final fee, and reason.

---

# 41. Recurring Booking

Recurring customers should be supported as an important business capability.

A recurring plan defines:

```text
frequency
start date
end date
service
preferred time
property details
add-ons
```

Examples:

```text
weekly
biweekly
monthly
```

---

# 42. Recurring Booking Generation

A recurring plan should generate normal bookings.

Conceptually:

```text
Recurring Plan
 ↓
Booking #1
 ↓
Booking #2
 ↓
Booking #3
...
```

Each generated booking has its own:

* status
* price snapshot
* job
* assignment
* payment state

---

# 43. Recurring Pricing

The system should support future recurring pricing policies.

Examples:

```text
standard recurring discount
contract pricing
fixed recurring price
```

The exact rules belong to the pricing system.

---

# 44. Customer Confirmation

After successful booking:

```text
Booking created
 ↓
Confirmation generated
 ↓
Email sent
 ↓
Management link generated
```

The customer should see:

* booking number
* service
* date
* time
* address summary
* total
* next steps

---

# 45. Magic Link

Customers receive a secure management link.

The link allows permitted actions such as:

* view booking
* view status
* view booking details
* cancel where allowed
* request changes where supported

The link must expire or otherwise use a secure session/token model.

---

# 46. Customer Booking Management

The customer management interface should allow:

```text
View booking
View service
View date/time
View address
View price
Cancel
Request change
Contact CLENQO
```

The exact editable fields depend on booking state.

---

# 47. Booking Modification

A customer should not be able to modify every field after confirmation.

Potentially editable:

```text
contact information
special instructions
requested time/date
```

depending on business rules.

Changes that affect:

* price
* availability
* service duration

must trigger server-side recalculation.

**Rescheduling scope (decision BD-3, 2026-09):** rescheduling — changing a
booking's scheduled interval after confirmation — is supported in V1 for both
customers (through the secure magic-link flow) and staff. A booking may be
rescheduled only while its status is `confirmed` or `assigned`; `pending`
bookings are edited through the normal re-confirmation flow instead, and
`in_progress`, `completed`, `cancelled`, and `no_show` bookings are never
reschedulable. Rescheduling keeps `booking_rescheduled` (§49) as an event —
there is no `rescheduled` booking state. Staff rescheduling on behalf of a
customer is exercised through the existing `bookings.edit` permission
(hq_admin, hq_staff, branch_manager); no dedicated reschedule permission
exists, and `bookings.override` remains exclusively the cancellation-fee
override authority (§40).

---

# 48. Booking Change Flow

Example:

```text
Customer requests new time
 ↓
Availability check
 ↓
Pricing recalculation if necessary
 ↓
Customer confirmation
 ↓
Booking updated
 ↓
Event created
 ↓
Notifications sent
```

**Rescheduling rules (decision BD-3, 2026-09):**

* **Request deadline:** a customer may request a reschedule only at least
  **2 hours before the current `scheduled_start`**; at/after
  `scheduled_start` customer action is prohibited (§39, decision BD-2.5)
  and the post-start operational outcome is `no_show` (§78). Staff
  rescheduling within the permitted states follows the same feasibility
  rules.
* **Target slot:** the NEW requested slot must satisfy the full scheduling
  rules as a fresh request, including the **24-hour minimum-notice rule**
  (`SCHEDULING_SYSTEM.md` S4) — same-day reschedule targets are not
  permitted. Operating hours, schedule exceptions, the 15-minute slot grid,
  capacity, and DST rules apply unchanged.
* **Frequency:** rescheduling is unlimited — there is no per-booking
  reschedule count limit; every occurrence independently re-runs the
  feasibility, notice, and state rules.
* **Fee:** rescheduling is **FREE**. The cancellation fee tiers (§38) are
  never applied to the reschedule operation itself, and no separate
  reschedule-fee policy exists in V1. After a successful reschedule the
  cancellation window is evaluated from the **NEW `scheduled_start`**
  (decision BD-3.4b).
* **Pricing:** the new date/time is priced by the Pricing Engine as a fresh
  request (surcharge applicability, pricing version by the new service date)
  producing a NEW pricing snapshot. If the recalculated price is **higher**,
  the reschedule commits only after explicit customer acceptance of the new
  price; if it is **lower**, the lower price is automatically applied. The
  new snapshot becomes authoritative for the rescheduled booking, and the
  original snapshot is preserved as historical data (never deleted).
* **Transactional order and hold/idempotency mechanics** (temporary hold on
  the target slot, old-slot release sequencing, idempotency keys, exact
  event/audit payload) are technical design items **TD-3.1–TD-3.5**,
  deliberately deferred to the Booking implementation (Change 5) design;
  this section fixes business policy only.

---

# 49. Booking Events

Every important booking state change should create a booking event.

Examples:

```text
booking_created
booking_confirmed
booking_rescheduled
booking_cancelled
booking_assigned
booking_started
booking_completed
payment_received
```

Events provide operational history.

---

# 50. Event Metadata

Booking events may contain structured metadata:

```json
{
  "reason": "customer_request",
  "previous_time": "...",
  "new_time": "..."
}
```

Sensitive data must not be unnecessarily duplicated.

---

# 51. Job Creation

Once a booking becomes operationally confirmed, the system should create the corresponding job.

Conceptually:

```text
Confirmed Booking
      ↓
Create Job
      ↓
Find Available Cleaners
      ↓
Assignment
```

Job creation should be idempotent.

A booking must not generate duplicate jobs because of retries.

---

# 52. Worker Assignment

The booking system hands the operational job to the assignment engine.

The assignment engine considers:

* employee availability
* branch
* service skills
* working hours
* existing assignments
* location/travel where supported
* workload
* job duration

Assignment logic is defined in the workforce/scheduling domain.

---

# 53. Booking and Employee Separation

Customers book a service.

They do not select a specific cleaner by default.

The business determines assignment.

A future customer preference system may allow preferred cleaners.

---

# 54. Booking Notifications

Important events should trigger notifications.

Examples:

```text
booking confirmation
booking reminder
booking change
booking cancellation
cleaner assignment
payment confirmation
invoice
```

The notification system chooses:

* recipient
* locale
* channel
* template

---

# 55. Email First

Initial notification channel:

```text
Email
```

Future channels:

```text
WhatsApp
SMS
Push
```

The booking engine should not be tightly coupled to one notification provider.

---

# 56. WhatsApp Future Support

WhatsApp may be introduced later.

The booking domain should emit events independently of the notification channel.

Example:

```text
booking_confirmed
 ↓
Notification Engine
 ├── Email
 └── WhatsApp
```

---

# 57. Booking Reminders

Future reminders may be sent:

```text
24 hours before
2 hours before
```

The exact schedule should be configurable.

Reminder delivery should be idempotent.

---

# 58. Booking Source

Bookings should record their source.

Examples:

```text
website
dashboard
phone
admin
api
```

This supports analytics and operational reporting.

---

# 59. Booking Notes

Separate:

```text
customer_notes
internal_notes
```

Customer notes may be visible to cleaners when operationally necessary.

Internal notes must remain staff-only.

---

# 60. Booking Attachments

Customers may eventually provide photos or documents.

Attachments should:

* use Supabase Storage
* have ownership metadata
* be access-controlled
* be linked to the booking

Do not store file binaries directly in the booking table.

---

# 61. Booking Validation

Server-side validation must verify:

```text
branch exists
branch active
service exists
service active
variant valid
add-ons valid
address valid
date valid
time valid
availability valid
pricing valid
customer valid
```

---

# 62. Booking Confirmation Transaction

The critical confirmation process should be atomic where practical.

Conceptually:

```text
Validate request
 ↓
Validate branch/service
 ↓
Validate availability
 ↓
Calculate price
 ↓
Create/update customer
 ↓
Create booking
 ↓
Create booking items
 ↓
Create pricing snapshot
 ↓
Create booking event
 ↓
Create job
 ↓
Commit
```

Notification delivery should be handled safely after the transaction or through an event/outbox mechanism.

---

# 63. Idempotency

Booking creation must protect against duplicate submissions.

Examples:

* customer double-clicks button
* network retry
* browser retry
* server retry

The system should support an idempotency key or equivalent mechanism for critical requests.

---

# 64. Booking Number Uniqueness

Booking numbers must be unique.

Two simultaneous requests must never receive the same booking number.

Database constraints must enforce this.

---

# 65. Concurrency

The booking system must account for simultaneous requests.

Example:

```text
Customer A
selects 14:00

Customer B
selects 14:00
```

The final server-side availability check must ensure the system does not accept both if the operational capacity does not allow it.

---

# 66. Timezone Handling

Bookings must store the relevant timezone.

Example:

```text
scheduled_start
scheduled_end
timezone
```

Database timestamps remain UTC.

The customer sees local branch/service time.

---

# 67. Daylight Saving Time

The system must not assume that every day has the same UTC offset.

Timezone-aware date/time libraries and database types must be used.

This is particularly important for European branches.

---

# 68. Availability Buffers

The scheduling system may require buffers between jobs.

Examples:

```text
travel time
setup time
cleanup equipment
handover
```

Buffers should be configuration-driven.

---

# 69. Service Duration

Duration may be calculated from:

```text
service
property factors
difficulty
add-ons
```

The booking engine should use the pricing/scheduling domain rather than hardcoded frontend estimates.

---

# 70. Emergency Booking

Emergency bookings may be supported through configured rules.

Example:

```text
same-day booking
```

may trigger an emergency surcharge.

The availability engine must still determine whether the service can actually be fulfilled.

---

# 71. Night Bookings

Night service may trigger a configured surcharge.

The pricing engine determines the amount.

The booking system validates whether night bookings are operationally allowed.

---

# 72. Sunday and Holiday Bookings

Sunday and holiday rules should be configuration-driven.

The booking system should know:

```text
whether the branch accepts bookings
```

and:

```text
whether a surcharge applies
```

These are separate decisions.

---

# 73. Booking Dashboard

The admin dashboard should provide:

```text
Bookings
├── All
├── Pending
├── Confirmed
├── Assigned
├── In Progress
├── Completed
├── Cancelled
└── No Show
```

Filters:

* branch
* date
* service
* cleaner
* customer
* status

---

# 74. Booking Detail

Admin booking detail should show:

```text
Booking number
Customer
Service
Address
Date/time
Price
Items
Status
Cleaner(s)
Notes
Events
Payments
Invoice
```

Sensitive information should be permission-controlled.

---

# 75. Booking Search

Search should support:

* booking number
* customer name
* email
* phone
* address where appropriate

Search must remain branch-scoped for users without global access.

---

# 76. Booking Calendar

The dashboard should eventually provide a calendar view.

Possible views:

```text
day
week
month
```

Operational users should primarily use day/week views.

---

# 77. Booking and Calendar Separation

The booking record stores the customer's transaction.

The scheduling system determines operational allocation.

Do not make the booking table responsible for all calendar logic.

---

# 78. No-Show

A no-show is an operational outcome.

It should be recorded explicitly:

```text
status = no_show
```

with:

```text
reason
reported_by
created_at
```

where required.

---

# 79. Completion

Completion should occur only through an authorized operational action.

Possible requirements:

* cleaner check-out
* required checklist completion
* completion notes
* required photos where configured

---

# 80. Review Trigger

After successful completion, the system may trigger a review request.

Conceptually:

```text
Job Completed
 ↓
Booking Completed
 ↓
Review Request
```

The review system handles the actual review.

---

# 81. Payment Timing

The initial platform should support payment timing according to branch configuration.

Examples:

```text
after completion
at booking
invoice
```

The booking system should not assume one payment strategy forever.

---

# 82. Payment Integration

Payment processing is handled by the payment domain.

The booking system consumes payment state.

Example:

```text
Payment
 ↓
paid
 ↓
Booking/payment state updated
```

---

# 83. Booking Cancellation and Payment

If a booking is cancelled after payment:

```text
Cancellation policy
 ↓
Refund calculation
 ↓
Payment domain
 ↓
Refund
```

The booking domain determines the business outcome.

The payment domain performs the provider transaction.

For a booking cancelled **before any payment** (the V1 default is payment
after completion), a non-zero cancellation fee becomes an **amount owed by
the customer** (decision BD-2.6). The booking domain records the obligation;
the collection mechanism (provider charge, invoice, manual payment, or
another explicitly defined flow) belongs to the Payment domain and is
intentionally not fixed here.

---

# 84. Invoice Integration

If the booking requires an invoice:

```text
Booking
 ↓
Invoice
```

The invoice remains a separate financial record.

---

# 85. Booking Privacy

Customer booking data is sensitive.

Access must be controlled according to:

* role
* branch
* customer ownership
* operational necessity

---

# 86. Booking Auditability

Important booking changes should create:

```text
booking_event
+
audit_log
```

where appropriate.

For example:

```text
Admin changes booking price
```

must be traceable.

---

# 87. Booking Errors

Customer-facing errors should be understandable.

Example:

```text
This time is no longer available.
Please choose another time.
```

Avoid exposing:

```text
PostgreSQL constraint violation
```

to customers.

---

# 88. Operational Failure

If a booking is successfully stored but notification delivery fails:

```text
Booking remains valid.
Notification retries separately.
```

Do not roll back a valid booking merely because an email provider temporarily failed.

---

# 89. Booking Reliability

Critical operations should be designed to tolerate:

* network failures
* retries
* duplicate requests
* provider failures
* delayed notifications
* partial external failures

---

# 90. Booking Analytics

The booking system should provide data for metrics such as:

```text
booking conversion
cancellation rate
average booking value
repeat booking rate
service popularity
branch performance
lead source
```

Analytics should consume booking events rather than altering the booking model unnecessarily.

---

# 91. Booking MVP

Initial implementation should support:

```text
Branch selection/context
Service selection
Service variants
Add-ons
Property details
Address
Date/time
Availability validation
Pricing integration
Customer information
Booking creation
Booking number
Confirmation
Magic link
Booking cancellation
Booking events
Job creation
Basic cleaner assignment
```

---

# 92. Future Booking Features

Possible additions:

* recurring booking management
* customer preferences
* preferred cleaner
* waitlists
* rescheduling automation (automated/suggested rebooking flows — manual
  customer and staff rescheduling is V1 per decision BD-3; only the
  automation layer is future)
* advanced capacity planning
* quote requests
* contracts
* commercial recurring agreements
* subscription cleaning plans
* AI-assisted scheduling

---

# 93. Booking Domain Boundary

The booking system owns:

```text
booking lifecycle
customer booking interaction
booking items
booking state
booking events
booking changes
booking confirmation
```

It does not own:

```text
authentication
price-rule implementation
employee scheduling algorithm
payment provider implementation
email delivery
accounting
```

Those remain separate domains.

---

# 94. Booking Flow Summary

The complete flow is:

```text
Customer
 ↓
Branch Website
 ↓
Service
 ↓
Details
 ↓
Address
 ↓
Date/Time
 ↓
Availability
 ↓
Pricing
 ↓
Customer Information
 ↓
Review
 ↓
Confirm
 ↓
Booking
 ↓
Booking Event
 ↓
Job
 ↓
Assignment
 ↓
Cleaning
 ↓
Completion
 ↓
Payment / Invoice
 ↓
Review
```

---

# 95. Golden Booking Rule

> **Every confirmed CLENQO booking must represent a validated, reproducible, branch-scoped business transaction with a clear price, time, customer, service, lifecycle, operational job, and auditable history.**
