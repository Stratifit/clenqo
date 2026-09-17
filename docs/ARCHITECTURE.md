# CLENQO — System Architecture

> **Clean Spaces. Better Living.**

## 1. Purpose

This document defines the technical architecture of the CLENQO platform.

It establishes the boundaries between:

* Public website
* Booking system
* Customer experience
* Cleaner application
* Branch operations
* HQ administration
* Business logic
* Database
* Authentication
* Authorization
* Integrations
* Automation

The architecture is designed for a **single centralized, multi-branch platform**.

---

# 2. Architectural Objective

The primary architectural objective is:

> Build one CLENQO platform capable of operating multiple branches, where each branch automatically receives a localized website and operational workspace without creating a separate application or codebase.

The architecture must support growth from:

```text
1 Branch
   ↓
5 Branches
   ↓
20 Branches
   ↓
100+ Branches
```

without fundamental architectural restructuring.

---

# 3. Architectural Model

CLENQO will initially use a **modular monolith** architecture.

This means:

* One primary application
* One primary codebase
* Clearly separated domains/modules
* Centralized database
* Shared infrastructure
* Explicit domain boundaries

We will not prematurely split the system into microservices.

Conceptually:

```text
                         CLENQO PLATFORM
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
             Frontend                      Backend
                 │                             │
             Next.js                    Application Layer
                 │                             │
                 │                    ┌────────┴────────┐
                 │                    │                 │
                 │                 Domains          Data Access
                 │                    │                 │
                 │                    └────────┬────────┘
                 │                             │
                 │                         Supabase
                 │                             │
                 │                        PostgreSQL
                 │
                 └───────────────┬─────────────────────
                                 │
                            External Services
```

---

# 4. Technology Stack

## 4.1 Frontend

Primary frontend framework:

* Next.js 16
* React 19
* TypeScript

UI:

* Tailwind CSS
* shadcn/ui

Animation:

* GSAP where appropriate

---

## 4.2 Backend

Primary backend platform:

* Supabase

Services:

* PostgreSQL
* Authentication
* Storage
* Row Level Security
* Edge Functions where appropriate

---

## 4.3 Validation

Application validation:

* Zod

Form handling:

* React Hook Form

---

## 4.4 Deployment

Application:

* Vercel

Database/backend:

* Supabase

Source control:

* GitHub

---

## 4.5 Email

Transactional email:

* Amazon SES

CLENQO will maintain its own email templates and notification logic.

---

## 4.6 Messaging

Initial:

* Email

Future:

* WhatsApp

Messaging providers must remain behind an abstraction so communication channels can evolve without rewriting business logic.

---

# 5. Application Surfaces

The CLENQO platform contains several user-facing surfaces.

```text
CLENQO
│
├── Public Website
│
├── Booking Experience
│
├── Customer Experience
│
├── Cleaner PWA
│
└── Admin Platform
    ├── HQ
    └── Branch
```

These are logical surfaces within one application architecture.

They are not independent codebases.

---

# 6. Public Website Architecture

The public website is generated from reusable components and branch configuration.

Conceptually:

```text
Master Website System
        │
        ├── Global Design System
        ├── Page Templates
        ├── Components
        └── Content Models
                │
                ↓
         Branch Configuration
                │
                ↓
          Localized Website
```

---

# 7. Branch Website Routing

The initial implementation should support branch-aware URLs.

Preferred initial pattern:

```text
clenqo.com/{branch-slug}
```

Examples:

```text
clenqo.com/berlin
clenqo.com/munich
clenqo.com/dresden
```

The architecture should remain capable of supporting custom domains or subdomains later.

Potential future patterns:

```text
berlin.clenqo.com
munich.clenqo.com
```

or:

```text
custom-domain.de
```

These are future capabilities and are not required for the initial implementation.

---

# 8. Branch Context

Every branch-aware request must establish a branch context.

Conceptually:

```text
Request
  ↓
Resolve Branch
  ↓
Validate Branch Status
  ↓
Establish Branch Context
  ↓
Load Branch Configuration
  ↓
Execute Request
```

Branch context must never be trusted solely from client-provided information.

---

# 9. Organization Model

CLENQO will initially operate as one organization.

Conceptually:

```text
Organization
    │
    ├── Global Configuration
    ├── Global Users
    └── Branches
          │
          ├── Branch A
          ├── Branch B
          └── Branch N
```

The database should nevertheless explicitly model the organization relationship so the system can evolve if required.

---

# 10. Multi-Branch Data Model

Branch-scoped resources should contain a branch relationship.

Examples:

```text
branches
customers
employees
services
pricing_profiles
bookings
jobs
reviews
invoices
```

Typical relationship:

```text
resource.branch_id
        ↓
branches.id
```

