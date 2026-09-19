# CLENQO — System Requirements

> **Clean Spaces. Better Living.**

## 1. Purpose

This document defines the functional and high-level non-functional requirements for the CLENQO platform.

It describes what the system must be capable of doing without prescribing every implementation detail.

Detailed technical architecture is defined in:

```text
docs/ARCHITECTURE.md
```

Detailed business rules are defined in the relevant domain documents.

OpenSpec specifications will translate major requirements into implementation-ready specifications.

---

# 2. Product Scope

CLENQO consists of the following major system areas:

```text
CLENQO
│
├── HQ Administration
├── Branch Management
├── Branch Website System
├── Customer Experience
├── Booking System
├── Pricing Engine
├── Service Management
├── Employee/Cleaner System
├── Scheduling & Assignment
├── Payments
├── Invoicing
├── Notifications
├── Reviews & Quality
├── Reporting & Analytics
├── Authentication & Authorization
├── Localization
└── Platform Administration
```

---

# 3. User Types

The system must support distinct user types and permission scopes.

## 3.1 HQ Administrator

Global CLENQO administrator.

Can manage the entire organization and all branches.

## 3.2 HQ Staff

Optional internal staff with configurable permissions.

May have access to selected areas without having unrestricted administrative access.

## 3.3 Branch Manager

Responsible for day-to-day operation of one or more assigned branches.

## 3.4 Cleaner / Employee

Responsible for completing assigned cleaning jobs.

## 3.5 Customer

Books and manages cleaning services.

## 3.6 System/Automation

Internal automated processes that perform scheduled or event-driven operations.

---

# 4. Organization Requirements

The platform must support a central CLENQO organization.

The organization represents the overall CLENQO business.

It must contain:

* Organization identity
* Global configuration
* Global branding
* Global services
* Global defaults
* Branches
* Users
* Organization-level settings

The initial architecture must not assume multiple organizations unless this is later required.

---

# 5. Branch Requirements

## BR-001 — Branch Creation

HQ administrators must be able to create a branch.

A branch should contain at minimum:

* Name
* Slug
* Country
* City
* Address
* Contact information
* Status
* Service area
* Opening hours
* Manager assignment

---

## BR-002 — Branch Status

A branch must have an explicit lifecycle/status.

Initial statuses may include:

```text
DRAFT
ACTIVE
PAUSED
SUSPENDED
CLOSED
```

Exact states will be finalized in the branch specification.

---

## BR-003 — Branch Configuration

HQ must be able to configure branch-specific:

* Business information
* Contact details
* Service area
* Opening hours
* Services
* Pricing
* Booking settings
* Notification settings
* Website content
* Local promotions

---

## BR-004 — Branch Isolation

Branch operational data must be isolated.

A branch user must only access data permitted for their branch scope.

---

## BR-005 — Branch Manager Assignment

HQ administrators must be able to assign one or more authorized users as branch managers.

---

## BR-006 — Branch Activation

A branch should not become publicly bookable until required configuration is complete.

The system should validate required configuration before activation.

---

# 6. Automatic Branch Provisioning

## BP-001 — Automatic Provisioning

When HQ creates a branch, the system must be capable of provisioning the branch's initial digital environment.

Provisioning should include, where applicable:

* Branch configuration
* Website configuration
* Default website pages
* Default services
* Pricing configuration
* Booking configuration
* Dashboard context
* Notification configuration

---

## BP-002 — Provisioning Safety

Provisioning must be:

* Deterministic
* Validated
* Auditable
* Safe to retry

Partial failures must be detectable and recoverable.

---

## BP-003 — No Duplicated Code

Creating a branch must not create a new application or duplicated frontend codebase.

All branches use the central CLENQO platform.

---

# 7. Website Requirements

## WS-001 — Master Website

CLENQO must provide a reusable master website system.

The system must support:

* Reusable page structures
* Reusable components
* Global design system
* Localized content
* Branch-specific configuration

---

## WS-002 — Branch Website

Each active branch must be capable of having a localized public website experience.

The website should include:

* Homepage
* Services
* Pricing
* About
* FAQ
* Contact
* Reviews
* Booking entry point

The exact page structure may evolve.

---

## WS-003 — Branch Localization

Branch websites must display the appropriate:

* Branch name
* Location
* Contact information
* Service area
* Services
* Pricing
* Opening hours
* Local content
* Local reviews

---

