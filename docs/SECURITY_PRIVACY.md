# CLENQO Security and Privacy

## 1. Purpose

CLENQO handles customer, employee, booking, operational, financial, website, and administrative data.

Security and privacy must therefore be designed into the platform from the beginning.

This document defines the security and privacy requirements for:

* authentication
* authorization
* branch isolation
* customer access
* employee access
* database security
* Supabase
* storage
* secrets
* APIs
* public booking
* magic links
* payments
* notifications
* audit
* privacy
* data retention
* backups
* incident response
* monitoring
* development
* deployment

---

# 2. Core Security Principle

> **Security is a system property, not a feature.**

Every domain must follow the same security model.

Business functionality must never bypass:

```text
Authentication
 ↓
Authorization
 ↓
Validation
 ↓
Business Rules
 ↓
Database / External Operation
```

---

# 3. Security Objectives

CLENQO must protect:

```text
Confidentiality
Integrity
Availability
Privacy
Accountability
```

---

# 4. Threat Model

The architecture should assume that attackers may attempt:

* unauthorized account access
* privilege escalation
* cross-branch data access
* customer data theft
* booking abuse
* fake bookings
* payment manipulation
* magic-link theft
* API abuse
* malicious uploads
* CMS injection
* XSS
* CSRF
* SQL injection
* webhook forgery
* credential theft
* denial of service
* insider misuse

---

# 5. Zero Trust Principle

No request should be trusted merely because it originated from:

```text
the frontend
an authenticated session
a dashboard
a known branch
an internal route
```

Every sensitive operation must be independently authorized.

---

# 6. Authentication

CLENQO uses Supabase Auth for internal authentication.

Authentication establishes:

```text
Who is the user?
```

It does not determine:

```text
What can the user do?
```

---

# 7. Authorization

Authorization determines:

```text
What can this user access?
What can this user change?
Which organization?
Which branch?
Which resource?
```

Authorization follows `SECURITY.md`.

---

# 8. Internal Roles

Initial internal roles:

```text
hq_admin
hq_staff
branch_manager
cleaner
```

Customer access is handled separately.

---

# 9. Branch Scope

Branch access must always be explicit.

A user may have:

```text
Branch A
```

without having:

```text
Branch B
```

access.

---

# 10. Active Context Is Not Authorization

Selecting a branch in the dashboard does not grant access.

The server must independently verify authorization.

---

# 11. Row Level Security

Supabase PostgreSQL Row Level Security is mandatory for protected application data.

RLS should enforce:

```text
organization isolation
branch isolation
customer ownership
appropriate employee/job scope
```

---

# 12. Defense in Depth

Security should exist at multiple layers:

```text
Browser
 ↓
Next.js Server
 ↓
Authorization
 ↓
Domain Logic
 ↓
RLS
 ↓
PostgreSQL
```

No single layer should be treated as the only protection.

---

# 13. Service Role Key

Supabase service-role credentials bypass normal RLS protections.

Therefore:

* never expose service-role keys to browsers
* never place them in public environment variables
* never send them to clients
* never commit them to Git

They are server-only secrets.

---

# 14. Public Environment Variables

Only intentionally public configuration may use public environment variables.

Examples may include:

```text
Supabase public URL
Supabase anonymous/public key
public application configuration
```

Secret credentials must never use public prefixes.

---

# 15. Secrets

Secrets may include:

```text
Supabase service-role key
SES credentials
payment provider secrets
webhook secrets
encryption keys
API keys
```

Secrets must be stored in secure environment/secret management systems.

---

# 16. Secret Rotation

Secrets should be rotatable without application redesign.

Production secrets must not be permanently embedded in source code.

---

# 17. Git Security

Never commit:

```text
.env
.env.local
production credentials
private keys
API tokens
database passwords
webhook secrets
```

Use `.env.example` for documented variable names without secret values.

---

# 18. Development Secrets

Development credentials must remain separate from production credentials.

---

# 19. Production Separation

Development, staging, and production environments should use separate credentials and preferably separate infrastructure/data.

---

# 20. Database Security

PostgreSQL access should follow least privilege.

Application users should not receive unnecessary database privileges.

---

# 21. SQL Injection

All database operations must use:

* parameterized queries
* Supabase query APIs
* safe query builders
* validated inputs

Never concatenate untrusted input into SQL.

---

# 22. Input Validation

All externally supplied structured input must be validated.

Zod is the preferred validation layer.

Examples:

```text
booking input
pricing input
CMS content
branch configuration
user invitations
filters
query parameters
```

---

# 23. Type Safety

TypeScript should use strict settings.

Avoid:

```text
any
unsafe casts
unchecked external data
```

where a safer typed alternative exists.

---

# 24. Validation Boundaries

Validate at trust boundaries:

```text
Browser
 ↓
Server
 ↓
Domain
 ↓
Database
```

Frontend validation improves UX.

Server validation provides security.

---

# 25. Authorization Before Mutation

Sensitive mutations should follow:

```text
Authenticate
 ↓
Authorize
 ↓
Validate
 ↓
Execute
```

Never validate only after performing a privileged operation.

---

# 26. Customer Booking Security

Public booking must assume the requester is untrusted.

The server must validate:

* branch
* service
* service availability
* requested time
* customer data
* pricing
* booking state

---

# 27. Price Integrity

Customers must never be allowed to submit their own authoritative price.

The server recalculates the price.

The client may display:

```text
€120
```

but cannot make that value authoritative.

---

# 28. Booking Integrity

The client cannot decide:

```text
booking confirmed
payment successful
job completed
```

These states are controlled server-side.

---

# 29. Magic Links

Customer booking management uses secure magic links.

Tokens must be:

* unpredictable
* short-lived where appropriate
* securely generated
* transmitted only through approved channels
* invalidated when necessary

---

# 30. Magic-Link Storage

Raw magic-link tokens should not be stored unnecessarily.

Prefer storing a secure hash or equivalent verification representation where the implementation permits.

---

# 31. Magic-Link Scope

A customer magic link should grant access only to the intended booking/customer actions.

It must not grant internal dashboard access.

---

# 32. Magic-Link Enumeration

Public endpoints must not reveal whether arbitrary booking identifiers or customer records exist.

Responses should avoid information leakage.

---

# 33. Magic-Link Rate Limiting

Magic-link requests must be rate-limited.

Abuse prevention should consider:

```text
email
IP
booking
session
time window
```

without creating unnecessary privacy problems.

---

# 34. Booking Abuse

Public booking should have anti-abuse controls.

Possible controls:

* rate limiting
* request validation
* bot protection where justified
* duplicate detection
* suspicious activity monitoring

---

# 35. CAPTCHA / Bot Protection

Bot protection should be introduced only where abuse justifies it.

Avoid unnecessarily harming legitimate customer conversion.

---

# 36. Rate Limiting

Rate limits should apply to sensitive endpoints.

Examples:

```text
login
magic-link request
booking creation
password/account recovery if introduced
public forms
API endpoints
exports
```

---

# 37. Rate-Limit Design

Rate limits should consider:

```text
IP
identity
resource
endpoint
time window
```

A single global limit may be insufficient.

---

# 38. Brute Force Protection

Authentication systems should rely on Supabase Auth protections where available and add application-level protections where necessary.

---

# 39. CSRF

State-changing browser requests must be protected against CSRF where the authentication/session mechanism makes CSRF relevant.

---

# 40. XSS

User-controlled content must never be rendered as trusted HTML by default.

CMS content should use structured fields.

---

# 41. No Arbitrary HTML

The CMS should not provide arbitrary HTML/JavaScript editing to ordinary administrators.

This reduces XSS and governance risk.

---

# 42. Content Sanitization

Where rich text is eventually supported, HTML must be sanitized with an explicit allowlist.

---

# 43. CMS Security

CMS permissions must protect:

```text
draft content
global content
branch content
publishing
media
SEO
navigation
```

---

# 44. Publishing Security

Publishing is a privileged action.

A user who can edit content does not necessarily need permission to publish it.

---

# 45. Preview Security

Draft previews must not accidentally become public.

Preview access should use secure authorization or expiring preview mechanisms.

---

# 46. Media Uploads

Uploaded files must be treated as untrusted.

Validate:

* file type
* file size
* filename
* content type
* storage path

---

# 47. File Extensions

Do not trust the file extension alone to determine file type.