Global resources may remain organization-scoped when branch ownership is inappropriate.

---

# 11. Data Ownership

Every major data entity must have an explicit ownership model.

Possible scopes:

```text
GLOBAL
ORGANIZATION
BRANCH
USER
CUSTOMER
BOOKING
JOB
```

The ownership model determines authorization and data access.

---

# 12. Database Architecture

Primary database:

**PostgreSQL through Supabase.**

The database is the source of truth for persistent business state.

Application code must not maintain an independent authoritative copy of core business data.

---

# 13. Database Domains

The database should be organized conceptually around domains.

```text
Identity
│
├── users
├── profiles
└── memberships

Organization
│
├── organizations
└── branches

Website
│
├── websites
├── pages
├── sections
└── content

Services
│
├── services
├── service_variants
└── add_ons

Pricing
│
├── pricing_profiles
├── pricing_rules
└── surcharges

Customers
│
└── customers

Bookings
│
├── bookings
├── booking_items
└── booking_events

Workers
│
├── employees
├── availability
├── assignments
└── jobs

Payments
│
├── payments
├── refunds
└── invoices

Communication
│
├── notification_events
├── notification_deliveries
└── templates

Quality
│
├── reviews
├── incidents
└── quality_checks

Audit
│
└── audit_logs
```

The exact schema is defined later in:

```text
docs/DATABASE.md
```

---

# 14. Authentication Architecture

Supabase Auth will provide authentication for internal users.

Primary authenticated users:

* HQ administrators
* HQ staff
* Branch managers
* Cleaners

Customer access will initially use secure magic-link workflows rather than requiring traditional passwords.

Authentication answers:

> Who is this user?

Authorization answers:

> What is this user allowed to do?

These must remain separate concepts.

---

# 15. Authorization Architecture

Authorization will use a combination of:

* User identity
* Role
* Organization membership
* Branch membership
* Resource ownership
* Server-side authorization
* PostgreSQL RLS

Conceptually:

```text
Authenticated User
       ↓
Identity
       ↓
Role
       ↓
Organization Scope
       ↓
Branch Scope
       ↓
Resource Permission
       ↓
Authorized Action
```

---

# 16. Roles

Initial roles:

```text
HQ_ADMIN
HQ_STAFF
BRANCH_MANAGER
CLEANER
CUSTOMER
```

The exact permission matrix will be defined in:

```text
docs/ROLES_PERMISSIONS.md
```

---

# 17. Row Level Security

RLS is mandatory for protected data.

The database must enforce appropriate access boundaries.

Example:

```text
Branch Manager
       ↓
Branch Membership
       ↓
RLS Policy
       ↓
Branch Records
```

A malicious client must not be able to bypass branch isolation by manipulating frontend requests.

---

# 18. Server-Side Business Logic

Critical business logic must execute in trusted server-side code.

Examples:

* Pricing
* Booking creation
* Booking state transitions
* Assignment
* Payment processing
* Refunds
* Permissions
* Branch provisioning

Client-side calculations may be used for previews and UX, but authoritative calculations must occur server-side.

---

# 19. Domain Architecture

Business domains should be isolated logically.

Initial domains:

```text
Identity
Organization
Branches
Website
Services
Pricing
Bookings
Customers
Workers
Scheduling
Payments
Notifications
Quality
Reporting
```

Each domain should own its business rules as much as practical.

---

# 20. Feature-Oriented Frontend Architecture

The frontend should favor feature/domain organization rather than putting all logic into generic folders.

Conceptual structure:

```text
src/
├── app/
├── components/
├── features/
│   ├── branches/
│   ├── bookings/
│   ├── customers/
│   ├── employees/
│   ├── pricing/
│   ├── services/
│   ├── payments/
│   └── reviews/
├── lib/
├── server/
└── ...
```

The exact structure will be refined during implementation.

---

# 21. UI Architecture

Reusable UI components should exist at multiple levels.

```text
Design Tokens
     ↓
UI Primitives
     ↓
Shared Components
     ↓
Feature Components
     ↓
Pages
```

Example:

```text
Button
 ↓
BookingButton
 ↓
BookingSummary
 ↓
BookingPage
```

---

# 22. Website Template Architecture

The website should use reusable templates.

Conceptually:

```text
Page
 ↓
Page Template
 ↓
Sections
 ↓
Components
 ↓
Content
```

Branch-specific content should be data-driven.

---

# 23. Website Section System

The website should support reusable sections such as:

```text
Hero
Trust
Services
Process
Benefits
Testimonials
Reviews
Pricing
FAQ
CTA
Footer
```

The section system should allow the master website design to evolve without duplicating branch code.

---

# 24. Branch Website Provisioning

Branch creation should trigger provisioning.

Conceptually:

```text
Create Branch
      ↓
Create Branch Configuration
      ↓
Create Website Configuration
      ↓
Create Default Pages
      ↓
Attach Default Sections
      ↓
Create Default Services
      ↓
Create Pricing Profile
      ↓
Create Booking Configuration
      ↓
Activate When Valid
```

Provisioning should be implemented as an explicit application/domain operation.

---

# 25. Provisioning Idempotency

Provisioning must be safe to retry.

For example:

```text
Provision Branch
      ↓
Failure
      ↓
Retry
      ↓
Continue/Repair
```

A retry must not create duplicate:

* Pages
* Services
* Configuration
* Pricing profiles
* Other provisioned resources

---

# 26. Booking Architecture

Booking is a central domain.

Conceptually:

```text
Customer
   ↓
Booking UI
   ↓
Validation
   ↓
Availability
   ↓
Pricing
   ↓
Booking Creation
   ↓
Confirmation
   ↓
Assignment
   ↓
Job
```

Booking creation must be authoritative on the server.

---

# 27. Pricing Architecture

Pricing must be implemented as a dedicated domain/service.

Conceptually:

```text
Pricing Request
      ↓
Branch Pricing Profile
      ↓
Service Rules
      ↓
Property Factors
      ↓
Difficulty
      ↓
Add-ons
      ↓
Surcharges
      ↓
Discounts
      ↓
Price Result
```

The pricing engine should produce a structured result rather than only a formatted currency string.

Example conceptual result:

```text
subtotal
discount
surcharge
tax
total
currency
pricing_version
```

---

# 28. Pricing Versioning

Significant pricing calculations should be traceable to the pricing configuration/version used when the booking was created.

Historical bookings must not silently change because a branch changes its pricing later.

---

# 29. Booking State Machine

Booking states should be explicitly modeled.

Initial conceptual state machine:

```text
DRAFT
  ↓
PENDING
  ↓
CONFIRMED
  ↓
ASSIGNED
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

Additional states:

```text
CANCELLED
NO_SHOW
```

Only valid transitions may be performed.

---

# 30. Booking Events

Important booking state changes should produce domain events.

Examples:

```text
BookingCreated
BookingConfirmed
BookingAssigned
BookingStarted
BookingCompleted
BookingCancelled
```

Events may trigger:

* Notifications
* Audit records
* Analytics
* Automation

---

# 31. Worker Architecture

Worker functionality consists of:

```text
Employee
   ↓
Availability
   ↓
Assignment
   ↓
Job
   ↓
Check-in
   ↓
Cleaning
   ↓
Check-out
   ↓
Completion
```

The worker application must be optimized for mobile use.

---

# 32. Assignment Architecture

Assignment begins as a manual operational process.

The architecture must allow future automation.

Potential assignment service inputs:

```text
branch
service
location
date
time
duration
employee availability
employee skills
existing assignments
```

Future optimization may include travel distance and workload balancing.

---

# 33. Payment Architecture

Payment processing must be isolated from general booking presentation.

Conceptually:

```text
Booking
   ↓
Payment Requirement
   ↓
Payment Provider
   ↓
Trusted Provider Event
   ↓
Payment State
   ↓
Booking/Invoice Update
```

The browser must never be the authoritative source for payment completion.

---

# 34. External Provider Abstraction

External services should be accessed through internal adapters where practical.

Conceptually:

```text
CLENQO Domain
      ↓
Provider Interface
      ↓
Provider Adapter
      ↓
External Service
```

This allows providers to be replaced without rewriting business logic.

Potential providers:

* Payment provider
* Email provider
* WhatsApp provider
* Maps/geolocation provider
* Analytics provider

---

# 35. Notification Architecture

Notifications should be event-driven.

```text
Domain Event
     ↓
Notification Event
     ↓
Determine Recipient
     ↓
Determine Language
     ↓
Select Template
     ↓
Select Channel
     ↓
Deliver
     ↓
Record Result
```

Delivery should be observable.

---

# 36. Localization Architecture

Initial languages:

```text
de
en
fr
es
```

Localization should separate:

```text
UI translations
Content
Email templates
Notification templates
Branch content
```

The language system must allow additional languages later.

---

# 37. Content Architecture

Content should distinguish between:

### Global

Controlled by CLENQO HQ.

### Branch

Specific to an individual branch.

### Localized

Specific to a language.

Conceptually:

```text
Content
├── Scope
│   ├── Global
│   └── Branch
│
└── Locale
    ├── de
    ├── en
    ├── fr
    └── es