## WS-004 — SEO

Branch websites must support localized SEO.

The system should support:

* Unique page titles
* Meta descriptions
* Canonical URLs
* Structured data
* Local business information
* Sitemap generation
* Search-engine-friendly URLs

---

## WS-005 — Responsive Design

Public websites must work across:

* Mobile
* Tablet
* Desktop

---

# 8. Localization Requirements

CLENQO must be multilingual from the beginning.

Initial languages:

```text
de — German
en — English
fr — French
es — Spanish
```

The architecture must allow additional languages to be added later.

---

## LO-001 — Interface Localization

Relevant user interfaces must support the configured languages.

---

## LO-002 — Content Localization

Content should be capable of having localized versions rather than relying entirely on machine translation at runtime.

---

## LO-003 — User Language Preference

Where appropriate, the system should remember the user's preferred language.

---

## LO-004 — Communication Localization

Customer-facing communications should use the customer's selected/preferred language where available.

This may include:

* Emails
* Booking confirmations
* Reminders
* Cancellation notices
* Payment messages
* Review requests

---

# 9. Service Requirements

## SV-001 — Service Catalog

CLENQO must maintain a structured service catalog.

Initial service categories may include:

* Home Cleaning
* Business Cleaning
* Deep Cleaning
* Move-In / Move-Out Cleaning

---

## SV-002 — Service Variants

Services may contain sub-services or variants.

Examples:

```text
Home Cleaning
├── Regular Cleaning
├── Deep Cleaning
├── Recurring Cleaning
└── Eco-Friendly Cleaning

Move-In / Move-Out
├── Move-In
└── Move-Out
```

---

## SV-003 — Add-ons

The system must support optional add-ons.

Examples:

* Oven cleaning
* Refrigerator cleaning
* Window cleaning
* Interior cabinets
* Laundry
* Other approved additional services

---

## SV-004 — Branch Availability

Services must be capable of being enabled or disabled for individual branches.

---

# 10. Pricing Requirements

## PR-001 — Pricing Engine

CLENQO must have a dedicated pricing engine.

Pricing must not be duplicated across UI components.

---

## PR-002 — Pricing Inputs

The pricing engine should be capable of considering:

* Service type
* Property characteristics
* Estimated duration
* Difficulty
* Add-ons
* Recurrence
* Surcharges
* Discounts
* Branch pricing configuration

---

## PR-003 — Difficulty

The system should support configurable difficulty classifications.

Initial conceptual levels:

```text
LIGHT
MEDIUM
HEAVY
```

Difficulty multipliers must be configurable rather than hardcoded permanently.

---

## PR-004 — Surcharges

The pricing system should support configurable surcharges such as:

* Night
* Sunday
* Holiday
* Emergency

Exact rates belong in the pricing specification.

---

## PR-005 — Pricing Profiles

Branches should be able to use:

```text
Global Default Pricing
```

or:

```text
Custom Branch Pricing
```

subject to HQ permissions.

**Decision (P12, Change 4A):** pricing is **branch-owned** in V1 — every
branch has its own pricing profile(s). "Global Default Pricing" is realized
as an idempotent, structure-only per-branch seed template applied at
provisioning (`seedPricingDefaults`), not as organization-global pricing
data. At most one active published profile per branch in V1 (P11); no
production money values are seeded (P3).

---

## PR-006 — Price Transparency

Customers should receive a clear price or price estimate before booking confirmation whenever the service supports deterministic online pricing.

---

# 11. Booking Requirements

## BK-001 — Online Booking

Customers must be able to create bookings online.

---

## BK-002 — No Mandatory Customer Account

Customers must not be required to create a traditional account to make an initial booking.

---

## BK-003 — Booking Information

The booking flow should collect the information necessary to:

* Identify the customer
* Determine the service
* Determine the property requirements
* Calculate pricing
* Determine availability
* Deliver the service
* Communicate with the customer

---

## BK-004 — Date and Time

Customers must be able to select available service dates and time windows.

The system must prevent invalid or conflicting bookings.

---

## BK-005 — Instant Pricing

Where sufficient information is available, the system should calculate the price before the customer confirms the booking.

> **Implemented (Change 5):** instant pricing comes from the Pricing Engine
> quote; the confirmation transaction recalculates authoritatively and
> compares against the customer-accepted total (TD-2: a mismatch rejects with
> `PRICE_CHANGED`, the hold stays within TTL, the customer re-accepts).

