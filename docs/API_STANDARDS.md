# CLENQO — API & Server Contracts

**Status:** Source of Truth
**Scope:** API boundaries, server actions, route handlers, domain services, validation, authorization, errors, idempotency, and external integrations
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL
**Primary Principle:** The server is authoritative for business operations and security.

---

## 1. Purpose

This document defines the contracts between CLENQO frontend surfaces and the server-side application.

It establishes:

* how requests enter the system;
* where authentication and authorization occur;
* how inputs are validated;
* how business logic is executed;
* how database access is performed;
* how external providers are integrated;
* how errors are represented;
* how mutations achieve idempotency;
* how branch scope is enforced;
* how API contracts evolve;
* how server-side operations are tested and observed.

The purpose is to ensure that CLENQO remains secure, deterministic, maintainable, and scalable as the number of branches increases.

---

# 2. Core Principle

The architecture follows:

```text
Client
  ↓
Server Action / Route Handler
  ↓
Authentication
  ↓
Authorization
  ↓
Input Validation
  ↓
Domain Service
  ↓
Transaction / Repository / RPC
  ↓
PostgreSQL / Supabase
  ↓
Domain Event / Outbox where required
  ↓
External Provider
```

The frontend is never authoritative for:

* permissions;
* prices;
* availability;
* booking status;
* employee assignment;
* payment status;
* financial totals;
* branch access;
* publication state;
* security decisions.

Client-side logic may improve UX, but the server must independently verify every important operation.

---

# 3. API Surface Strategy

CLENQO will initially use two primary server entry mechanisms:

1. **Server Actions**
2. **Route Handlers**

Both use the same domain services.

There must not be separate business implementations for server actions and API routes.

Example:

```text
Server Action
    ↓
bookingService.createBooking()

Route Handler
    ↓
bookingService.createBooking()
```

The domain service is the authoritative implementation.

---

# 4. Server Actions

Server Actions are preferred for operations originating directly from the CLENQO application UI.

Typical examples:

* create branch;
* update branch configuration;
* save CMS content;
* publish website page;
* create booking;
* cancel booking;
* assign employee;
* update job status;
* create invoice;
* create refund request;
* moderate review.

A Server Action should remain thin.

Required flow:

```text
Server Action
  ↓
Authenticate
  ↓
Authorize
  ↓
Validate input
  ↓
Call domain service
  ↓
Return typed result
```

Server Actions must not contain large business algorithms.

---

# 5. Route Handlers

Route Handlers are preferred when the operation needs an HTTP endpoint.

Examples:

```text
/api/booking/availability
/api/booking
/api/customer/magic-link
/api/webhooks/payment
/api/webhooks/email
/api/public/branches
```

Route Handlers are appropriate for:

* public APIs;
* webhook endpoints;
* external integrations;
* browser requests requiring HTTP semantics;
* future mobile/API clients;
* machine-to-machine communication.

Route Handlers must follow the same authorization and validation rules as Server Actions.

---

# 6. Public vs Protected APIs

Every endpoint must have an explicit access classification.

### Public

Examples:

* published branch website content;
* published services;
* public availability search;
* booking creation;
* customer magic-link request.

Public does not mean unrestricted.

Public endpoints must still implement:

* validation;
* rate limiting;
* abuse protection;
* branch validation;
* business-rule validation;
* idempotency where appropriate;
* safe error responses.

### Authenticated

Examples:

* customer booking management;
* cleaner job operations;
* employee profile;
* branch dashboard.

### Internal Authorized

Examples:

* pricing configuration;
* employee management;
* booking administration;
* financial operations;
* CMS publishing;
* reporting.

### HQ-only

Examples:

* create branch;
* archive branch;
* organization-wide configuration;
* master design system changes;
* cross-branch administrative operations.

---

# 7. Authentication

Authentication uses Supabase Auth.

Authentication must be established server-side before protected business operations are executed.

The server must determine:

```text
Who is the caller?
Is the session valid?
Is the account active?
What organization does the caller belong to?
What branch memberships exist?
What role does the caller have?
```

Frontend authentication state must never be treated as authoritative.

---

# 8. Authorization

Authorization is separate from authentication.

Every protected mutation must evaluate:

```text
identity
+
role
+
permission
+
organization scope
+
branch scope
+
resource ownership
```

