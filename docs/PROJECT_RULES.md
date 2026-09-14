# CLENQO — Project Rules

> **Clean Spaces. Better Living.**

This document defines the mandatory engineering, product, architectural, security, and development rules for the CLENQO platform.

These rules apply to all developers, AI coding agents, OpenSpec changes, migrations, features, and future contributors.

If a proposed implementation conflicts with these rules, the implementation must be reconsidered before coding begins.

---

# 1. Core Product Principle

CLENQO is a **technology-powered, multi-branch cleaning business platform**.

It must never be designed as a single-location application.

The system must support:

```text
CLENQO HQ
    │
    ├── Branch A
    ├── Branch B
    ├── Branch C
    └── Branch N
```

A branch is a configuration and operational unit inside the central CLENQO platform.

Branches must not require:

* Separate codebases
* Separate frontend applications
* Separate backend applications
* Separate deployment pipelines
* Duplicated components

---

# 2. Single Platform Rule

CLENQO must use a **single centralized application platform**.

The default architecture is:

```text
                    CLENQO PLATFORM
                           │
              ┌────────────┴────────────┐
              │                         │
           Frontend                  Backend
              │                         │
           Next.js                 Supabase
                                        │
                                    PostgreSQL
```

All branches operate through this platform.

Branch-specific behavior must be driven by configuration and data rather than duplicated source code.

---

# 3. Multi-Branch Rule

Every feature that contains operational or customer data must consider branch ownership where applicable.

Examples:

```text
bookings.branch_id
customers.branch_id
employees.branch_id
services.branch_id
pricing.branch_id
reviews.branch_id
```

A feature must not assume a single global branch.

If a piece of data is genuinely global, it may remain organization-level or platform-level.

---

# 4. Organization and Branch Hierarchy

The intended hierarchy is:

```text
CLENQO Organization
        │
        ├── HQ
        │
        └── Branches
              │
              ├── Staff
              ├── Customers
              ├── Services
              ├── Pricing
              ├── Bookings
              ├── Jobs
              └── Local Configuration
```

The distinction between:

* Global CLENQO configuration
* Branch configuration
* User-specific data

must remain explicit.

---

# 5. No Hardcoded Branches

Never hardcode a city, branch, address, telephone number, pricing configuration, or branch-specific operational value into application logic.

Bad:

```ts
const branch = "Leipzig";
```

Good:

```ts
const branch = await getBranchBySlug(slug);
```

Branch information must come from the database or approved configuration layer.

---

# 6. Branch Provisioning Rule

Creating a branch must be treated as a controlled provisioning operation.

The intended flow is:

```text
HQ Admin
   ↓
Create Branch
   ↓
Validate Configuration
   ↓
Create Branch
   ↓
Apply Default Configuration
   ↓
Provision Website Configuration
   ↓
Provision Dashboard Context
   ↓
Provision Default Services
   ↓
Provision Booking Configuration
   ↓
Branch Ready
```

Provisioning must be deterministic and safe to retry.

A failed provisioning operation must not leave the branch in an unknowable partial state.

---

# 7. Website Architecture Rule

Every branch receives a localized website experience from the **central CLENQO website system**.

Do not create separate frontend applications for individual branches.

The website should use:

```text
Master Design System
        +
Reusable Components
        +
Branch Configuration
        +
Branch Content
        =
Branch Website
```

The branch website may contain:

* Local business information
* Local service availability
* Local pricing
* Local service area
* Local contact information
* Local reviews
* Local images
* Local promotions

The core CLENQO design language remains centrally controlled.

---

# 8. Design System Rule

CLENQO must have one centralized design system.

Reusable design tokens should control:

* Colors
* Typography
* Spacing
* Radius
* Shadows
* Motion
* Breakpoints
* Component behavior

Individual branches must not arbitrarily redefine the CLENQO brand.

Branch customization should be configuration-driven and restricted to approved properties.

---

# 9. Dashboard Rule

There must be one centralized dashboard application.

Access is determined by role and scope.