---

## BK-006 — Booking Confirmation

After a successful booking, the customer should receive confirmation.

> **Implemented (Change 5):** confirmation is a single server-authoritative
> transaction (catalog gate → service-area gate → slot hold → final
> feasibility re-check → hold consumption → booking + item snapshots +
> pricing snapshot + cancellation-policy snapshot + events + audit +
> outbox + idempotency result). A confirmation email is enqueued
> transactionally to the notification outbox (delivery is the Notification
> change). Failure rolls back completely and leaves no persisted booking
> (BD-1).

---

## BK-007 — Booking Management

Customers must be able to manage bookings using secure magic links.

Supported operations:

* View
* Reschedule (V1 capability per decision BD-3: permitted while the booking
  status is `confirmed` or `assigned`; requests must be made at least 2 hours
  before the current scheduled start; the new slot must satisfy the 24-hour
  minimum-notice rule; rescheduling is free and unlimited; price increases
  require explicit customer acceptance, price decreases apply automatically —
  normative rules in `BOOKING_SYSTEM.md` §47–48)
* Cancel
* View details
* Rebook

Permissions depend on booking status and applicable policies. Magic-link
security requirements are defined in `SECURITY_PRIVACY.md` §29–33 and
`DATABASE.md` §41; the concrete session mechanism remains a technical
design decision for the Booking implementation.

---

# 12. Booking Lifecycle

Bookings must use explicit states.

The initial lifecycle should support concepts such as:

```text
DRAFT
PENDING
CONFIRMED
ASSIGNED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW
```

The exact transition rules will be defined in `BOOKING_SYSTEM.md`.

Invalid state transitions must be prevented.

---

# 13. Recurring Bookings

The system must eventually support recurring cleaning.

Potential frequencies:

* Weekly
* Every two weeks
* Monthly
* Custom recurring schedule

Recurring bookings must generate or manage future service occurrences safely.

---

# 14. Cancellation Requirements

The booking system must support cancellation policies.

The policy should be configurable and capable of considering the time remaining before the booking.

The initial business policy may support different cancellation charges based on cancellation timing.

Exact values are defined in `BOOKING_SYSTEM.md` §38–40 (owner decision BD-2,
2026-09): branch-configurable versioned/effective-dated policy snapshotted at
booking confirmation; windows measured to the scheduled service START; the
fee derives from the booking's immutable pricing snapshot (tax included,
tips excluded, half-up minor-unit rounding); fee overrides require the
dedicated `bookings.override` permission (HQ Admin only in V1) and are
audited; customer cancellation is not permitted at/after the scheduled
start; a non-zero fee on an unpaid cancelled booking becomes an amount owed
by the customer.

---

# 15. Customer Requirements

## CU-001 — Customer Record

The system must maintain customer records necessary for service delivery.

---

## CU-002 — Customer History

Authorized staff should be able to view relevant customer booking history.

---

## CU-003 — Customer Privacy

Customer information must only be accessible to authorized users.

---

## CU-004 — Rebooking

Customers should have a simple path to book the same or similar service again.

---

# 16. Employee Requirements

## EM-001 — Employee Records

The system must support employee records including:

* Name
* Contact information
* Branch assignment
* Employment status
* Availability
* Skills where required
* Operational metadata

---

## EM-002 — Employee Status

Employee availability/status must be explicit.

Potential statuses:

```text
ACTIVE
INACTIVE
ON_LEAVE
SUSPENDED
```

---

## EM-003 — Branch Assignment

Employees must be associated with one or more authorized branches according to business rules.

---

# 17. Cleaner PWA Requirements

The cleaner experience must be mobile-first.

It should provide:

* Authentication
* Today's jobs
* Upcoming jobs
* Job details
* Customer information
* Service requirements
* Cleaning checklist
* Check-in
* Check-out
* Job notes
* Photo upload
* Incident reporting
* Completion status