Example:

```text
Cleaner
→ jobs.update
→ branch A
→ assigned job #123
```

A cleaner must not update job #124 merely because the job ID is known.

Similarly:

```text
Branch Manager
→ bookings.view
→ Branch A
```

must not automatically provide access to Branch B.

---

# 9. Active Context Is Not Authorization

The dashboard may have an active branch context.

For example:

```text
Active branch: Berlin
```

This is only a UI context.

It does not grant access to Berlin.

Authorization must independently verify that the user is allowed to access the branch.

Never use:

```text
branchId from client
```

as proof of permission.

---

# 10. Branch Scope

Branch-sensitive operations must resolve and validate branch scope server-side.

The server should establish branch context from trusted information such as:

* authenticated membership;
* authorized membership-branch relation;
* validated public branch slug;
* resource ownership;
* booking/job relationship.

Client-provided branch IDs are treated as untrusted input.

---

# 11. Organization Scope

Organization-level resources must be scoped to the authenticated organization.

The system must prevent:

```text
Organization A → Organization B data access
```

even if the caller discovers a valid UUID from another organization.

PostgreSQL RLS provides a second security boundary.

---

# 12. Validation

All externally supplied input must be validated.

CLENQO uses:

* TypeScript for compile-time typing;
* Zod for runtime validation.

Validation must occur server-side even if the frontend already validates the same form.

Example conceptual contract:

```ts
const CreateBookingSchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  scheduledStart: z.string().datetime(),
  customer: z.object({
    name: z.string().min(1).max(120),
    email: z.email(),
    phone: z.string().min(5).max(40),
  }),
});
```

Schemas should reject:

* malformed identifiers;
* impossible values;
* oversized strings;
* unsupported enum values;
* invalid dates;
* invalid quantities;
* unexpected structures.

---

# 13. Validation vs Business Rules

Validation answers:

> Is this input structurally valid?

Business logic answers:

> Is this operation allowed and possible?

Example:

```text
Zod:
scheduledStart is a valid datetime.

Availability domain:
scheduledStart is actually available.
```

Both checks are required.

---

# 14. Domain Services

Business operations belong in domain services.

Examples:

```text
branchService
websiteService
cmsService
serviceCatalogService
pricingService
availabilityService
bookingService
workforceService
jobService
paymentService
invoiceService
notificationService
qualityService
reportingService
auditService
```

A domain service may:

* validate business rules;
* load authoritative state;
* calculate values;
* perform transactions;
* create domain records;
* emit domain events;
* create audit records.

A domain service must not depend on React components.

---

# 15. Database Access

Database access must remain server-side.

Preferred hierarchy:

```text
UI
 ↓
Server Action / Route Handler
 ↓
Domain Service
 ↓
Database Access
 ↓
Supabase/PostgreSQL
```

Direct database calls from client components are prohibited for protected business operations.

---

# 16. Supabase Client Separation

The application should maintain separate clients for:

### Browser client

Used only for browser-safe Supabase functionality.

### Server client

Used for authenticated server-side operations respecting the current user context.

### Privileged server client

Used only when an operation genuinely requires elevated privileges.

The privileged client:

* must never be exposed to the browser;
* must never be initialized in client code;
* must only be used from trusted server execution;
* must perform explicit application authorization before use;
* must be audited for sensitive operations.

---

# 17. RLS

Supabase/PostgreSQL Row Level Security remains a mandatory defense layer.

Application authorization and RLS are complementary.

```text
Application Authorization
        +
PostgreSQL RLS
        =
Defense in Depth
```

RLS must protect against accidental or malicious cross-scope access.

---

# 18. Transactions

Operations that modify multiple related records must use transactions where atomicity matters.

Examples:

### Branch creation

```text
Create branch
→ create website
→ create locales
→ create pages
→ create sections
→ create navigation
→ create default configuration
→ record audit
```

Either the complete provisioning operation succeeds or the system must leave a recoverable provisioning state.

### Booking confirmation

```text
Validate availability
→ calculate price
→ create booking
→ create booking items
→ create booking event
→ create job
→ create notification event
→ audit
```

The exact transaction boundary depends on implementation, but business invariants must remain consistent.

---

# 19. Idempotency

