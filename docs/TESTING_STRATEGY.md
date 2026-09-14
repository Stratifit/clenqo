# CLENQO Testing and QA

## 1. Purpose

The CLENQO Testing and QA system ensures that the platform is:

* correct
* secure
* reliable
* maintainable
* scalable
* accessible
* performant

Testing must protect business rules as well as technical implementation.

---

# 2. Core Principle

> **A feature is not complete when the code works once. It is complete when its expected behavior is verified and protected against regression.**

---

# 3. Testing Philosophy

CLENQO follows a layered testing strategy:

```text
Static Analysis
      ↓
Unit Tests
      ↓
Integration Tests
      ↓
Database / RLS Tests
      ↓
End-to-End Tests
      ↓
Security Tests
      ↓
Production Verification
```

Not every feature requires every layer, but important business functionality must be tested at the appropriate levels.

---

# 4. Quality Gates

A change should not be considered production-ready until applicable checks pass.

Minimum baseline:

```text
TypeScript
Lint
Formatting
Unit Tests
Integration Tests
Build
Relevant E2E Tests
Security Checks
```

---

# 5. Test Pyramid

The project should favor:

```text
        E2E
       /   \
    Integration
     /       \
     Unit Tests
```

Most logic should be verified with fast unit/integration tests.

E2E tests should protect critical user journeys rather than every small UI detail.

---

# 6. TypeScript

Strict TypeScript compilation is required.

Test/CI command should verify that the project compiles without unacceptable type errors.

---

# 7. Linting

Linting should run in CI.

The project should not knowingly accumulate lint errors.

---

# 8. Formatting

Formatting should be automated and consistent.

Formatting failures should be caught before merge.

---

# 9. Build Verification

Production builds must be tested in CI.

A feature is not complete if development mode works but the production build fails.

---

# 10. Unit Tests

Unit tests should cover deterministic business logic.

High-priority examples:

```text
pricing
discounts
surcharges
duration
difficulty
booking state transitions
availability calculations
localization fallback
permission checks
validation
notification recipient resolution
```

---

# 11. Unit Test Principle

Unit tests should focus on behavior rather than implementation details.

Prefer:

```text
given input
→ expected result
```

over testing private implementation structure.

---

# 12. Pricing Engine Testing

The pricing engine requires extensive unit testing because it directly affects customer charges.

Test:

* hourly rates
* duration
* difficulty
* add-ons
* surcharges
* discounts
* taxes
* minimum charges
* rounding
* currency
* overrides
* quote-required paths
* pricing versions

---

# 13. Pricing Determinism Test

The same pricing input and pricing version must always produce the same result.

Example:

```text
Input A
+
Pricing Version 4
=
Price X
```

Repeated execution must produce:

```text
Price X
```

---

# 14. Pricing Snapshot Testing

When a booking is confirmed, its price snapshot should remain stable even if future pricing rules change.

Test:

```text
Booking created under Version 4
 ↓
Pricing Version 5 published
 ↓
Historical booking remains Version 4
```

---

# 15. Rounding Tests

Test currency rounding explicitly.

Examples:

```text
decimal duration
percentage surcharge
tax
discount
```

must produce deterministic monetary values.

---

# 16. Discount Tests

Test:

* valid discounts
* expired discounts
* minimum requirements
* incompatible discounts
* stacking
* maximum discount
* invalid codes

---

# 17. Surcharge Tests

Test:

```text
night
Sunday
holiday
emergency
```

including combinations where permitted.

---

# 18. Booking Tests

Booking tests must cover:

* creation
* validation
* confirmation
* cancellation
* rescheduling
* assignment
* start
* completion
* no-show

---

# 19. Booking State Machine

Invalid transitions must fail.

Example:

```text
cancelled
→ completed
```

must not be allowed unless an explicitly defined business flow permits it.

---

# 20. Booking Recheck

A booking should revalidate availability before final confirmation.

Test concurrent requests attempting to book the same constrained slot.

---

# 21. Idempotency Tests

Repeat the same request with the same idempotency key.

Expected behavior:

```text
first request
→ creates booking

retry
→ does not create duplicate booking
```