> **Resolved (BD-C1…BD-C9 — Change 7 decision record, 2026-09):** the Cleaner
> PWA requirement list above is confirmed with these boundaries: minimized
> customer data only (first name, last initial, phone, address, execution
> instructions — BD-C1); `en_route` included (BD-C2); service-defined checklist
> copied into an immutable job snapshot at execution start (BD-C3); photos
> limited to before/after/incident-evidence, private and job-scoped (BD-C4);
> lightweight offline action queue for idempotent execution actions (BD-C5);
> **no GPS/location capture** (BD-C6); **in-app** notification surface only,
> no delivery (BD-C7); **customer signature deferred** to a future
> Quality/Booking decision (BD-C8); completion gated on check-in + mandatory
> checklist + no unresolved high/critical incident, with audited manager
> override (BD-C9). **Implemented (Change 7, `create-cleaner-pwa`):** the
> execution surface is live under `/cleaner` on migration
> `0013_cleaner_execution.sql` with the BD-C boundaries enforced in code,
> RLS, and tests.

---

# 18. Scheduling Requirements

The platform must support operational scheduling.

Scheduling must consider:

* Booking date
* Booking time/window
* Employee availability
* Employee working hours
* Branch
* Service requirements
* Existing assignments

Scheduling guarantees (normative details in `SCHEDULING_SYSTEM.md` §84–86):

* Availability is calculated server-side and is authoritative; client-side
  availability data is informational only.
* Booking confirmation must perform a final concurrency-safe availability
  re-check before committing.
* Temporary slot holds are the single V1 temporary reservation mechanism
  (`SCHEDULING_SYSTEM.md` §84); booking drafts do not block capacity.
* DST handling must be deterministic (spring-forward nonexistent times
  rejected/skipped; fall-back ambiguity resolved to the first occurrence).

Future versions may additionally consider:

* Travel time
* Distance
* Skills
* Workload balancing

---

# 19. Worker Assignment Requirements

The system must support assigning employees to jobs.

Assignment may initially be manual.

The architecture must allow future automated assignment.

Potential factors include:

```text
Branch
Service area
Availability
Working hours
Skills
Job duration
Existing schedule
Travel distance
Employee workload
```

---

# 20. Job Execution Requirements

A booking may produce an operational job.

A job should support:

* Assigned employee(s)
* Scheduled time
* Service details
* Customer information
* Checklist
* Status
* Notes
* Photos
* Check-in time
* Check-out time
* Completion information

---

# 21. Quality Requirements

CLENQO should support quality management.

Potential capabilities include:

* Cleaning checklists
* Customer ratings
* Reviews
* Complaint records
* Re-clean requests
* Incident reports
* Before/after photos
* Quality review

---

# 22. Review Requirements

Customers should be able to leave reviews after completed services.

The system should support:

* Rating
* Optional written review
* Booking association
* Branch association
* Moderation
* Publication status

---

# 23. Payment Requirements

The platform must support secure payment workflows.

Potential payment methods include:

* Credit/debit card
* PayPal
* SEPA
* Apple Pay
* Google Pay
* Bank transfer
* Approved cash payments

Available payment methods may vary by branch and business policy.

---

# 24. Payment Security

The application must never trust payment status supplied by the browser.

Payment state must be confirmed through trusted server-side mechanisms and provider events.

Financial records must be auditable.

---

# 25. Invoicing Requirements

The system should support:

* Customer invoices
* Receipts
* Invoice status
* Payment association
* Refund records
* Invoice numbering
* Branch association

---

# 26. Notification Requirements

The platform must support event-driven notifications.

Potential events include:

```text
Booking Created
Booking Confirmed
Booking Rescheduled
Booking Cancelled
Booking Assigned
Booking Reminder
Cleaner Check-In
Job Completed
Payment Received
Payment Failed
Review Request
```

Initial communication channel:

```text
Email
```

Future channel:

```text
WhatsApp
```

---

# 27. Notification Preferences

Where appropriate, customers and employees should be able to have notification preferences.

The system must respect applicable communication and consent requirements.

---

# 28. HQ Dashboard Requirements

HQ should have a centralized dashboard providing visibility across the organization.

Potential dashboard information:

* Total bookings
* Revenue
* Active branches
* Active employees
* Customers
* Operational alerts
* Booking status
* Branch performance
* Payment status
* Quality metrics

---

> **Resolved (BD-A2/BD-A3 — Change 8 decision record):** the V1 Control Center
> `/admin` provides an operational dashboard (branch overview,
> lifecycle/provisioning state and failures, operational counts, quick
> actions, permission-aware navigation — ADMIN_SYSTEM §3 record) rather than
> analytics metrics, which remain a Reporting-change capability. HQ Admin and
> HQ Staff share the same shell at organization scope; **Branch Managers use
> the same shell with branch context fixed by their `membership_branches`
> scope** — they see only their authorized branches, with the branch selector
> enumerating exactly those branches and the dashboard scoped accordingly;
> multi-branch managers may switch between their own branches. Cleaners never
> enter `/admin` (their surface remains `/cleaner/*`). No new permissions are
> introduced; the canonical catalog (SECURITY §14) governs navigation
> visibility.