Important mutations must support idempotency.

This is particularly important for:

* booking creation;
* payment processing;
* payment webhooks;
* refunds;
* branch provisioning;
* notification delivery;
* scheduled jobs;
* external callbacks.

Repeated execution of the same operation must not create duplicate business results.

Conceptually:

```text
idempotency_key
+
operation
+
scope
```

must identify a single logical operation.

---

# 20. Idempotency Examples

### Booking

If the customer submits the booking request twice because of a network retry, the system must not create two bookings unintentionally.

### Branch provisioning

If provisioning is retried, the system must detect already-created resources and continue safely.

### Payment webhook

If the provider sends the same webhook multiple times, the same payment state transition must not be applied repeatedly.

---

# 21. Concurrency

Availability and financial operations must be concurrency-safe.

Example:

```text
Customer A → requests 10:00
Customer B → requests 10:00
```

The system must not confirm both if only one operational capacity exists.

Final confirmation must re-check authoritative state.

Database constraints, transactions, locks, unique indexes, or other appropriate mechanisms should be used where necessary.

---

# 22. API Request Structure

Requests should use predictable structures.

Example:

```json
{
  "branchId": "...",
  "serviceId": "...",
  "scheduledStart": "...",
  "customer": {
    "name": "...",
    "email": "...",
    "phone": "..."
  }
}
```

Do not expose internal implementation details unnecessarily.

---

# 23. API Response Structure

Responses should be typed and predictable.

Successful responses should communicate the relevant result.

Conceptually:

```ts
type ApiSuccess<T> = {
  success: true;
  data: T;
};
```

Errors should use a consistent structure.

Conceptually:

```ts
type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    fieldErrors?: Record<string, string[]>;
  };
};
```

Internal stack traces and sensitive implementation details must never be returned to clients.

---

# 24. Error Categories

Errors should use stable machine-readable codes.

Examples:

```text
UNAUTHENTICATED
FORBIDDEN
INVALID_INPUT
NOT_FOUND
CONFLICT
RATE_LIMITED
BRANCH_INACTIVE
SERVICE_UNAVAILABLE
SLOT_UNAVAILABLE
BOOKING_NOT_CANCELLABLE
PRICE_CHANGED
PAYMENT_FAILED
PROVISIONING_FAILED
INVALID_WEBHOOK
INTERNAL_ERROR
```

The frontend may use error codes for predictable UX.

Error messages should remain safe and user-appropriate.

---

# 25. HTTP Semantics

Route Handlers should use appropriate HTTP status codes.

Typical mapping:

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
503 Service Unavailable
```

The exact status should reflect the actual failure category.

---

# 26. Public Booking API

The public booking flow must perform server-side:

```text
branch validation
→ service validation
→ service availability
→ customer input validation
→ address validation
→ scheduling validation
→ availability check
→ pricing calculation
→ final price snapshot
→ booking creation
```

The browser's displayed price must never be trusted.

---

# 27. Pricing Contract

The booking domain calls the pricing engine.

Conceptually:

```ts
const quote = await pricingService.calculateQuote(input);
```

The result should include:

* subtotal;
* duration;
* hourly/base rate;
* difficulty multiplier;
* add-ons;
* surcharges;
* discounts;
* tax;
* total;
* currency;
* pricing profile/version;
* structured breakdown.

The final booking stores the required price snapshot.

The pricing engine must remain deterministic.

---

# 28. Availability Contract

The availability service determines whether a requested slot is possible.

Conceptually:

```ts
const availability =
  await availabilityService.checkSlot(input);
