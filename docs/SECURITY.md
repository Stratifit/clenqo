# CLENQO Authentication & Authorization

## 1. Purpose

This document defines authentication, authorization, roles, permissions, branch scope, customer access, and database security for CLENQO.

The security model must protect:

* HQ administration
* branch operations
* public website CMS
* customer data
* employee data
* bookings
* payments
* invoices
* media
* internal notes
* operational information

The system must enforce authorization at multiple layers.

---

# 2. Security Principle

> **Authentication determines who the user is. Authorization determines what that user is allowed to do.**

A successful login does not automatically grant access to CLENQO data.

Every protected operation must be authorized according to:

```text
User
 ↓
Organization membership
 ↓
Role
 ↓
Permission
 ↓
Branch scope
 ↓
Resource
```

---

# 3. Authentication Provider

CLENQO uses:

**Supabase Auth**

Supabase Auth is responsible for:

* user authentication
* sessions
* password handling where applicable
* email verification
* password reset
* authentication tokens
* OAuth providers if introduced later

CLENQO must not implement its own password storage.

---

# 4. Application Identity

Supabase Auth provides the authenticated user ID.

The application database stores:

```text
profiles
memberships
membership_branches
```

Conceptually:

```text
Supabase Auth User
       ↓
Profile
       ↓
Membership
       ↓
Role
       ↓
Branch Scope
```

---

# 5. User Categories

CLENQO has two major access categories:

```text
Internal users
External customers
```

Internal users include:

* HQ Admin
* HQ Staff
* Branch Manager
* Cleaner

Customers use the public booking and customer-management experience.

---

# 6. Internal Roles

Initial roles:

```text
hq_admin
hq_staff
branch_manager
cleaner
```

These roles must be represented consistently throughout the application.

Do not scatter role strings throughout frontend components.

---

# 7. HQ Admin

HQ Admin is the highest operational role.

Default scope:

```text
Organization-wide
```

HQ Admin may manage:

* organizations
* branches
* branch provisioning
* websites
* CMS
* services
* pricing
* customers
* bookings
* employees
* jobs
* payments
* invoices
* notifications
* reviews
* reports
* settings
* users
* permissions

HQ Admin can access all branches belonging to the organization.

---

# 8. HQ Staff

HQ Staff is an internal role with configurable permissions.

A staff member may receive access to:

```text
CMS
Bookings
Customers
Employees
Finance
Reports
Support
```

but does not automatically receive all HQ Admin privileges.

Examples:

```text
CMS Manager
Booking Staff
Finance Staff
Operations Staff
```

The exact permission combinations are configurable.

---

# 9. Branch Manager

Branch Manager manages one or more assigned branches.

Default scope:

```text
Assigned branch(es)
```

Branch Manager may manage, depending on permissions:

* branch website
* CMS
* local services
* pricing configuration
* bookings
* customers
* employees
* jobs
* schedules
* reviews
* local reports

A Branch Manager must never automatically receive organization-wide access.

---

# 10. Cleaner

Cleaner is an operational role.

Default access is limited to:

* assigned jobs
* relevant schedules
* job details
* customer information required to perform the job
* check-in/check-out
* checklist
* job notes
* permitted job photos
* incident reporting

Cleaner access should follow the principle:

> **Only the information required to perform the assigned work should be accessible.**

A cleaner does not receive access to:

* pricing administration
* financial reports
* all customers
* CMS administration
* employee management
* organization settings

unless explicitly authorized by a future role/permission design.

---

# 11. Customer Access

Customers do not need a traditional dashboard account during the initial product phase.

The customer experience is:

```text
Public Website
 ↓
Booking
 ↓
Confirmation
 ↓
Secure Management Link
```

Customers can access their own booking information through a secure magic-link mechanism.

---

# 12. Customer Authorization

Customer access must be scoped to explicitly authorized resources.

A customer management link must not provide access to:

```text
other customers
other bookings
internal notes
employee information
financial administration
branch administration
```

The token must identify a narrowly scoped resource or secure customer session.

---

# 13. No Security Through URLs

The following is not authorization:

```text
clenqo.com/admin/branches/berlin
```

or:

```text
?branch=berlin
```

or:

```text
?booking_id=123
```

A user changing the URL must not gain access to another resource.

Authorization must be enforced server-side and at the database layer.

---

# 14. Permission Model

Roles provide broad identity.

Permissions provide specific capabilities.

Examples:

```text
website.view
website.edit
website.publish

pages.view
pages.create
pages.edit
pages.archive
pages.publish

media.view
media.upload
media.manage

seo.view
seo.edit

bookings.view
bookings.create
bookings.edit
bookings.cancel
bookings.override

customers.view
customers.edit

employees.view
employees.manage

jobs.view
jobs.assign
jobs.manage

pricing.view
pricing.edit

payments.view
payments.manage

invoices.view
invoices.manage

reports.view
reports.export
reports.financial
reports.workforce
reports.customer
reports.quality
cross_branch
reports.manage

audit.view
audit.view_branch
audit.view_sensitive
audit.export

search.use

services.view
services.edit

# Consolidated permission catalog (audit fix CRITICAL-1)
# This is the single authoritative permission registry for CLENQO.
# Permission lists in other documents (BRANCH_SYSTEM, PRICING_ENGINE,
# QUALITY_SYSTEM, PAYMENT_SYSTEM, LOCALIZATION, ADMIN_SYSTEM,
# REPORTING_SYSTEM, AUDIT_SYSTEM, SEARCH_DISCOVERY) are illustrative
# and defer to this catalog. Verbs follow resource.action.
#
# Resolved verb conflicts from the documentation audit:
# - employees.edit and employees.manage are aliases for the same
#   capability; the canonical form is employees.manage.
# - payments.manage is expanded into the explicit payments.* family
#   below; payments.manage is retained as a composite grant.
# - quality.manage is the composite grant; the canonical granular
#   forms are quality.create_check, quality.manage_issue,
#   quality.resolve_issue, quality.report.
# - pricing.create, pricing.archive, and pricing.override are added
#   here to match PRICING_ENGINE's versioning workflow.
#
# Canonical catalog:
#
# website.view / website.edit / website.publish
# pages.view / pages.create / pages.edit / pages.archive / pages.publish
# media.view / media.upload / media.manage
# seo.view / seo.edit
# bookings.view / bookings.create / bookings.edit / bookings.cancel /
#   bookings.override (BD-2: cancellation-fee override, HQ Admin only)
# customers.view / customers.edit
# employees.view / employees.manage
# jobs.view / jobs.assign / jobs.manage
# pricing.view / pricing.create / pricing.edit / pricing.publish /
#   pricing.archive / pricing.override
# payments.view / payments.create / payments.capture / payments.refund /
#   payments.record_manual / payments.reconcile / payments.manage (composite)
# invoices.view / invoices.manage
# quality.view / quality.create_check / quality.manage_issue /
#   quality.resolve_issue / quality.report / quality.manage (composite)
# branches.view / branches.create / branches.edit / branches.activate /
#   branches.suspend / branches.archive
> **Resolved (BD-A1 + auth/context/invitation decisions — Change 8 decision record):**
> *Bootstrap (BD-A1).* The first HQ Admin is created through a one-time
> `/setup` flow permitted only while **zero active `hq_admin` memberships**
> exist. Setup requires (a) a Supabase Auth user created beforehand through
> the Supabase Auth admin surface (dashboard/API — the established precedent),
> and (b) a one-time deployment-held `SETUP_TOKEN` env secret presented to the
> setup action. Setup creates the initial organization (if none) and the
> `hq_admin` membership transactionally, consumes the token, and writes an
> audit event. After the first active HQ Admin exists, `/setup` fails closed
> permanently (stable error, attempt audited); a CLI/script fallback with the
> same zero-HQ-admin invariant remains the documented recovery path. Setup is
> never a public application feature and is disabled-by-absence-of-preconditions
> — no "make me admin" endpoint can exist.
> *Context model.* V1 is a single-organization platform; `resolveActor`'s
> deterministic oldest-active-membership resolution is authoritative for V1
> and multi-organization users are a documented future capability. Branch
> context is resolved server-side on every request (`hasBranchScope` via
> `membership_branches`); UI selection is only a view preference and never
> carries authorization. Branch-access changes take effect on the next
> request. Staff sessions use Supabase Auth session cookies exclusively;
> `middleware.ts` refreshes sessions and redirects unauthenticated `/admin/*`
> requests to the login flow, with the server-action/domain layer remaining
> the authoritative guard (route protection is UX, not the security boundary).
> *Invitation.* V1 invitations use the Supabase Auth admin invite primitive
> (`inviteUserByEmail`) invoked from a server action gated by `users.invite`.
> Invite creates the `memberships` row (+ `membership_branches` scope) in one
> transaction with an audit event; existing users are granted membership
> directly without re-invite; resend re-invokes the primitive. Deactivation
> sets `memberships.status = 'inactive'` and is audited; rows are never
> deleted.

# users.view / users.invite / users.edit / users.deactivate
# reports.view / reports.export / reports.financial / reports.workforce /
#   reports.customer / reports.quality / reports.cross_branch /
#   reports.manage
# audit.view / audit.view_branch / audit.view_sensitive / audit.export
# search.use
# services.view / services.edit
# settings.manage

The exact list can grow over time.

### Open security decision — scheduling override (2026-09)

`SCHEDULING_SYSTEM.md` §56 describes a constrained override capability for
authorized users. Per scheduling decision **S17**, this capability is
**deferred to a later dedicated security decision**: no override permission
is created by Change 3, and no existing catalog permission is silently
remapped to grant override power. Until that decision is made, V1 scheduling
does not implement constraint overrides.

Branch scheduling configuration (operating hours, schedule exceptions,
scheduling parameters, slot-hold administration) is governed by the existing
catalog permissions **`branches.view`** / **`branches.edit`** — no new
permission family is introduced.

### Resolved security decision — cancellation-fee override (2026-09)

Owner decision **BD-2.4** added the dedicated permission **`bookings.override`**
to the catalog: waiving or reducing a calculated cancellation fee requires it,
and generic `bookings.edit` / `bookings.cancel` do not authorize an override.
Role mapping (V1, explicit owner decision): `hq_admin` YES; `hq_staff` NO;
`branch_manager` NO; `cleaner` NO; customers NO. Every override is audited,
preserving at minimum: actor, timestamp, booking, original calculated fee,
final fee, and reason. The application-level role mapping is updated with the
Booking implementation.

---

# 15. Permission Naming

Permission identifiers should follow:

```text
resource.action
```

Examples:

```text
bookings.view
bookings.edit
bookings.cancel
website.edit
website.publish
employees.manage
```

Avoid ambiguous permissions such as:

```text
admin_access
full_access
can_do_everything
```

except for carefully controlled system-level roles.

---

# 16. Permission Groups

Permissions may be grouped into modules:

```text
Website
Bookings
Customers
Services
Pricing
Employees
Jobs
Finance
Reports
Settings
```

This makes administration easier.

---

# 17. Role-Permission Mapping

The system should have a clear relationship between roles and permissions.

Conceptually:

```text
Role
 ↓
Permissions
```

Example:

```text
Branch Manager
 ├── website.view
 ├── website.edit
 ├── website.publish
 ├── bookings.view
 ├── bookings.edit
 ├── customers.view
 ├── employees.view
 └── jobs.manage
```

The exact default permissions should be implemented deliberately.

---

# 18. Branch Scope

Permissions and branch scope are separate.

Example:

```text
Permission:
bookings.edit

Scope:
Berlin
```

means:

```text
Can edit bookings
+
only Berlin bookings
```

A user with:

```text
bookings.edit
```

does not automatically receive access to every branch.

---

# 19. Organization Scope

HQ roles can operate at organization scope.

Conceptually:

```text
Organization
 ├── Branch A
 ├── Branch B
 └── Branch C
```

HQ Admin:

```text
Organization-wide
```

Branch Manager:

```text
Branch A
```

Cleaner:

```text
Assigned jobs
```

---

# 20. Membership Model

A user's organization relationship is represented through:

```text
memberships
```

Conceptual fields:

```text
id
organization_id
user_id
role
status
```

A membership belongs to one organization.

---

# 21. Branch Membership Scope

When required:

```text
membership_branches
```

maps a membership to one or more branches.

Example:

```text
User
 ↓
Branch Manager
 ↓
Berlin
Munich
```

The user may therefore manage two branches without receiving access to unrelated branches.

---

# 22. Multiple Organizations

The architecture should remain capable of supporting multiple organizations.

A user may potentially belong to:

```text
Organization A
Organization B
```

This is not required for the first operational release but must not be architecturally impossible.

Authorization must always resolve the active organization context.

---

# 23. Active Context

For users with multiple possible scopes, the application may maintain an active context:

```text
organization
branch
```

Example:

```text
Organization:
CLENQO

Branch:
Berlin
```

Changing the active branch changes the working context.

It does not change the user's actual permissions.

---

# 24. Context Is Not Authorization

A client may send:

```text
branch_id = Berlin
```

but the server must independently verify:

```text
Does this user have permission for Berlin?
```

Client-selected context is a request parameter, not proof of authorization.

---

# 25. Supabase RLS

Row Level Security is mandatory for protected data.

RLS provides database-level enforcement.

Even if an application endpoint has a programming error, RLS should provide an additional security boundary.

---

# 26. RLS Principles

RLS policies should answer:

1. Who is the authenticated user?
2. Which organization(s) can they access?
3. Which branch(es) can they access?
4. What role/permission do they have?
5. What resource are they attempting to access?

---

# 27. Branch-Scoped RLS

For a typical branch-scoped table:

```text
bookings
```

the database should verify:

```text
booking.branch_id
        ↓
user branch access
```

A branch manager for Berlin must receive no rows for Munich.

---

# 28. Organization-Scoped RLS

For organization-level tables:

```text
organizations
```

access should be determined through organization membership.

HQ users may access their organization.

Users from unrelated organizations must receive no access.

---

# 29. Resource-Level Authorization

Some resources require more than branch access.

Example:

```text
jobs
```

A cleaner may belong to the correct branch but should only access assigned jobs.

Therefore:

```text
Cleaner
 ↓
Branch access
 +
Job assignment
```

must both be considered.

---

# 30. Customer RLS

Customer-facing access must be carefully isolated.

A customer should not receive broad table access simply because they know a booking ID.

Customer access may use:

* secure server-side resolution
* scoped tokens
* controlled RPC/functions
* dedicated customer policies

The exact mechanism should be selected during implementation.

---

# 31. Service Role

Supabase service-role credentials have elevated privileges.

They must:

* exist only server-side
* never be sent to browsers
* never be committed to Git
* never be embedded in public JavaScript
* be stored securely in deployment environment variables

The service role must be used sparingly.

---

# 32. Server-Side Authorization

Every sensitive server action or route handler must perform authorization.

Example:

```text
Request
 ↓
Authenticated user
 ↓
Permission check
 ↓
Branch scope check
 ↓
Input validation
 ↓
Business logic
 ↓
Database
```

Do not assume RLS alone makes the application logic correct.

---

# 33. Authorization Before Business Logic

Authorization must occur before executing sensitive operations.

Example:

```text
Edit Pricing
 ↓
Authenticate
 ↓
Check pricing.edit
 ↓
Check branch scope
 ↓
Validate data
 ↓
Update
```

Do not update first and check afterward.

---

# 34. Authentication State

Protected dashboard routes should require an authenticated session.

Unauthenticated users should be redirected to the appropriate authentication flow.

Public website routes remain accessible without authentication.

---

# 35. Session Security

Authentication sessions must use the secure mechanisms provided by Supabase Auth.

The application must not create insecure custom session storage.

Sensitive session information should not be exposed unnecessarily to client-side JavaScript.

---

# 36. Email Verification

Internal accounts should use email verification according to the organization's security policy.

High-privilege accounts should require stronger security controls.

---

# 37. Password Reset

Password reset is handled through Supabase Auth.

CLENQO must not implement custom password-reset tokens unless a specific requirement justifies it.

---

# 38. MFA

Multi-factor authentication should be considered mandatory or strongly encouraged for high-privilege roles.

Priority:

```text
HQ Admin
HQ Staff with sensitive permissions
Branch Manager
Cleaner
```

The final enforcement policy can be introduced progressively.

---

# 39. High-Risk Actions

Certain operations should require additional protection.

Examples:

```text
delete/archiving critical records
changing user permissions
changing payment configuration
changing pricing
publishing major website changes
deactivating employees
```

Possible future controls:

* reauthentication
* MFA
* confirmation dialogs
* audit logging

---

# 40. CMS Authorization

The dashboard CMS uses the same authorization model as operations.

Example:

```text
website.edit
```

allows editing.

```text
website.publish
```

controls publishing.

Therefore a user may be able to:

```text
edit content
```

without being able to:

```text
publish content
```

if the organization chooses that workflow.

---

# 41. CMS Branch Isolation

A Branch Manager assigned to Berlin:

```text
Can edit:
Berlin website

Cannot edit:
Munich website
Hamburg website
```

This must be enforced by RLS and server-side authorization.

---

# 42. Global Content Protection

Global CLENQO content should have restricted permissions.

Examples:

```text
global_content.edit
brand.manage
template.manage
```

should normally be limited to HQ-level roles.

---

# 43. Pricing Authorization

Pricing changes are sensitive.

Permissions should distinguish:

```text
pricing.view
pricing.edit
pricing.publish
```

where practical.

A branch may be allowed to manage local pricing without changing organization-wide pricing.

---

# 44. Financial Authorization

Financial information requires restricted access.

Examples:

```text
payments.view
payments.manage
invoices.view
invoices.manage
financial_reports.view
```

Cleaners should not receive financial access by default.

---

# 45. Employee Data Authorization

Employee information should be limited according to role.

A cleaner should not automatically see:

* other cleaners' private data
* payroll information
* HR records
* private employee documents

Managers should only receive information necessary for operations.

---

# 46. Customer Data Minimization

Users should only receive the customer information necessary for their job.

For example:

A cleaner may need:

```text
customer name
service address
contact number
job instructions
```

but does not necessarily need:

```text
full customer history
payment history
marketing preferences
internal notes
```

unless operationally required.

> **Resolved (BD-C1 — Change 7 decision record):** the cleaner-visible customer
> field set is fixed as customer first name, last initial, phone number,
> service address, and execution instructions — implemented through the
> minimized `customer_display` job snapshot (extended only with the phone).
> Email, payment data, unrelated customer history, internal notes, and other
> workers' information never reach the Cleaner PWA; access remains bound to
> the cleaner's currently active assignment, and operational access ends when
> the assignment is cancelled or reassigned. **Implemented (Change 7):** the
> minimized view is produced by the Worker-owned `cleanerView` service over
> the job snapshot + phone; RLS restricts cleaner reads to jobs with their
> own active assignment (`tests/db/cleaner-rls.test.ts`).

---

# 47. Internal Notes

Internal notes must never be exposed to customers.

Examples:

```text
booking.internal_notes
customer.internal_notes
job.internal_notes
```

must remain protected.

---

# 48. Media Authorization

Media access must follow ownership.

Example:

```text
Branch A private job photo
```

must not become publicly accessible simply because someone knows its storage path.

Storage policies and database permissions must align.

---

# 49. Public Content

Published public website content is intentionally public.

It may be accessed without authentication.

However:

```text
draft content
private media
internal notes
unpublished pages
```

must remain protected.

---

# 50. Draft Preview Security

Draft preview must use a secure mechanism.

A public visitor must not be able to access:

```text
/preview?draft=true
```

without authorization.

Preview tokens must be:

* difficult to guess
* short-lived where practical
* scoped
* revocable where necessary

---

# 51. Audit Logging

Sensitive authorization and administrative operations should be audited.

Examples:

```text
user_role_changed
permission_changed
branch_access_changed
pricing_changed
content_published
payment_updated
invoice_voided
```

Audit logs must identify:

```text
actor
organization
branch
action
entity
timestamp
```

---

# 52. Failed Authorization

When access is denied, the system should return an appropriate generic error.

Do not expose sensitive information such as:

```text
"This branch exists but you don't have access."
```

when that itself would reveal protected information.

Use appropriate responses such as:

```text
Unauthorized
Forbidden
Not Found
```

depending on the situation.

---

# 53. Input Validation

Authorization does not replace validation.

Every sensitive operation should use:

```text
Authentication
+
Authorization
+
Validation
+
Business rules
```

Zod should be used for application input validation where practical.

---

# 54. SQL Injection Protection

Application queries must use parameterized/database-safe APIs.

Never construct SQL from raw user input.

CMS fields must never be interpreted as SQL.

---

# 55. XSS Protection

CMS content must be sanitized and controlled.

Administrators must not be able to inject arbitrary JavaScript into public pages through ordinary content fields.

Rich text must use a controlled format.

---

# 56. CSRF and Request Security

State-changing operations must use the security mechanisms appropriate to the Next.js/Supabase architecture.

Sensitive server actions should not blindly trust client requests.

---

# 57. Rate Limiting

Rate limiting should be applied where abuse is possible.

Priority areas include:

* authentication
* magic links
* booking creation
* contact forms
* public APIs
* notification endpoints
* payment webhooks where appropriate

---

# 58. Magic Link Security

Customer magic links must:

* use cryptographically secure random values
* expire
* have limited scope
* be protected from brute-force attempts
* avoid exposing sensitive data in the token itself

Tokens should be stored securely.

---

# 59. Booking Security

A customer must not be able to modify a booking simply by changing:

```text
booking_id
```

The system must verify:

```text
customer authorization
+
booking ownership
+
allowed booking state
```

before modification.

---

# 60. Booking State Authorization

Not every user can perform every transition.

Example:

```text
Customer:
pending → cancellation request

Branch Manager:
pending → confirmed
confirmed → cancelled

Cleaner:
assigned → in_progress
in_progress → completed
```

The exact state-transition permissions will be defined by the booking domain.

---

# 61. Job Security

Cleaners should only be able to operate on jobs assigned to them or explicitly made available to them.

They must not be able to manipulate arbitrary job IDs.

---

# 62. Payment Security

CLENQO should not store raw card numbers or sensitive payment credentials.

Payment providers should handle payment credentials.

The database stores safe references such as:

```text
provider
provider_payment_id
status
amount
currency
```

---

# 63. Webhook Security

Payment and integration webhooks must verify authenticity.

The application must not trust:

```text
POST /api/payment/webhook
```

merely because the request exists.

Webhook signatures/provider verification must be implemented where supported.

---

# 64. Permission Changes

Changing a user's role or permissions is a sensitive action.

The system should:

1. authenticate actor
2. authorize actor
3. validate target
4. validate new permissions
5. perform change transactionally
6. write audit record

---

# 65. Last Admin Protection

The system should prevent accidentally removing the organization's final active HQ Admin where doing so would lock the organization out.

This invariant should be enforced at the application/database level.

---

# 66. Deactivated Users

When a user is deactivated:

```text
status = inactive
```

they must lose access to protected resources.

Historical records remain associated with the original user where appropriate.

Do not delete historical actor references simply because an account becomes inactive.

---

# 67. Employee Termination

When an employee leaves:

```text
employee.status = terminated
```

Historical:

* jobs
* assignments
* incidents
* audit records

must remain traceable.

Future assignments should be blocked.

---

# 68. Branch Deactivation

When a branch is deactivated:

* public website may become unavailable or display a controlled state
* new bookings should be blocked
* historical bookings remain accessible to authorized staff
* financial records remain
* audit records remain
* employee history remains

Branch deactivation must not cascade-delete historical business data.

---

# 69. Organization Deactivation

Organization-level deactivation is a high-risk operation.

It should be:

* restricted
* audited
* deliberate
* reversible where practical

Historical records must remain protected and recoverable according to the data lifecycle policy.

---

# 70. Security Boundaries

CLENQO has several security boundaries:

```text
Authentication
     ↓
Application Authorization
     ↓
Branch/Organization Scope
     ↓
RLS
     ↓
Storage Policies
     ↓
Business Rules
```

No single layer should be treated as the only security mechanism.

---

# 71. Secure Request Pattern

Recommended pattern:

```text
Request
  ↓
Authenticate
  ↓
Resolve organization
  ↓
Resolve branch
  ↓
Check permission
  ↓
Check resource ownership/scope
  ↓
Validate input
  ↓
Execute domain operation
  ↓
Database transaction
  ↓
Audit
```

---

# 72. Frontend Security Rule

Frontend checks are for UX.

Example:

```tsx
if (!canEdit) {
  hideEditButton();
}
```

is useful.

But it is not security.

The server must still reject:

```text
unauthorized edit request
```

---

# 73. API Security

All API endpoints must explicitly define whether they are:

```text
public
authenticated
role-restricted
permission-restricted
branch-scoped
```

No endpoint should accidentally inherit an overly broad authorization policy.

---

# 74. Public API

Public APIs may include:

* published website content
* public service information
* booking availability where intentionally exposed
* booking creation
* contact forms

Public endpoints must be rate-limited and validated.

---

# 75. Internal API

Internal endpoints may include:

* branch management
* CMS editing
* employee management
* pricing
* payments
* reports

These require authentication and appropriate authorization.

---

# 76. Service-to-Service Access

Future background workers and integrations should use narrowly scoped credentials.

Do not give every background process unrestricted service-role access.

Where possible, use purpose-specific operations.

---

# 77. Secrets Management

Secrets must be stored in:

* deployment environment variables
* secure secret-management systems

Never commit:

```text
Supabase service role key
payment secrets
SES credentials
webhook secrets
API keys
```

to Git.

---

# 78. Logging Security

Logs must not contain:

* passwords
* authentication tokens
* magic-link tokens
* card information
* unnecessary personal data
* provider secrets

Use safe identifiers.

---

# 79. Privacy

CLENQO should follow data-minimization principles.

Only collect information needed for:

* service delivery
* booking
* communication
* operations
* legal/accounting requirements
* legitimate analytics

---

# 80. Data Export

Future customer/admin workflows may support controlled data export.

Exports must respect:

* authorization
* branch scope
* privacy
* sensitive fields
* audit requirements

---

# 81. Data Deletion

Deletion must respect operational and legal requirements.

Do not destructively delete:

* completed bookings
* payments
* invoices
* audit records

simply because a user requests account deletion.

The final retention policy must be defined according to applicable legal requirements.

---

# 82. Security Testing

Security tests must verify:

### Authentication

* unauthenticated access denied
* expired sessions rejected
* deactivated users rejected

### Authorization

* roles work
* permissions work
* branch isolation works
* organization isolation works

### RLS

* direct unauthorized queries fail
* cross-branch access fails
* cross-organization access fails

### Customer

* booking ownership is enforced
* magic links cannot access unrelated bookings

### CMS

* drafts remain private
* branch managers cannot edit other branches
* protected global content cannot be modified

---

# 83. Security Development Rule

Security must be implemented alongside each feature.

Do not build:

```text
Feature
 ↓
Security later
```

Prefer:

```text
Feature
 ↓
Data model
 ↓
Authorization
 ↓
RLS
 ↓
UI
 ↓
Tests
```

---

# 84. Authorization Documentation Rule

Every new protected feature must document:

```text
Who can view?
Who can create?
Who can edit?
Who can delete/archive?
Who can publish/approve?
Which branches can they access?
Which organization scope applies?
```

---

# 85. Initial Authorization MVP

The first security implementation should provide:

```text
Supabase Auth
Profiles
Memberships
Roles
Branch scope
RLS
Server-side authorization
CMS permissions
Operational permissions
Customer magic-link access
Audit logging
```

This is the minimum foundation for a safe production system.

---

# 86. Future Security Features

Potential future additions:

* MFA enforcement
* granular permission management UI
* session/device management
* IP restrictions for HQ
* advanced audit search
* security alerts
* anomaly detection
* SSO
* enterprise identity providers
* regional data policies

These should be added according to actual business needs.

---

# 87. Golden Authorization Rule

> **No user, branch, role, URL, frontend state, or API request should ever be trusted as proof of access by itself. CLENQO must authenticate identity, verify permission and scope, enforce database-level isolation, validate the operation, and audit sensitive changes.**