---

# 48. Executable Uploads

Users must not be able to upload executable server-side files into executable web locations.

---

# 49. Storage Isolation

Supabase Storage buckets and paths must enforce appropriate access rules.

Branch-specific media must not become publicly accessible merely because the user knows a storage path.

---

# 50. Public Media

Public website assets may be public where intended.

Private assets remain protected.

---

# 51. Signed URLs

Private files may use short-lived signed URLs.

---

# 52. Cleaner Photos

Cleaner job photos may contain customer/property information.

Access must therefore be:

```text
job scoped
branch scoped
permission controlled
```

---

# 53. Photo Retention

Operational photos should have a defined retention policy.

Do not retain them indefinitely without business justification.

> **Resolved (BD-C4 — Change 7 decision record):** V1 cleaner photos are
> limited to before/after/incident-evidence categories, private and job-scoped,
> with a defined retention policy configured through the Media Storage
> implementation; no public exposure path exists.

---

# 54. Customer Personal Data

Potential customer data includes:

```text
name
email
phone
address
booking history
notes
payment-related records
reviews
```

Only necessary data should be collected.

---

# 55. Data Minimization

Collect the minimum information required for the service.

Do not collect personal information simply because it might become useful later.

---

# 56. Purpose Limitation

Data collected for booking operations should not automatically be reused for unrelated purposes.

New purposes should be evaluated separately.

---

# 57. Privacy by Design

Privacy must be considered during:

```text
database design
feature design
analytics
notifications
AI features
reporting
exports
```

---

# 58. GDPR-Oriented Architecture

Because CLENQO may operate in Europe, the system should be designed to support GDPR requirements.

This includes:

* data minimization
* purpose limitation
* access controls
* retention
* deletion/anonymization workflows
* consent where applicable
* data subject rights
* processor/vendor management

This document is an engineering specification, not legal advice.

---

# 59. Data Controller / Processor Responsibilities

The business/legal structure must determine CLENQO's applicable controller/processor responsibilities.

Technical architecture should support those obligations rather than assuming one universal legal model.

---

# 60. Privacy Policy

Public-facing privacy information must accurately describe:

* data collected
* purposes
* retention
* recipients/processors
* rights
* contact mechanism

The exact legal text should be maintained separately from application logic.

---

# 61. Consent

Where consent is legally required, it must be:

* explicit
* purpose-specific
* recordable
* revocable

---

# 62. Transactional Communications

Essential transactional emails should remain distinguishable from optional marketing communications.

---

# 63. Marketing Preferences

Marketing consent/preferences must not disable essential operational communication.

Example:

```text
Marketing:
opt-out

Booking confirmation:
still sent
```

---

# 64. Notification Privacy

Emails and future WhatsApp/SMS messages must avoid exposing unnecessary sensitive information.

---

# 65. Email Security

Transactional email should use the approved provider architecture.

Initial provider:

```text
Amazon SES
```

Provider credentials remain server-side.

---

# 66. Email Content

Emails should avoid unnecessary personal information.

For secure actions, use controlled links rather than embedding excessive booking/customer data.

---

# 67. Email Authentication

Production email domains should be configured with appropriate email authentication mechanisms such as:

```text
SPF
DKIM
DMARC
```

---

# 68. Webhooks

External webhook endpoints must verify provider signatures where supported.

Never trust an incoming webhook solely because it uses a known URL.

---

# 69. Webhook Idempotency

External events may be delivered multiple times.

Webhook processing must be idempotent.

---

# 70. Payment Security

CLENQO must not store raw:

```text
card number
CVV
```

unless a future architecture explicitly requires a compliant specialized payment system.

Prefer provider-hosted/tokenized payment flows.

---

# 71. Payment Authorization

Payment state is authoritative only after secure provider verification.

A client-submitted:

```text
payment_status = paid
```

must never be trusted.

---

# 72. Refund Security

Refund operations require explicit authorization.

Large or unusual refunds may require additional confirmation or future approval workflows.

---

# 73. Financial Data Access

Financial records must be permission-controlled.

Branch users should see only authorized branch financial information.

---

# 74. Employee Data

Employee records may contain sensitive information.

Access should be restricted according to role and operational necessity.

---