```

The service considers:

* branch operating hours;
* service availability;
* employee capacity;
* employee availability;
* existing jobs;
* duration;
* buffers;
* blackout periods;
* lead time;
* advance booking limits;
* timezone/DST rules.

Availability returned to the UI is informational until final booking confirmation.

---

# 29. Booking Contract

The booking service owns booking state transitions.

Examples:

```text
create
confirm
reschedule
cancel
assign
start
complete
markNoShow
```

Invalid transitions must be rejected.

Example:

```text
completed → confirmed
```

must not be silently accepted.

---

# 30. Customer Magic-Link Contract

Customers do not require a password-based account for the core booking experience.

Magic-link operations must:

* use cryptographically secure tokens;
* have expiration;
* be single-use where appropriate;
* avoid exposing sensitive data;
* be rate-limited;
* be invalidated after appropriate use;
* provide narrowly scoped access.

A magic link must not become unrestricted access to the customer database.

---

# 31. CMS Contract

CMS mutations must follow:

```text
Authenticate
→ Authorize
→ Validate
→ Load draft
→ Apply change
→ Persist
→ Audit
```

Publishing must additionally:

```text
Validate publishability
→ publish
→ invalidate/revalidate cache
→ audit
```

CMS content is structured.

The API must not accept arbitrary:

```text
React code
JavaScript
CSS
SQL
server-side code
```

as content.

---

# 32. Branch Provisioning Contract

Branch creation is a platform-level operation.

Conceptually:

```ts
const branch =
  await branchService.createAndProvision(input);
```

Provisioning may create:

```text
branch
website
locales
pages
sections
navigation
SEO defaults
branch settings
```

Provisioning must be:

* transactional where appropriate;
* idempotent;
* observable;
* retryable;
* auditable.

A partially provisioned branch must have an explicit status rather than appearing active.

---

# 33. Payment Contracts

Payment operations must be isolated behind payment-provider adapters.

Conceptually:

```text
paymentService
      ↓
paymentProviderAdapter
      ↓
External Provider
```

The payment domain owns:

* payment intent/state;
* amount;
* currency;
* booking relationship;
* provider reference;
* reconciliation;
* refunds.

The provider does not own CLENQO business truth.

---

# 34. Webhook Contracts

Webhook endpoints must:

1. receive the raw request;
2. verify provider signature;
3. validate the event;
4. identify the provider event;
5. enforce idempotency;
6. persist the event where appropriate;
7. update domain state;
8. record audit/event information;
9. return the appropriate response.

Invalid webhook signatures must be rejected.

Webhook payloads must never be trusted simply because they came from an HTTP request.

---

# 35. Notification Contracts

Business domains should generate notification events rather than directly sending emails.

Preferred flow:

```text
Booking Service
   ↓
booking.confirmed
   ↓
Notification System
   ↓
Template
   ↓
Locale
   ↓
SES Adapter
   ↓