```text
HQ Admin
    ↓
All branches

Branch Manager
    ↓
Assigned branch(es)

Cleaner
    ↓
Assigned jobs

Customer
    ↓
Own bookings
```

Do not build separate dashboard applications for individual branches.

---

# 10. Role and Permission Rule

Authorization must never depend only on frontend UI visibility.

Hiding a button does not constitute security.

Authorization must be enforced server-side and at the database layer where appropriate.

The system must distinguish between:

* Authentication
* Authorization
* Organization scope
* Branch scope
* Resource ownership

---

# 11. Row Level Security Rule

Supabase Row Level Security (RLS) is mandatory for protected database data.

Branch-scoped data must not rely solely on application code for isolation.

Example principle:

```text
User
 ↓
Role
 ↓
Branch membership
 ↓
RLS policy
 ↓
Authorized data
```

A branch user must never be able to bypass application restrictions by directly querying the database.

---

# 12. Database Rules

All production database changes must be version controlled.

Use:

```text
supabase/migrations/
```

for schema migrations.

Never make undocumented production schema changes manually.

Database migrations must be:

* Deterministic
* Reviewable
* Re-runnable where appropriate
* Tested
* Ordered
* Documented when behavior is significant

---

# 13. Business Logic Rule

Business logic must not be buried inside UI components.

For example, pricing logic must not exist only inside:

```text
BookingForm.tsx
```

Instead:

```text
UI
 ↓
Application logic
 ↓
Pricing Engine
 ↓
Validated result
```

The same business rule must be reusable by:

* Customer booking
* Admin
* API
* Automated processes
* Future mobile/PWA interfaces

---

# 14. Pricing Rule

Pricing must be treated as a dedicated domain.

The pricing engine must be deterministic.

Conceptually:

```text
Base Service
+
Property Factors
+
Difficulty
+
Duration
+
Add-ons
+
Surcharges
-
Approved Discounts
=
Final Price
```

Pricing must never be duplicated across multiple frontend components.

All important pricing calculations must be testable independently.

---

# 15. Booking Rule

The booking system is a core business system.

A booking must have a clear lifecycle.

Example:

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

Alternative states such as:

```text
CANCELLED
NO_SHOW
FAILED
RESCHEDULED
```

must be explicitly modeled rather than represented by arbitrary booleans.

---

# 16. Customer Account Rule

The initial customer experience should not require a traditional password-based account.

Customers should be able to:

```text
Enter details
     ↓
Book
     ↓
Receive confirmation
     ↓
Receive secure magic link
     ↓
Manage booking
```

Authentication mechanisms must still use secure, expiring, non-guessable tokens.

---

# 17. Employee Rule

Cleaners are employees or approved workers associated with a branch.

The system must maintain explicit worker status and availability.

The cleaner experience should be mobile-first.

Important operational actions should be easy to perform from a phone.

---

# 18. Assignment Rule

Worker assignment must be treated as a dedicated domain.

Assignment may eventually consider:

* Branch
* Service area
* Availability
* Working hours
* Skills
* Service type
* Job duration
* Existing schedule
* Travel distance
* Employee status

Assignment logic must not be scattered throughout the booking UI.

---

# 19. Notifications Rule

Notifications must be event-driven where practical.

For example:

```text
Booking Confirmed
       ↓
Notification Event
       ↓
Email
       ↓
Optional WhatsApp
```

Do not place large notification workflows directly inside presentation components.

Notification delivery must be observable and retryable where appropriate.

---

# 20. Payment Rule

Payment processing must be treated as a financial domain.

Never trust payment status supplied by the browser.

Payment state must be verified through trusted server-side mechanisms and payment-provider events.

Financial records must be auditable.

Never silently overwrite financial history.

---

# 21. Auditability Rule

Important administrative and financial actions should be auditable.

Examples:

* Branch creation
* Branch activation/deactivation
* Price changes
* Booking status changes
* Booking cancellation
* Payment changes
* Refunds
* Employee changes
* Permission changes

Where appropriate, store:

```text
actor
action
resource
timestamp
previous state
new state
metadata
```