# 29. Branch Dashboard Requirements

Branch managers should have a branch-specific dashboard.

It should provide visibility into:

* Today's bookings
* Upcoming bookings
* Employees
* Schedule
* Customers
* Revenue
* Operational issues
* Reviews
* Branch performance

> **Partially implemented (Changes 8/9):** Branch Managers use the Change 8
> shell with branch context fixed to their `membership_branches`. Change 9
> (`create-booking-admin-ui`) adds the branch-scoped Bookings module
> (status filtering, search per §36 customer/booking targets) and the
> Customers module (detail + `customers.edit` editing). Employees/jobs are
> reached through the existing `/admin/employees` and `/admin/jobs` pages.
> Change 10 (`create-config-admin-ui`) adds the configuration modules:
> `/admin/services` (catalog administration), `/admin/pricing` (profiles,
> versions, draft-only rules, publish/archive, quote sanity), and
> `/admin/scheduling` (config, operating hours, exceptions, service rules —
> mutations HQ-Admin-only via the existing `branches.edit`, BD-E3b).
> Today/upcoming grouping, schedule views, revenue, operational issues, and
> reviews remain their own future changes (Reporting/Reviews/Notifications).

---

# 30. Branch Management Requirements

HQ must be able to:

* Create branches
* Edit branches
* Activate branches
* Pause branches
* Close branches
* Assign managers
* Configure service areas
* Configure services
* Configure pricing
* Manage branch website configuration
* View branch performance

---

# 31. Content Management Requirements

CLENQO must support centralized and branch-specific content.

Content should distinguish between:

```text
GLOBAL CONTENT
```

and:

```text
BRANCH CONTENT
```

Examples of global content:

* Brand information
* Core company pages
* Global policies

Examples of branch content:

* Local introduction
* Local service area
* Local contact information
* Local reviews
* Local promotions

---

> **Resolved (BD-A1 — Change 8 decision record):** the first HQ Admin is
> bootstrapped through a one-time `/setup` flow permitted only while zero
> active `hq_admin` memberships exist, protected by a deployment-held
> one-time `SETUP_TOKEN`, permanently disabled after bootstrap (fails closed,
> attempt audited), with a CLI/script fallback under the same invariant;
> authentication remains Supabase Auth exclusively (SECURITY §14 record for
> the full contract). Invitations use the Supabase Auth admin invite
> primitive gated by `users.invite`. **Implemented (Change 8,
> `create-admin-foundation`):** `/setup`, `/login`, session middleware, the
> protected `(admin)` shell + `/admin` dashboard, invitation/deactivation,
> and BD-A4 advisory readiness with audited override shipped behind the
> existing canonical permissions; no new permissions or roles were added.

# 32. Authentication Requirements

The system must support secure authentication for:

* HQ users
* Branch managers
* Employees

Customer booking access may use secure magic-link mechanisms.

Authentication must support secure session management.

---

# 33. Authorization Requirements

Permissions must be role- and scope-aware.

The system must support:

```text
Global permissions
Branch permissions
Resource permissions
```

Authorization must be enforced server-side.

---

# 34. Security Requirements

The platform must implement:

* Row Level Security
* Server-side authorization
* Input validation
* Secure authentication
* Secure token handling
* Secret management
* Audit logging for critical operations
* Protection against unauthorized branch access

---

# 35. Localization Requirements

The platform must support:

```text
German
English
French
Spanish
```

Localization must be designed as an extensible system.

---

# 36. Search Requirements

Relevant administrative interfaces should support search.

Potential search targets:

* Customers
* Bookings
* Employees
* Branches
* Invoices
* Reviews

Large datasets should use appropriate indexing and pagination.

---

# 37. Reporting Requirements

The system should provide reporting for:

### Branches

* Revenue
* Bookings
* Customers
* Employee utilization
* Completion rate
* Ratings

### HQ

* Branch comparison
* Network revenue
* Growth
* Customer retention
* Operational performance
* Financial performance

---

# 38. Analytics Requirements

The platform should track meaningful operational events.