# 75. Employee Data Minimization

The cleaner PWA should receive only the data required to perform assigned work.

> **Resolved (BD-C1 — Change 7 decision record):** the concrete V1 field set is
> customer first name, last initial, phone, service address, and execution
> instructions — nothing else crosses into the Cleaner PWA (no email, no
> payment data, no unrelated history, no internal notes).

---

# 76. Customer Address Protection

Property addresses should not be exposed to employees who are not assigned to the relevant job.

---

# 77. Internal Notes

Internal notes must never automatically become visible to customers.

---

# 78. Customer Notes

Customer-facing notes and internal operational notes must be separate fields or otherwise strongly separated.

---

# 79. Database Backups

Production database backups are required.

Backup configuration must be appropriate to the operational importance of CLENQO data.

---

# 80. Backup Security

Backups must be protected with appropriate access controls.

A backup containing customer or financial data is itself sensitive data.

---

# 81. Restore Testing

A backup that has never been restored is not considered fully verified.

Restore procedures should be tested periodically.

---

# 82. Recovery Objectives

The system should define:

```text
RPO
Recovery Point Objective

RTO
Recovery Time Objective
```

based on business requirements.

---

# 83. Availability

Core functionality should remain resilient against:

* transient database errors
* notification provider outages
* payment provider outages
* worker failures
* individual branch configuration errors

---

# 84. External Provider Failure

A provider failure should not corrupt business state.

Example:

```text
SES unavailable
```

must not mean:

```text
booking deleted
```

---

# 85. Retry Strategy

Transient failures should use controlled retries with backoff.

Avoid infinite retry loops.

---

# 86. Idempotency

Important mutation endpoints should support idempotency where duplicate requests could cause duplicate business effects.

Examples:

```text
booking creation
payment creation
refund
notification dispatch
branch provisioning
```

---

# 87. Concurrency

Security and correctness must account for concurrent requests.

Examples:

```text
two users assign same job
two customers book same slot
two admins publish configuration
```

Use transactions, constraints, locks, or other appropriate database mechanisms.

---

# 88. Database Constraints

Security-sensitive invariants should be enforced at the database level where practical.

Examples:

```text
unique branch slug
unique booking number
valid foreign keys
valid state relationships
```

---

# 89. State Transitions

Clients must not arbitrarily change business states.

Allowed transitions should be defined by domain logic.

---

# 90. API Security

Server endpoints must:

* authenticate where required
* authorize
* validate input
* rate-limit where appropriate
* return minimal data
* avoid leaking internal errors

---

# 91. Error Messages

Production errors must not expose:

* stack traces
* SQL queries
* secrets
* internal file paths
* provider credentials
* authorization internals

---

# 92. Logging

Application logs should help diagnose failures without becoming a source of sensitive-data leakage.

Do not log:

```text
passwords
tokens
CVV
full payment credentials
magic-link secrets
```

---

# 93. Structured Logging

Logs should include useful context such as:

```text
request_id
organization_id
branch_id
resource_id
operation
result
```

where safe.

---

# 94. Correlation IDs

A request/correlation ID should allow related operations to be traced.

Example:

```text
Booking Request
 ↓
Pricing
 ↓
Booking
 ↓
Job
 ↓
Notification
```

---

# 95. Audit Logging

Important business and security actions must also be captured through the audit system defined in `AUDIT_SYSTEM.md`.

Application logs are not a replacement for audit records.

---

# 96. Monitoring

Monitor:

```text
authentication failures
authorization failures
booking abuse
payment failures
webhook failures
notification failures
database errors
application errors
unusual traffic
```

---

# 97. Security Alerts

High-risk events may generate alerts.

Examples:

```text
large number of failed logins
repeated authorization failures
unexpected privilege changes
unusual refunds
bulk data exports
```

---

# 98. Incident Response

CLENQO should have a documented incident response process.

Conceptually:

```text
Detect
 ↓
Contain
 ↓
Investigate
 ↓
Remediate
 ↓
Recover
 ↓
Review
```

---

# 99. Incident Evidence

Relevant logs and audit records should be preserved during investigations.

Do not casually delete evidence while resolving an incident.

---

# 100. Security Incident Classification

Incidents may be categorized by:

```text
availability
integrity
confidentiality
privacy
authentication
authorization
financial
```

---

# 101. Data Breach Response

If personal data may have been compromised, the organization must follow its applicable legal and regulatory notification procedures.

The application should provide enough audit/logging capability to investigate what happened.

---

# 102. Dependency Security

Dependencies should be:

* intentionally selected
* kept reasonably current
* reviewed for known vulnerabilities
* removed when unnecessary

---

# 103. Supply Chain Security

Production dependencies should come from trusted registries and controlled package configuration.

Lockfiles should be committed.

---

# 104. Dependency Changes

Major security-sensitive dependencies should be tested before production deployment.

---

# 105. GitHub Security

Repository protections should eventually include:

* protected main branch
* pull-request review
* secret scanning
* dependency alerts
* CI checks

---

# 106. CI Security

CI must not print secrets into logs.

Production credentials should be available only to workflows that actually require them.

---

# 107. Deployment Security

Production deployment should:

* build from controlled source
* run automated checks
* use production secrets securely
* prevent accidental debug configuration
* verify migrations

---

# 108. Debug Mode

Production debugging must not expose sensitive information.

Development-only debugging features must be disabled in production.

---

# 109. Database Migrations

Migrations must be version-controlled.

Security-sensitive migrations should be reviewed and tested before deployment.

---

# 110. Destructive Migrations

Destructive database changes require additional caution.

Prefer:

```text
add
migrate
verify
deprecate
remove later
```

over immediate destructive changes.

---

# 111. Development Data

Production customer data should not be copied into local development environments unless there is a justified, controlled, privacy-safe process.

---

# 112. Test Data

Development and test environments should use synthetic data where practical.

---

# 113. Local Development

Developers should not need production secrets to run normal local development.

---

# 114. Access Reviews

Administrative access should periodically be reviewed.

Remove access that is no longer necessary.

---

# 115. Least Privilege

Every user, service, API, database role, and integration should have the minimum required privileges.

---

# 116. Privileged Operations

High-impact actions should require appropriate permissions.

Examples:

```text
branch activation
branch archival
permission changes
refunds
pricing publication
global configuration
data exports
```

---

# 117. Dual Approval

Future functionality may support dual approval for especially sensitive operations.

This should be introduced only where business risk justifies it.

---

# 118. Session Security

Internal sessions should use secure authentication mechanisms provided by Supabase and appropriate application configuration.

---

# 119. Session Revocation

Deactivated users should no longer be able to perform new privileged operations.

---

# 120. Customer Session Security

Magic-link customer sessions should be narrowly scoped and expire according to security requirements.

---

# 121. Browser Security

Production web applications should use appropriate browser security headers.

Potential controls include:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
```

Exact policy values should be tested against the application.

---

# 122. HTTPS

Production traffic must use HTTPS.

Sensitive links and authentication flows must never depend on unencrypted HTTP.

---

# 123. Secure Cookies

Where cookies are used for authentication/session purposes, configuration should use appropriate:

```text
Secure
HttpOnly
SameSite
```

settings.

---

# 124. Third-Party Scripts

Third-party scripts should be minimized.

Every external script should have a clear purpose and privacy/security assessment.

---

# 125. Analytics

Analytics should be privacy-conscious and should not receive unnecessary personal data.

---

# 126. AI Features

Future AI systems must follow the same authorization boundaries as the dashboard.

AI does not receive unrestricted access simply because it operates inside CLENQO.

---

# 127. AI Data Minimization

Only the minimum information required for an AI task should be provided.

---

# 128. AI Actions

AI should not independently perform high-impact actions without explicit authorization and appropriate safeguards.

Examples:

```text
refund customer
change pricing
deactivate employee
delete branch
```

should remain controlled operations.

---

# 129. Data Export to AI Providers

If external AI providers are used, data-sharing implications must be evaluated before sending customer, employee, or financial information.

---

# 130. Localization

Privacy and security controls must work consistently across:

```text
de
en
fr
es
```

and future locales.

---

# 131. Legal Configuration

Legal/privacy content should support country-specific differences without hardcoding a single country's rules into application logic.

---

# 132. Data Retention

Every major data category should have an intended retention policy.

Examples:

```text
bookings
payments
invoices
audit logs
customer data
employee data
job photos
analytics events
notifications
```

---

# 133. Retention Automation

Future retention jobs may:

```text
archive
anonymize
delete
```

data when legally and operationally appropriate.

---

# 134. Anonymization

Where deletion conflicts with legitimate historical reporting requirements, appropriately anonymized data may be retained when legally permissible.

---

# 135. Data Subject Requests

The platform should eventually support workflows for applicable requests such as:

```text
access
correction
deletion
restriction
data export
```

The exact legal workflow must be confirmed with appropriate legal guidance.

---

# 136. Customer Data Export

A future customer privacy workflow may produce a structured export of the customer's applicable personal data.

---

# 137. Customer Data Deletion

Deletion must account for:

* legal retention
* financial records
* audit requirements
* operational history
* fraud prevention

Deletion should not be implemented as a blind database cascade.

---

# 138. Privacy by Default

Default settings should favor:

```text
minimum access
minimum data
minimum retention
```

unless there is a documented business requirement otherwise.

---

# 139. Security Testing

Security testing should include:

* authentication testing
* authorization testing
* RLS testing
* branch isolation testing
* API testing
* input validation
* XSS
* CSRF
* rate limiting
* magic-link security
* webhook security
* storage security
* payment flows
* export permissions

---

# 140. Penetration Testing

Before major commercial scale, CLENQO should consider independent security testing/penetration testing.

---

# 141. Branch Isolation Tests

Explicitly test:

```text
Branch A user
→ Branch B booking