---

# 22. Validation Rule

All external input must be validated.

Use:

**Zod**

for application-level schema validation where appropriate.

Never assume that:

```text
frontend validation = security
```

Frontend validation improves UX.

Server-side validation protects the system.

Both are required.

---

# 23. TypeScript Rule

TypeScript strict mode should be enabled.

Avoid:

```ts
any
```

unless there is a documented technical reason.

Prefer:

* Explicit types
* Discriminated unions
* Typed database results
* Shared schemas
* Type-safe domain functions

---

# 24. Component Rule

Components should have clear responsibilities.

Avoid giant components containing:

* UI
* database queries
* authorization
* business rules
* pricing calculations
* payment processing

Prefer separation:

```text
Presentation
     ↓
Feature/Application Logic
     ↓
Domain Logic
     ↓
Data Access
```

---

# 25. Reusability Rule

Build reusable components and domain functions.

If three branches use the same feature, it should generally exist once in the codebase.

Do not copy:

```text
BerlinBooking.tsx
MunichBooking.tsx
DresdenBooking.tsx
```

Instead:

```text
Booking.tsx
```

with branch-aware configuration.

---

# 26. Configuration Over Duplication

When branches differ, prefer configuration.

Example:

```text
Branch
 ├── name
 ├── slug
 ├── location
 ├── service_area
 ├── opening_hours
 ├── pricing_profile
 └── website_configuration
```

The application interprets the configuration.

---

# 27. API Rule

API contracts must be explicit.

Endpoints/actions must define:

* Input
* Validation
* Authorization
* Business operation
* Output
* Errors

Do not expose database operations directly to untrusted clients.

---

# 28. Error Handling Rule

Errors must be intentional and understandable.

Do not expose:

* Database internals
* Secrets
* Stack traces
* Sensitive information
* Internal implementation details

to end users.

Logs may contain more technical information but must still avoid secrets and unnecessary personal data.

---

# 29. Secrets Rule

Never commit secrets to Git.

Never place secrets in:

* Source code
* Documentation
* Client-side environment variables
* OpenSpec specifications
* Screenshots
* Example configuration files

Use environment variables and approved secret-management mechanisms.

---

# 30. Testing Rule

Critical business logic must have automated tests.

Priority areas include:

1. Pricing
2. Booking state transitions
3. Availability
4. Assignment
5. Cancellation rules
6. Payment state handling
7. Permissions
8. Branch isolation
9. Provisioning
10. Notifications

Tests must cover important edge cases, not only the happy path.

---

# 31. OpenSpec Rule

Significant functionality must be implemented through OpenSpec.

Examples:

* New major feature
* Database architecture change
* New business workflow
* New integration
* Permission model changes
* Booking changes
* Payment changes
* Branch provisioning
* Major UI/application architecture changes

The general workflow is:

```text
Requirement
    ↓
OpenSpec Change
    ↓
Proposal
    ↓
Specification
    ↓
Implementation
    ↓
Verification
    ↓
Archive
```

Small corrections may not require a full OpenSpec change when the existing specification already covers them.

---

# 32. Documentation Rule

Important architectural or business decisions must be documented.

Documentation must be updated when implementation changes an established decision.

Do not allow:

```text
Documentation says A
Code does B
```

without explicitly resolving the discrepancy.

---

# 33. AI Coding Agent Rule

AI coding agents must follow the project documentation.

Before implementing a significant feature, the agent should inspect the relevant:

* `README.md`
* `PROJECT_RULES.md`
* Domain documentation
* OpenSpec specification
* Existing implementation

The agent must not invent new architecture when an established pattern already exists.

If requirements conflict or are ambiguous, stop and surface the conflict rather than silently making a major architectural decision.

---

# 34. No Premature Complexity

CLENQO should be production-grade but not unnecessarily complex.

Do not introduce infrastructure merely because it is technically interesting.

Every technology must have a clear purpose.

Prefer:

```text
Simple
+
Reliable
+
Maintainable
```

over:

```text
Complex
+
Distributed
+
Difficult to operate
```

unless scale or business requirements justify the complexity.

---

# 35. No Premature Microservices

The initial CLENQO platform should use a modular application architecture rather than prematurely splitting into microservices.

Prefer:

```text
Modular Monolith
```

before:

```text
Microservices
```

The architecture should maintain clean domain boundaries so individual services can be extracted later if necessary.

---

# 36. Performance Rule

Performance must be considered from the beginning.

Priorities include:

* Fast initial page load
* Optimized images
* Server-side rendering where appropriate
* Minimal client-side JavaScript where possible
* Efficient database queries
* Pagination for large datasets
* Proper indexes
* Caching where justified

Performance optimizations must not compromise correctness or security.

---

# 37. SEO Rule

Public branch websites must be SEO-friendly.

Branch pages should be capable of having unique:

* Titles
* Descriptions
* URLs
* Structured data
* Local business information
* Content
* Service information

The system should support local SEO without requiring duplicated websites.

---

# 38. Accessibility Rule

The customer-facing website and administrative interfaces should follow accessible web practices.

Priorities include:

* Keyboard navigation
* Semantic HTML
* Accessible forms
* Proper labels
* Focus states
* Sufficient contrast
* Screen-reader compatibility
* Reduced-motion support where appropriate

---

# 39. Mobile Rule

The cleaner experience is mobile-first.

The customer booking experience must also work exceptionally well on mobile.

Desktop dashboards may prioritize larger screens, but core administrative workflows should remain usable on smaller screens.

---

# 40. Data Privacy Rule

CLENQO operates in the European market and must treat personal data responsibly.

The system should follow applicable privacy requirements, including GDPR obligations where applicable.

Personal data must be:

* Minimized
* Protected
* Access-controlled
* Retained only as necessary
* Handled according to documented policies

Sensitive information must never be exposed unnecessarily.

---

# 41. Observability Rule

Production systems must provide sufficient visibility into important operations.

Monitor:

* Booking failures
* Payment failures
* Notification failures
* Provisioning failures
* Application errors
* Database errors
* Critical workflow failures

Important background operations should be traceable.

---

# 42. Deployment Rule

Production deployments must be reproducible.

The project should use:

```text
Git
+
Automated deployment
+
Versioned migrations
+
Environment-specific configuration
```

Production database changes must not depend on undocumented manual steps.

---

# 43. Git Rule

Commits should be:

* Focused
* Descriptive
* Related to a specific change
* Free of unrelated modifications

Do not commit:

* Secrets
* Generated junk
* Temporary debugging files
* Unrelated changes

---

# 44. Definition of Done

A feature is not considered complete merely because it works locally.

A production feature should satisfy, where applicable:

```text
Requirement implemented
        ↓
Validation implemented
        ↓
Authorization implemented
        ↓
Database changes migrated
        ↓
Tests added
        ↓
UI verified
        ↓
Error states handled
        ↓
Documentation updated
        ↓
OpenSpec verified
        ↓
Git status clean
```

---

# 45. Change Management

When an architectural decision needs to change:

1. Identify the affected documentation.
2. Identify affected OpenSpec specifications.
3. Evaluate database and migration impact.
4. Evaluate existing features.
5. Update the documentation.
6. Create/update the OpenSpec change.
7. Implement.
8. Test.
9. Verify.
10. Archive the completed change where appropriate.

Never silently introduce architecture that contradicts established project decisions.

---

# 46. Golden Rule

When deciding between two implementation approaches, prefer the solution that best satisfies:

```text
Business correctness
        +
Security
        +
Maintainability
        +
Scalability
        +
Simplicity
        +
User experience
```

The goal is not to build the most technologically complicated system.

The goal is to build the **best reliable operating platform for CLENQO**.

---

# 47. Current Foundational Objective

The first technical objective is:

> Build the CLENQO multi-branch foundation so that HQ can create a branch and the platform can automatically provision the branch's website configuration and operational dashboard within the same centralized application.

All subsequent systems should build on this foundation.