Examples:

```text
Website Visit
Service Viewed
Booking Started
Booking Completed
Booking Cancelled
Payment Completed
Job Completed
Review Submitted
Rebooking
```

Analytics must respect privacy requirements.

---

# 39. Audit Requirements

Critical actions should be auditable.

Examples:

* Branch creation
* Branch activation
* Price changes
* Permission changes
* Booking changes
* Payment actions
* Refunds
* Employee changes

---

# 40. Performance Requirements

The platform should provide a fast user experience.

Priorities include:

* Fast public pages
* Fast booking flow
* Efficient database queries
* Appropriate indexing
* Pagination
* Optimized assets
* Minimal unnecessary client-side JavaScript

---

# 41. Accessibility Requirements

The platform should support accessible interfaces.

Requirements include:

* Semantic HTML
* Keyboard accessibility
* Accessible forms
* Visible focus states
* Appropriate labels
* Adequate contrast
* Reduced-motion support

---

# 42. Mobile Requirements

The following experiences must be highly usable on mobile:

1. Customer website
2. Customer booking
3. Customer booking management
4. Cleaner PWA

Administrative interfaces should also provide responsive layouts where practical.

---

# 43. GDPR / Privacy Requirements

The system must be designed to support applicable privacy obligations, including GDPR where applicable.

Requirements include:

* Data minimization
* Access control
* Appropriate retention
* Secure handling
* Privacy-aware analytics
* Appropriate customer data management
* Data export/deletion workflows where legally required

Detailed legal requirements should be reviewed separately with appropriate professional advice.

---

# 44. Reliability Requirements

Critical operations should be designed for reliability.

Important workflows should handle:

* Network failures
* Duplicate requests
* Retry behavior
* Partial failures
* Provider failures
* Database errors

Financial and booking operations require particular care against duplicate processing.

---

# 45. Observability Requirements

Production systems should provide visibility into:

* Application errors
* Booking failures
* Payment failures
* Notification failures
* Provisioning failures
* Authentication failures
* Critical database errors

---

# 46. Extensibility Requirements

The architecture must allow future capabilities without requiring fundamental redesign.

Potential future areas:

* AI assistance
* Route optimization
* Advanced scheduling
* WhatsApp
* Additional languages
* Additional payment providers
* Additional service categories
* Additional countries
* Franchise/partner branches
* White-label operations software

Future capabilities should not unnecessarily complicate the initial system.

---

# 47. Non-Functional Priorities

When requirements compete, prioritize:

```text
1. Security
2. Business correctness
3. Reliability
4. User experience
5. Maintainability
6. Performance
7. Scalability
8. Development speed
```

Technology choices must serve these priorities.

---

# 48. MVP Scope

The first production milestone should focus on the smallest complete operational foundation.

### MVP Foundation

```text
✓ Authentication
✓ Roles & permissions
✓ Multi-branch architecture
✓ HQ branch management
✓ Branch creation
✓ Branch configuration
✓ Automatic branch provisioning
✓ Master website system
✓ Branch website
✓ Basic services
✓ Basic pricing
✓ Booking
✓ Customer confirmation
✓ Branch dashboard
```

The following should come after the foundation:

```text
→ Cleaner PWA
→ Advanced assignment
→ Recurring bookings
→ Payments
→ Invoicing
→ Notifications
→ Quality management
→ Analytics
→ Automation
```

This ordering may be refined through OpenSpec.

---

# 49. Future Expansion

The platform should eventually support:

```text
Multiple branches
        ↓
Multiple cities
        ↓
Multiple regions
        ↓
Potential international expansion
```

The architecture must not hardcode assumptions that prevent geographic expansion.

---

# 50. Requirement Traceability

Major requirements should eventually map to:

```text
Requirement
    ↓
Domain Documentation
    ↓
OpenSpec Specification
    ↓
Implementation
    ↓
Tests
```

Each major implemented capability should be traceable back to an explicit requirement.

---

# 51. Current Priority

The immediate priority is not to implement every requirement in this document.

The immediate priority is to establish the foundation:

```text
CLENQO Organization
        ↓
Multi-Branch System
        ↓
HQ Administration
        ↓
Branch Creation
        ↓
Automatic Provisioning
        ↓
Branch Website
        ↓
Branch Dashboard
```

Once this foundation is verified, subsequent systems can be implemented on top of it in controlled OpenSpec changes.