```

---

# 38. Storage Architecture

Supabase Storage will be used for appropriate media.

Potential assets:

* Branch images
* Service images
* Employee/job photos
* Before/after photos
* Documents
* Other approved media

Storage access must follow authorization rules.

Private operational media must not be publicly accessible by default.

---

# 39. Audit Architecture

Critical operations should generate audit records.

Conceptually:

```text
Actor
Action
Resource
Before
After
Timestamp
Metadata
```

Audit records should be append-oriented and protected from unauthorized modification.

---

# 40. Analytics Architecture

Operational events should be recorded separately from core business state where appropriate.

Examples:

```text
page_view
booking_started
booking_completed
booking_cancelled
payment_completed
job_completed
review_submitted
rebooking
```

Analytics must not become the authoritative source of financial or booking state.

---

# 41. Background Processing

Some operations should not block the main user request.

Potential background operations:

* Email delivery
* Notification retries
* Review requests
* Scheduled reminders
* Recurring booking generation
* Reporting aggregation
* Media processing

The initial implementation should use the simplest reliable mechanism available.

Do not introduce a dedicated distributed queue unless requirements justify it.

---

# 42. Idempotency

Critical operations must protect against duplicate execution.

Especially:

* Booking creation
* Payment processing
* Refunds
* Branch provisioning
* Notifications
* Recurring booking generation

Where appropriate, use idempotency keys or unique database constraints.

---

# 43. Concurrency

The system must protect important resources against race conditions.

Examples:

* Two customers attempting to book the same slot
* Two administrators modifying the same booking
* Payment callback arriving multiple times
* Provisioning being triggered twice

Database constraints and transactions should be preferred where appropriate.

---

# 44. Transactions

Operations that modify multiple related pieces of business state should use database transactions where necessary.

Examples:

```text
Create booking
+
Create booking items
+
Create booking event
```

or:

```text
Create branch
+
Create required configuration
+
Create provisioning records
```

The exact transactional boundaries will be defined during implementation.

---

# 45. API / Server Action Architecture

The application may use:

* Next.js Server Actions
* Route Handlers
* Supabase server clients
* Edge Functions

The choice should depend on the operation.

Business operations should expose clear contracts regardless of transport.

---

# 46. Data Access Layer

Database access should be centralized enough to prevent arbitrary database logic from spreading throughout UI components.

Conceptually:

```text
UI
 ↓
Application Operation
 ↓
Domain Logic
 ↓
Data Access
 ↓
Supabase/PostgreSQL
```

The exact abstraction level should remain practical and avoid unnecessary repository boilerplate.

---

# 47. Error Architecture

Errors should be classified.

Examples:

```text
Validation Error
Authorization Error
Not Found
Conflict
Business Rule Violation
External Provider Error
Internal Error
```

The UI should receive safe, actionable errors.

Internal details should remain server-side.

---

# 48. Security Architecture

Security must exist at multiple layers.

```text
Browser
   ↓
Application
   ↓
Authorization
   ↓
Database RLS
   ↓
Database
```

No single layer should be treated as the only security boundary.

---

# 49. Secrets

Secrets must remain server-side.

Examples:

* Supabase service-role credentials
* Payment provider secrets
* SES credentials
* Webhook secrets
* Other API keys

Never expose them to browser code.

---

# 50. Webhook Architecture

External webhooks must:

1. Authenticate/verify the provider signature.
2. Validate the payload.
3. Process idempotently.
4. Update trusted application state.
5. Record the event where appropriate.
6. Return an appropriate response.

Webhook processing must not blindly trust incoming requests.

---

# 51. SEO Architecture

Public branch websites must generate localized SEO metadata.

The system should support:

* Dynamic metadata
* Canonical URLs
* Sitemap
* Robots configuration
* Structured data
* Local business information

---

# 52. Performance Architecture

Public pages should favor server rendering and minimal client-side JavaScript where appropriate.

Interactive features should use client components only when required.

Administrative and application interfaces may use more client-side behavior when it improves usability.

---

# 53. Caching

Caching may be used for relatively stable data such as:

* Public branch content
* Services
* Non-sensitive configuration

Highly dynamic data such as:

* Availability
* Booking state
* Payment state

must not be served from stale caches when correctness would be affected.

---

# 54. Database Performance

The database should use appropriate:

* Indexes
* Foreign keys
* Constraints
* Pagination
* Query patterns

Performance should be measured rather than optimized through guesswork.

---

# 55. Testing Architecture

Testing should exist at multiple levels.

```text
Unit Tests
   ↓
Domain/Business Logic Tests
   ↓
Integration Tests
   ↓
End-to-End Tests
```

Critical business domains must have automated test coverage, especially:

* Pricing
* Booking state transitions
* Availability
* Assignment
* Provisioning
* Payment state handling
* Permissions
* Branch isolation

Tests must cover important edge cases, not only the happy path.

The detailed testing approach is defined in:

```text
docs/TESTING_STRATEGY.md
```