---

# 22. Availability Tests

Test:

* branch hours
* service hours
* employee availability
* exceptions
* existing jobs
* buffers
* blackouts
* lead time
* advance booking
* capacity
* slot granularity

---

# 23. Timezone Tests

Test availability around:

```text
midnight
DST transitions
timezone changes
```

---

# 24. DST Tests

At least one test dataset should cover a daylight-saving transition for a relevant operating region.

---

# 25. Recurring Booking Tests

Test:

* valid recurrence
* invalid recurrence
* unavailable occurrence
* cancellation
* rescheduling
* skipped occurrence
* future occurrence generation

---

# 26. Workforce Tests

Test:

```text
employee availability
skills
branch assignments
job assignments
assignment acceptance
decline
reassignment
check-in
check-out
completion
```

---

# 27. Cleaner Scope Tests

A cleaner must not access unrelated jobs.

Example:

```text
Cleaner A
→ Job B
```

must be denied unless explicitly authorized.

---

# 28. Branch Isolation Tests

These are mandatory.

Example:

```text
Branch A Manager
→ Branch A Booking ✓

Branch A Manager
→ Branch B Booking ✗
```

---

# 29. HQ Authorization Tests

Test:

```text
HQ Admin
→ all authorized branches

HQ Staff
→ configured scope

Branch Manager
→ assigned branch only

Cleaner
→ assigned operational scope
```

---

# 30. RLS Tests

RLS policies must be tested directly against representative users and scopes.

Do not assume application-level authorization makes RLS testing unnecessary.

---

# 31. RLS Negative Tests

Test attempts to bypass scope through:

```text
branch_id
organization_id
resource_id
URL
query parameters
request body
```

---

# 32. Customer Isolation Tests

Customer A must not access Customer B's data.

Test:

```text
booking ID manipulation
magic-link manipulation
customer ID manipulation
```

---

# 33. Magic-Link Tests

Test:

* valid token
* expired token
* invalid token
* reused token
* wrong booking
* wrong customer
* rate limits
* token invalidation

---

# 34. Magic-Link Security

Never expose raw magic-link tokens in logs or audit records.

---

# 35. CMS Tests

Test:

```text
create page
edit page
edit section
reorder section
enable/disable
save draft
publish
preview
```

---

# 36. CMS Authorization Tests

Test that:

```text
branch editor
→ branch content

branch editor
→ global design tokens ✗

authorized publisher
→ publish ✓
```

---

# 37. Section Registry Tests

Every registered section should:

* have a valid schema
* render correctly
* reject invalid data
* support expected localization
* support visibility state

---

# 38. Content Validation Tests

Invalid structured CMS content must be rejected.

Example:

```text
missing required hero title
→ validation error
```

---

# 39. Website Rendering Tests

Test that published content renders correctly for:

```text
branch
locale
page
```

---

# 40. Localization Tests

Test:

```text
requested locale
branch default
organization fallback
platform fallback
```

---

# 41. Missing Translation Tests

A missing translation must follow the defined fallback strategy.

It must not cause unpredictable content mixing.

---

# 42. Locale Independence

Dashboard UI language and public website content language must remain independent.

---

# 43. Formatting Tests

Test locale-aware:

* dates
* times
* numbers
* currency
* percentages

---

# 44. Financial Tests

Financial logic requires high-confidence integration testing.

Test:

```text
payment
refund
invoice
manual payment
cancellation fee
tips
outstanding amount
```

---

# 45. Payment Provider Tests

External payment integrations should use provider test/sandbox environments.

Never use real payment credentials in automated tests.

---

# 46. Webhook Tests

Test:

* valid signature
* invalid signature
* duplicate event
* unknown event
* malformed payload
* delayed event
* out-of-order event

---

# 47. Webhook Idempotency

Repeated provider events must not create duplicate financial effects.

---

# 48. Refund Tests

Test:

```text
full refund
partial refund
duplicate refund
invalid amount
unauthorized refund
```

---

# 49. Invoice Tests

Test:

```text
creation
issue
payment
overdue
cancellation
```

---

# 50. Notification Tests

Test the complete flow:

```text
Business Event
 ↓
Recipient Resolution
 ↓
Template
 ↓
Locale
 ↓
Channel
 ↓
Provider
 ↓
Delivery Record
```

---

# 51. Notification Template Tests

Test:

* required variables
* missing variables
* invalid variables
* localization
* rendering
* subject
* body
* branch branding

---

# 52. Email Provider Tests

Amazon SES integration should be tested without sending unintended production emails.

Use controlled test environments.

---

# 53. Notification Retry Tests

Test transient failure and retry behavior.

Verify that retries do not create duplicate business effects.

---

# 54. Notification Cancellation Tests

If a booking is cancelled/rescheduled, scheduled reminders must be correctly invalidated.

---

# 55. Quality Tests

Test:

```text
review submission
duplicate review prevention
rating calculation
moderation
complaints
quality issues
rework
```

---

# 56. Reporting Tests

Every important metric requires formula tests.

Example:

```text
100 eligible bookings
80 completed
20 cancelled

Completion Rate = 80%
```

---

# 57. Reporting Scope Tests

Test that:

```text
HQ report
→ all authorized branches

Branch report
→ assigned branch only
```

---

# 58. Reporting Empty States

Test differences between:

```text
zero
```

and:

```text
no data
```

---

# 59. Reporting Time Tests

Test date boundaries using branch-local timezones.

---

# 60. Audit Tests

Verify important mutations create appropriate audit records.

Examples:

```text
branch created
pricing published
booking cancelled
refund issued
user role changed
```

---

# 61. Audit Immutability Tests

Normal application users must not be able to modify historical audit records.

---

# 62. Audit Redaction Tests

Ensure sensitive information does not enter audit metadata.

---

# 63. Provisioning Tests

Branch provisioning is a critical workflow.

Test:

```text
Create Branch
 ↓
Provision
 ↓
Website
 ↓
Locales
 ↓
Pages
 ↓
Sections
 ↓
Configuration
```

---

# 64. Provisioning Idempotency

Run provisioning twice.

Expected:

```text
same expected resources
no duplicates
```

---

# 65. Provisioning Failure Tests

Simulate failure at multiple stages.

Verify:

```text
failure recorded
partial state recoverable
retry succeeds
duplicates avoided
```

---

# 66. Branch Activation Tests

A branch must not activate when mandatory configuration is missing.

---

# 67. Branch Lifecycle Tests

Test valid and invalid transitions:

```text
draft
provisioning
ready
active
suspended
archived
```

---

# 68. API Tests

API integration tests should verify:

* authentication
* authorization
* validation
* response shape
* errors
* rate limiting
* idempotency

---

# 69. Error Tests

Test expected failure responses.

Examples:

```text
invalid input
unauthorized
forbidden
not found
conflict
rate limited
provider failure
```

---

# 70. No Information Leakage

Error responses must not reveal whether unauthorized resources exist when such information is sensitive.

---

# 71. End-to-End Testing

E2E tests should protect critical customer and staff journeys.

---

# 72. Critical Customer Journey

At minimum:

```text
Visit Branch Website
 ↓
Select Service
 ↓
Enter Property Details
 ↓
Select Date/Time
 ↓
View Price
 ↓
Enter Contact Details
 ↓
Submit Booking
 ↓
Confirmation
 ↓
Manage Booking
```

---

# 73. Critical Branch Journey

At minimum:

```text
Login
 ↓
Select Branch
 ↓
View Booking
 ↓
Assign Cleaner
 ↓
View Job
 ↓
Complete Operation
```

---

# 74. Cleaner Journey

At minimum:

```text
Login
 ↓
View Jobs
 ↓
Open Job
 ↓
Check In
 ↓
Start
 ↓
Complete Checklist
 ↓
Add Notes/Photos
 ↓
Check Out
```

---

# 75. Admin Journey

At minimum:

```text
HQ Login
 ↓
Create Branch
 ↓
Provision
 ↓
Configure
 ↓
Assign Manager
 ↓
Activate
```

---

# 76. Financial Journey

Where payment integration exists:

```text
Booking
 ↓
Payment Request
 ↓
Provider
 ↓
Webhook
 ↓
Payment Confirmed
 ↓
Invoice/Receipt
```

---

# 77. Notification Journey

Test:

```text
Booking Confirmed
 ↓
Notification Event
 ↓
Email
 ↓
Delivery Status
```

---

# 78. Browser Testing

Critical E2E journeys should run against supported modern browsers.

Initial priority:

```text
Chrome
Edge
Safari where applicable
Firefox where justified
```

---

# 79. Mobile Testing

The following must receive dedicated mobile testing:

* booking
* customer management
* cleaner PWA
* operational job workflows

---

# 80. Responsive Testing

Verify key layouts at representative:

```text
mobile
tablet
desktop
```

widths.

---

# 81. Accessibility

Accessibility testing must cover:

* keyboard navigation
* focus states
* semantic structure
* labels
* contrast
* screen-reader compatibility
* form errors
* touch targets
* reduced motion

---

# 82. Automated Accessibility

Use automated accessibility checks where practical.

Automated tools do not replace manual accessibility testing.

---

# 83. Reduced Motion

GSAP and other animations must respect reduced-motion preferences.

---

# 84. Performance Testing

Measure important pages and flows.

Targets should focus on user experience rather than arbitrary scores.

---

# 85. Performance Areas

Test:

```text
homepage
branch website
booking flow
dashboard
cleaner PWA
```

---

# 86. Database Performance

Important queries should be tested against realistic data volumes.

Avoid validating performance only with:

```text
10 bookings
3 employees
1 branch
```

---

# 87. Scale Test Data

As the platform grows, test representative scenarios such as:

```text
100 branches
thousands of employees
large booking history
large audit history
```

Exact targets should evolve with production scale.

---

# 88. Load Testing

Before major public launches, load-test critical endpoints such as:

```text
availability
pricing
booking creation
public pages
authentication
```

---

# 89. Concurrency Testing

Test simultaneous requests for:

* booking slots
* assignments
* payments
* provisioning
* publishing

---

# 90. Security Testing

Security tests must include:

```text
RLS
authorization
branch isolation
customer isolation
input validation
XSS
CSRF
rate limits
magic links
webhooks
storage
file uploads
```

---

# 91. Negative Testing

For every sensitive operation, test invalid and unauthorized paths.

Example:

```text
Valid Request ✓

Modified Branch ID ✗

Modified User ID ✗

Modified Price ✗

Modified Permission ✗
```

---

# 92. Regression Testing

Every bug discovered in production should result in a regression test when practical.

The test should reproduce the failure before the fix where feasible.

---

# 93. Bug Severity

Issues may be classified:

```text
P0 — critical
P1 — high
P2 — medium
P3 — low
```

Definitions should be agreed upon by the project team.

---

# 94. Critical Bugs

P0/P1 issues affecting:

* security
* financial correctness
* branch isolation
* booking correctness
* data integrity

must block release until resolved or explicitly accepted by authorized decision-makers.

---

# 95. Test Data

Use deterministic test fixtures.

Fixtures should be:

* understandable
* reusable
* isolated
* safe

---

# 96. Production Data

Production customer data should not be used as ordinary automated test data.

---

# 97. Test Database

Integration tests should run against an isolated database/environment.

---

# 98. Database Reset

Tests must have a deterministic setup/cleanup strategy.

One test should not depend on another test's database state.

---

# 99. Migration Testing

Database migrations must be tested against representative existing schema/data.

---

# 100. Fresh Database Test

CI should verify that the complete migration chain can build a fresh database successfully.

---

# 101. Migration Upgrade Test

Where appropriate, test upgrading from the previous production schema to the new schema.

---

# 102. Seed Testing

Seeds should be deterministic and safe to execute according to their defined behavior.

---

# 103. Supabase Testing

Supabase-specific behavior must be tested where used:

```text
Auth
RLS
Storage
PostgreSQL functions
RPC
```

---

# 104. RPC Testing

Security-sensitive database functions must test:

* valid inputs
* invalid inputs
* authorization
* transaction behavior
* error handling

---

# 105. Storage Testing

Test:

```text
public asset access
private asset access
signed URLs
branch isolation
upload restrictions
```

---

# 106. Contract Testing

Where external providers or internal APIs have stable contracts, contract tests should verify expected request/response shapes.

---

# 107. External Provider Mocking

Automated tests should not depend on live third-party services unless a dedicated integration environment requires it.

Mock or sandbox:

```text
payment provider
SES
future WhatsApp provider
maps
other external APIs
```

---

# 108. Email Testing

Emails should be testable without sending real messages.

Verify:

* subject
* content
* links
* locale
* variables
* branding

---

# 109. Link Testing

Important email links should point to valid environments and correct resources.

---

# 110. Test Environment

The project should have a controlled test/staging environment before production.

Conceptually:

```text
Local
 ↓
CI
 ↓
Staging
 ↓
Production
```

---

# 111. Environment Isolation

Environment credentials and databases must remain separate.

---

# 112. CI Pipeline

A typical CI pipeline:

```text
Install
 ↓
Lint
 ↓
Typecheck
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
Build
 ↓
E2E
 ↓
Security Checks
```

---

# 113. Pull Requests

Pull requests should pass required automated checks before merge.

---

# 114. Branch Protection

The main production branch should eventually require:

* successful CI
* appropriate review
* no unresolved blocking checks

---

# 115. Test Naming

Tests should clearly describe behavior.

Prefer:

```text
calculates Sunday surcharge correctly
```

over:

```text
testPricing2
```

---

# 116. Test Organization

Tests should follow domain boundaries where practical.

Example:

```text
pricing/
booking/
availability/
workforce/
payments/
notifications/
quality/
reporting/
authorization/
```

---

# 117. Shared Test Utilities

Reusable helpers should exist for:

* authenticated users
* branches
* customers
* bookings
* employees
* pricing profiles

Avoid duplicating setup logic.

---

# 118. Test Fixtures

Fixtures should represent meaningful business scenarios.

Example:

```text
standard_home_booking
sunday_deep_cleaning
recurring_booking
cancelled_booking
unassigned_job
```

---

# 119. Golden Scenarios

Maintain a small set of canonical scenarios that must always pass.

Examples:

```text
normal booking
recurring booking
cancellation
payment
refund
branch provisioning
cleaner job completion
```

---

# 120. Testing Documentation

Each major domain should document:

```text
what must be tested
critical invariants
known edge cases
test commands
```

---

# 121. OpenSpec Testing

Every OpenSpec change should define appropriate verification.

Example:

```text
Requirement
 ↓
Scenario
 ↓
Implementation
 ↓
Test
```

---

# 122. Acceptance Criteria

Acceptance criteria should be behavior-oriented.

Example:

```text
Given an active branch
When an authorized HQ Admin creates a branch
Then the required website resources are provisioned
And duplicate provisioning does not occur on retry
```

---

# 123. Requirement Traceability

Important requirements should map to:

```text
documentation
OpenSpec
implementation
tests
```

---

# 124. Definition of Done

A feature is complete when:

```text
requirements understood
implementation complete
validation complete
tests pass
security reviewed
authorization reviewed
RLS reviewed where applicable
documentation updated
build passes
```

---

# 125. Release Verification

Before release:

```text
CI green
Database migrations verified
Critical E2E green
Security checks green
Production build verified
Environment configuration verified
```

---

# 126. Production Smoke Tests

After deployment, run appropriate smoke tests.

Examples:

```text
homepage loads
branch website loads
booking flow starts
authentication works
dashboard loads
database connectivity works
notifications operate
```

---

# 127. Post-Deployment Monitoring

After a significant deployment, monitor:

```text
errors
latency
booking failures
payment failures
notification failures
database issues
```

---

# 128. Rollback

Deployments must have a rollback strategy.

Database migrations require particular care because application rollback and schema rollback are not always symmetrical.

---

# 129. Safe Database Rollback

Prefer forward-compatible migrations.

Where rollback is unsafe, define a forward remediation strategy.

---

# 130. Feature Flags

Feature flags may be used to reduce deployment risk for larger changes.

---

# 131. Canary / Gradual Rollout