Branch A manager
→ Branch B customer

Branch A manager
→ HQ settings
```

All unauthorized access must fail.

---

# 142. Privilege Escalation Tests

Test attempts to modify:

```text
role
branch assignment
permission
organization
financial access
```

through manipulated requests.

---

# 143. Customer Isolation Tests

Customer A must not access:

```text
Customer B
Booking B
Address B
Payment B
```

by changing identifiers.

---

# 144. Cleaner Isolation Tests

Cleaner A must not access arbitrary jobs belonging to Cleaner B unless explicitly authorized by operational rules.

---

# 145. Financial Tests

Verify that clients cannot manipulate:

```text
price
payment status
refund amount
invoice status
```

through request payloads.

---

# 146. Upload Tests

Test malicious:

```text
file types
large files
renamed executables
unexpected MIME types
path manipulation
```

---

# 147. Rate-Limit Tests

Verify that abusive request patterns are blocked or throttled without breaking legitimate traffic.

---

# 148. Security Review

Every major OpenSpec change should consider:

```text
authentication impact
authorization impact
data exposure
RLS impact
privacy impact
audit requirements
secrets
external providers
```

---

# 149. Definition of Done — Security

A security-sensitive feature is not complete until:

```text
authentication considered
authorization implemented
RLS reviewed
input validation implemented
sensitive data minimized
audit requirements considered
rate limits considered
tests added
errors sanitized
secrets protected
```

---

# 150. MVP Security Scope

The MVP must include:

```text
Supabase Auth
server-side authorization
RLS
organization isolation
branch isolation
role permissions
secure magic links
input validation
Zod
rate limiting for sensitive public actions
secure storage
server-only secrets
payment security foundation
webhook verification foundation
audit logging
HTTPS
secure deployment
basic monitoring
backup strategy
```

---

# 151. Future Security Capabilities

Future versions may add:

* advanced WAF/bot protection
* independent penetration testing
* advanced security monitoring
* anomaly detection
* SSO
* MFA enforcement policies
* privileged-access management
* immutable audit archival
* advanced compliance automation
* security incident center

---

# 152. Security Architecture Summary

```text
                    Internet
                       │
                       ↓
                Next.js Application
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
   Authentication  Authorization  Validation
          │            │            │
          └────────────┼────────────┘
                       ↓
                  Domain Logic
                       ↓
                 PostgreSQL/RLS
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Storage       Audit       External APIs
```

---

# 153. Golden Security Rule

> **CLENQO must assume every external request is untrusted, enforce authentication and authorization server-side, protect every branch through explicit scope and RLS, minimize personal data, keep secrets server-side, secure public booking and magic links, protect financial operations, audit important actions, and design every new feature with security and privacy from the beginning.**