Delivery
```

This prevents business domains from becoming coupled to email providers.

---

# 36. External Provider Adapters

External services should be isolated behind adapters when practical.

Examples:

```text
EmailProvider
PaymentProvider
StorageProvider
MapsProvider
MessagingProvider
```

The domain should depend on an internal interface rather than provider-specific implementation details.

Example:

```ts
interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}
```

The Amazon SES implementation can then satisfy the interface.

---

# 37. API and Domain Boundaries

The API layer translates requests.

The domain layer makes business decisions.

The database persists authoritative state.

The provider adapter communicates externally.

Therefore:

```text
API
≠
Business Logic
```

and:

```text
Database
≠
UI State
```

---

# 38. Server-Side Business Logic Prohibition

The following are prohibited in UI components:

```text
price calculation
availability calculation
permission decisions
booking state transitions
payment totals
employee assignment rules
branch authorization
financial calculations
```

The UI may request these operations but may not define the authoritative result.

---

# 39. Form Contract

Frontend forms should use:

```text
React Hook Form
+
Zod
```

The frontend schema improves UX.

The same or equivalent authoritative schema must be enforced server-side.

The server must assume all browser input is untrusted.

---

# 40. File Upload Contracts

Uploads must use controlled server/storage flows.

The server must validate:

* file type;
* file size;
* ownership;
* branch scope;
* permitted purpose.

Examples:

```text
cleaning evidence photo
employee document
CMS image
customer attachment
```

Storage paths must not themselves grant authorization.

Signed URLs should be used where private access is required.

---

# 41. Audit Contract

High-value mutations should produce audit records.

Examples:

```text
branch.created
branch.activated
branch.suspended
website.published
pricing.updated
booking.cancelled
employee.assigned
payment.refunded
invoice.issued
review.moderated
```

Audit records should include appropriate:

* actor;
* organization;
* branch;
* resource;
* action;
* timestamp;
* result;
* request ID;
* safe metadata.

---

# 42. Request IDs

Server requests should support correlation/request IDs.

A request ID allows:

```text
frontend error
→ server log
→ domain operation
→ database event
→ provider call
→ audit record
```

to be connected during investigation.

The request ID should be safe to expose to the user when useful.

---

# 43. Logging

Logs must contain useful operational context without leaking sensitive information.

Do not log:

* passwords;
* authentication tokens;
* magic-link tokens;
* payment credentials;
* full sensitive personal data;
* secrets.

Prefer structured logs.

Example conceptual fields:

```text
timestamp
level
requestId
operation
organizationId
branchId
actorId
resourceId
duration
result
errorCode
```

---

# 44. Rate Limiting

Public and abuse-sensitive endpoints require rate limiting.

Priority endpoints include:

* booking creation;
* availability queries;
* magic-link requests;
* login/auth flows;
* public contact forms;
* password/auth recovery where applicable;
* webhook endpoints;
* expensive reporting/search endpoints.

Limits should be configurable and should avoid blocking normal customers.

---

# 45. Caching

Caching is allowed for read-heavy operations where correctness permits it.

Examples:

* published website content;
* public branch configuration;
* service catalog;
* public SEO content;
* informational availability data.

Do not cache sensitive data without explicit authorization-aware design.

Cache keys must account for relevant:

```text
organization
branch
locale
page
version
authorization scope
```

Mutations must invalidate or revalidate affected cached content.

---

# 46. API Versioning

The internal application API should avoid unnecessary versioning complexity initially.

When external or long-lived API consumers are introduced, explicit versioning may be used.

Potential structure:

```text
/api/v1/...
```

Breaking contract changes require an intentional migration strategy.

Do not introduce version numbers merely for appearance.

---

# 47. Contract Ownership

Each domain owns its server contract.

Examples:

```text
booking → booking schemas/actions/routes
pricing → pricing schemas/services
workforce → workforce schemas/services
payments → payment schemas/services
```

Shared infrastructure belongs under `lib/` where appropriate.

A feature must not silently modify another domain's business rules.

Cross-domain operations should call explicit domain services.

---

# 48. Type Sharing

Types may be shared between server and client when useful.

However:

```text
shared type
≠
trusted input
```

A TypeScript type does not validate runtime data.

Zod or equivalent runtime validation remains required for untrusted input.

---

# 49. Database RPC

PostgreSQL functions/RPC may be used when they provide clear benefits such as:

* atomic operations;
* database-enforced invariants;
* complex reporting;
* security-sensitive database operations;
* concurrency control;
* transactionally coupled operations.

RPC should not become an uncontrolled second application layer.

Business logic should remain understandable and intentionally placed.

---

# 50. Server Action Return Contracts

Server Actions should return typed results rather than throwing arbitrary strings or leaking raw database errors.

Conceptually:

```ts
type Result<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };
```

The exact implementation may evolve, but consistency is required.

---

# 51. Sensitive Operations

High-impact operations require stronger safeguards.

Examples:

* changing pricing;
* issuing refunds;
* modifying employee access;
* changing permissions;
* publishing global website content;
* creating/archiving branches;
* changing financial configuration;
* changing payment settings.

Depending on risk, these may require:

* elevated permission;
* recent authentication;
* confirmation;
* audit record;
* idempotency;
* approval workflow in future.

---

# 52. Customer Data Access

Customer-facing APIs must expose only information required for the customer experience.

Do not return internal:

* employee notes;
* internal pricing rules;
* operational comments;
* private incident data;
* internal audit records;
* unrelated customer information.

Customer data must remain scoped to the authenticated magic-link/session context.

---

# 53. Cleaner Data Access

Cleaner APIs must minimize exposure.

A cleaner should receive only what is required to execute assigned work.

Typical information:

* job details;
* service;
* address required for work;
* schedule;
* checklist;
* customer instructions;
* relevant contact information;
* operational notes;
* permitted evidence/photo capabilities.

They should not receive unrelated:

* financial records;
* other employees' private data;
* HQ administration;
* unrelated customers;
* global pricing configuration.

---

# 54. Reporting Contracts

Reporting endpoints should be read-oriented.

They should accept controlled filters such as:

```text
branch
service
employee
date range
booking status
payment status
```

The server must enforce the caller's reporting scope.

A Branch Manager requesting:

```text
branch=A
```

must not gain access to Branch B simply by changing the query parameter.

---

# 55. Search Contracts

Search endpoints must enforce:

```text
authentication
+
authorization
+
scope
+
safe query parsing
```

Search must not become an alternative path around RLS.

Future full-text/search infrastructure can be introduced without changing domain ownership.

---

# 56. Pagination

List endpoints should use explicit pagination.

Examples:

```text
page + limit
```

or cursor-based pagination for large datasets.

Maximum page sizes must be enforced server-side.

Clients must not be allowed to request unlimited records.

---

# 57. Sorting and Filtering

Sort/filter parameters must use allowlists.

Never interpolate arbitrary client-provided SQL fragments.

Example:

```text
allowedSort:
created_at
scheduled_start
status
customer_name
```

not:

```text
ORDER BY ${userInput}
```

---

# 58. Time and Currency

API contracts must use explicit representations.

Recommended:

```text
timestamps → ISO 8601
database → timestamptz
money → integer minor units or carefully controlled decimal representation
currency → ISO-style currency code
timezone → IANA timezone
```

Example:

```text
Europe/Berlin
EUR
```

Business calculations must not rely on browser locale.

---

# 59. Localization

API responses containing user-facing content should respect the requested/authorized locale where applicable.

Fallback follows the localization rules:

```text
requested locale
→ branch default
→ organization default
→ platform fallback
```

Technical identifiers remain language-neutral.

---

# 60. Notifications and API Responses

A successful business operation should not depend on immediate email delivery unless the business operation explicitly requires it.

Example:

```text
Booking confirmed
```

should not become:

```text
Booking failed
```

merely because SES temporarily failed.

Instead:

```text
booking succeeds
+
notification event recorded
+
email retries separately
```

---

# 61. Background Operations

Long-running work should not block normal HTTP requests unnecessarily.

Examples:

* email delivery;
* reminder scheduling;
* large reports;
* media processing;
* batch provisioning;
* future AI analysis.

These should use background processing when introduced.

The initial system may use database-backed queues/outbox patterns rather than a separate message broker.

---

# 62. API Security Checklist

Every protected mutation must answer:

```text
[ ] Is the caller authenticated?
[ ] Is the caller authorized?
[ ] Is organization scope verified?
[ ] Is branch scope verified?
[ ] Is resource ownership verified?
[ ] Is input validated?
[ ] Is the operation business-valid?
[ ] Is concurrency handled?
[ ] Is idempotency required?
[ ] Is the action audited?
[ ] Are sensitive fields protected?
[ ] Are errors safe?
```

---

# 63. Testing API Contracts

Each API/domain contract should have tests for:

### Happy path

Valid request produces expected result.

### Validation

Invalid input is rejected.

### Authorization

Unauthorized roles are rejected.

### Branch isolation

Cross-branch access is rejected.

### Organization isolation

Cross-organization access is rejected.

### State transitions

Invalid transitions are rejected.

### Idempotency

Repeated requests do not duplicate operations.

### Concurrency

Competing requests preserve business invariants.

### Failure recovery

External provider/database failures produce safe recoverable behavior.

---

# 64. Contract Testing

Critical boundaries should have explicit contract tests.

Priority:

```text
Booking ↔ Pricing
Booking ↔ Availability
Booking ↔ Workforce
Booking ↔ Notifications
Booking ↔ Payments
CMS ↔ Website
Branch ↔ Provisioning
Payment ↔ Provider
Notification ↔ SES
```

Changes to one domain must not silently break another domain's contract.

---

# 65. API Documentation

Important public/internal API contracts should be documented close to the implementation and/or in generated documentation where useful.

Documentation must remain synchronized with:

* Zod schemas;
* TypeScript types;
* route behavior;
* authorization requirements;
* error codes.

The source-of-truth documentation in `/docs` defines architecture.

Implementation-specific API details belong close to the feature.

---

# 66. Environment Configuration

Server integrations must read configuration from environment variables or secure platform configuration.

Examples:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SES configuration
payment provider credentials
webhook secrets
```