Future high-risk features may be enabled progressively:

```text
internal
 ↓
one branch
 ↓
small group
 ↓
all branches
```

---

# 132. QA Ownership

Developers own automated test quality.

Product/business owners validate business acceptance.

Security-sensitive functionality receives additional security review where appropriate.

---

# 133. Manual QA

Manual testing remains important for:

* visual quality
* accessibility
* complex workflows
* edge cases
* real-device behavior
* business acceptance

---

# 134. Visual QA

Review:

```text
spacing
typography
responsive behavior
animations
loading states
errors
empty states
forms
navigation
```

against `DESIGN_SYSTEM.md`.

---

# 135. Browser Console

Production-ready pages should not contain unexplained critical browser-console errors.

---

# 136. Accessibility QA

Critical flows should be manually tested with keyboard navigation.

---

# 137. Localization QA

Review translated interfaces for:

* overflow
* truncation
* missing strings
* incorrect formatting
* inappropriate fallback

---

# 138. Long Text Testing

Test long translations and customer-entered text.

The UI must not assume English-length strings.

---

# 139. Data Integrity QA

Verify relationships such as:

```text
booking
→ customer
→ branch
→ service
→ pricing snapshot
→ job
→ payment
```

remain consistent.

---

# 140. Referential Integrity

Database constraints should prevent invalid references wherever practical.

---

# 141. Disaster Recovery Testing

Future operational maturity should include periodic tests of:

```text
backup restore
database recovery
provider recovery
deployment recovery
```

---

# 142. Performance Regression

Significant changes should be checked for performance regressions in affected workflows.

---

# 143. Security Regression

Security fixes must include regression tests to prevent reintroduction.

---

# 144. Test Coverage

Coverage is a useful signal, not the definition of quality.

Do not optimize for percentage alone.

Prioritize:

```text
business-critical logic
security boundaries
financial correctness
data integrity
```

---

# 145. Mutation Testing

Mutation testing may be introduced later for especially critical deterministic logic such as pricing and authorization.

---

# 146. Property-Based Testing

Property-based testing may eventually be useful for:

* pricing
* date/time calculations
* availability
* validation

when normal example-based tests are insufficient.

---

# 147. Fuzz Testing

Future security testing may fuzz:

```text
public booking input
CMS input
API parameters
file uploads
webhook payloads
```

---

# 148. Test Failure Policy

A failing critical test should block release unless an authorized exception is explicitly documented.

---

# 149. Flaky Tests

Flaky tests must be investigated.

Do not normalize:

```text
"run it again until green"
```

as a CI strategy.

---

# 150. Test Reliability

Tests should be:

* deterministic
* isolated
* repeatable
* observable

---

# 151. MVP Testing Scope

The MVP must include:

```text
TypeScript
Lint
Build
Unit tests
Pricing tests
Booking tests
Availability tests
Authorization tests
RLS tests
Branch isolation tests
Magic-link tests
CMS tests
Localization tests
Payment foundation tests
Notification tests
Audit tests
Provisioning tests
Critical E2E flows
Basic accessibility checks
Production smoke tests
```

---

# 152. Future Testing Capabilities

Future versions may add:

* comprehensive cross-browser automation
* load testing
* penetration testing
* advanced accessibility testing
* mutation testing
* property-based testing
* disaster recovery drills
* large-scale synthetic datasets
* progressive rollout testing

---

# 153. Testing Architecture Summary

```text
              CLENQO Change
                    ↓
             OpenSpec Change
                    ↓
              Implementation
                    ↓
       ┌────────────┼────────────┐
       ↓            ↓            ↓
     Unit      Integration      RLS
       │            │            │
       └────────────┼────────────┘
                    ↓
                   E2E
                    ↓
                Security
                    ↓
                Build / CI
                    ↓
             Production Smoke
```

---

# 154. Golden QA Rule

> **CLENQO must verify behavior at the same boundaries where it enforces business rules and security. Critical pricing, booking, availability, financial, authorization, branch-isolation, provisioning, and customer workflows require automated regression protection, while production readiness also requires build, security, accessibility, performance, and operational verification.**