Secrets must never be committed to Git.

Public environment variables must never contain secrets.

---

# 67. Provider Failure Strategy

External providers are unreliable dependencies.

The system must distinguish:

```text
business operation succeeded
```

from:

```text
external delivery failed
```

Use retries, idempotency, reconciliation, and explicit statuses where appropriate.

Do not hide provider failures indefinitely.

---

# 68. API Performance

APIs should:

* select only required columns;
* paginate large collections;
* avoid N+1 queries;
* use appropriate indexes;
* cache safe read-heavy data;
* avoid unnecessary provider calls;
* avoid loading large CMS/media payloads unnecessarily.

Performance optimizations must not weaken authorization.

---

# 69. Observability

Important server operations should expose enough telemetry to answer:

```text
What happened?
Who initiated it?
For which organization?
For which branch?
Which resource?
When?
How long did it take?
Did it succeed?
Why did it fail?
Which external provider was involved?
```

Request IDs and structured logs should connect the relevant records.

---

# 70. API Contract Evolution

When a contract changes:

```text
Business decision
→ update documentation
→ OpenSpec change
→ schema/domain implementation
→ tests
→ migration if required
→ verification
→ archive
```

Agents must not silently alter API contracts during unrelated implementation work.

Breaking changes require explicit approval.

---

# 71. Initial API Priority

MVP should prioritize:

### Public

* branch website data;
* service catalog;
* availability;
* booking creation;
* booking confirmation;
* customer magic-link request;
* customer booking management.

### Admin

* branch creation/provisioning;
* branch activation;
* website/CMS editing;
* services;
* pricing;
* bookings;
* employees;
* jobs;
* basic reporting.

### Cleaner

* assigned jobs;
* job status;
* check-in/out;
* checklist;
* notes;
* evidence photos.

### Finance

* payment status;
* invoices;
* manual payment recording;
* refund foundation.

### Notifications

* booking confirmation;
* reminders;
* assignment notifications;
* payment/invoice notifications.

---

# 72. Future API Capabilities

Future extensions may include:

* public partner API;
* mobile applications;
* advanced integrations;
* WhatsApp;
* SMS;
* accounting integrations;
* calendar integrations;
* advanced search;
* external booking partners;
* franchise APIs;
* custom domains;
* AI-powered operational services.

These should extend existing domain contracts rather than bypassing them.

---

# 73. Architectural Rules

The following are mandatory:

1. The server is authoritative.
2. The client is untrusted.
3. Authentication and authorization are separate.
4. Active branch context is not authorization.
5. Organization and branch scope must be enforced.
6. RLS remains a defense layer.
7. Zod validates runtime input.
8. Business logic belongs in domain services.
9. Server Actions and Route Handlers share domain services.
10. External providers use adapters where appropriate.
11. Important mutations are idempotent.
12. Financial and availability operations are concurrency-safe.
13. Sensitive operations are audited.
14. Errors are typed and safe.
15. Secrets remain server-side.
16. Customer and cleaner data is minimized.
17. APIs cannot bypass domain rules.
18. APIs cannot bypass authorization.
19. APIs cannot become a second source of business truth.
20. Documentation and OpenSpec remain synchronized with implementation.

---

# 74. Definition of Done

An API/server feature is complete only when:

* [ ] Contract is documented.
* [ ] Input schema exists.
* [ ] Authentication is implemented where required.
* [ ] Authorization is implemented.
* [ ] Organization scope is enforced.
* [ ] Branch scope is enforced where applicable.
* [ ] RLS is verified.
* [ ] Domain service owns business logic.
* [ ] Database operations are correct.
* [ ] Transactions are used where required.
* [ ] Idempotency is implemented where required.
* [ ] Errors use stable codes.
* [ ] Sensitive data is protected.
* [ ] Audit events exist for important mutations.
* [ ] External providers are isolated behind adapters where appropriate.
* [ ] Unit/integration/security tests exist.
* [ ] Concurrency behavior is verified where relevant.
* [ ] Documentation is synchronized.
* [ ] OpenSpec acceptance criteria pass.
* [ ] Production behavior is observable.

---

# 75. Golden API Rule

> **Every request is untrusted, every important operation is server-authoritative, every permission is verified server-side, every branch boundary is enforced, every critical mutation is deterministic and idempotent, and every important change is traceable.**

CLENQO's API layer must remain a controlled boundary between users, business logic, data, and external systems.

It must make the platform safer and more predictable—not merely provide endpoints.
