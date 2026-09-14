# CLENQO Deployment and DevOps

## 1. Purpose

This document defines how CLENQO is developed, built, tested, deployed, monitored, backed up, and operated across development, staging, and production.

The deployment architecture must support:

* one centralized application
* multiple branches
* safe database migrations
* automated CI/CD
* secure secrets
* reliable deployments
* rollback/recovery
* monitoring
* backups
* future scaling

---

# 2. Core Principle

> **Deployment must be repeatable, controlled, observable, and safe.**

No production deployment should depend on undocumented manual steps.

---

# 3. Selected Infrastructure

Initial infrastructure:

```text
Application
→ Next.js 16

Frontend/UI
→ React 19
→ TypeScript
→ Tailwind CSS
→ shadcn/ui
→ GSAP

Backend/Database
→ Supabase
→ PostgreSQL
→ Supabase Auth
→ Supabase Storage
→ RLS

Hosting
→ Vercel

Source Control
→ GitHub

Transactional Email
→ Amazon SES
```

---

# 4. No Docker Initially

The initial CLENQO deployment architecture does not require Docker.

Local development should remain simple.

Docker may be introduced later if infrastructure requirements justify it.

---

# 5. Architecture

Conceptually:

```text
Developer
   ↓
GitHub
   ↓
CI
   ↓
Vercel
   ↓
Next.js
   ↓
Supabase
   ├── PostgreSQL
   ├── Auth
   └── Storage

Next.js
   ↓
Amazon SES
```

---

# 6. Environments

CLENQO should distinguish:

```text
Local
 ↓
CI
 ↓
Staging
 ↓
Production
```

Each environment should have appropriate isolation.

---

# 7. Local Environment

Local development is used for:

* feature development
* unit testing
* integration testing
* UI development
* database development

Production credentials must not be required for ordinary local development.

---

# 8. CI Environment

CI verifies code automatically.

Typical checks:

```text
install
lint
typecheck
test
build
security checks
```

---

# 9. Staging

Staging should resemble production closely enough to catch deployment problems before release.

It should use:

* separate configuration
* separate credentials
* separate data
* test integrations

---

# 10. Production

Production serves real customers and branches.

Production configuration must never be treated as a development environment.

---

# 11. Environment Isolation

The following should remain environment-specific:

```text
database
Supabase project
storage
authentication configuration
payment credentials
SES configuration
application secrets
domains
analytics
```

---

# 12. Environment Variables

Configuration should be provided through environment variables or secure platform configuration.

Never hardcode environment-specific secrets.

---

# 13. Public Variables

Only intentionally public configuration may be exposed to browser code.

Example:

```text
NEXT_PUBLIC_*
```

variables must never contain secrets.

---

# 14. Server Secrets

Server-only variables include:

```text
Supabase service-role key
payment secrets
SES credentials
webhook secrets
encryption keys
private API keys
```

---

# 15. Secret Management

Production secrets should be stored through secure environment/secret management facilities.

They must not be committed to Git.

---

# 16. Secret Rotation

The architecture must allow credentials to be rotated without code changes.

---

# 17. GitHub Repository

GitHub is the source-control system.

The repository should contain:

```text
application code
database migrations
seeds
tests
documentation
OpenSpec changes
configuration examples
```

---

# 18. Git Hygiene

Never commit:

```text
.env
production credentials
API keys
private keys
database passwords
provider secrets
```

---

# 19. `.env.example`

The repository should provide an example environment file containing:

```text
variable names
safe placeholder values
comments where useful
```

No real secrets.

---

# 20. Branch Strategy

The project should use a controlled Git workflow.

Conceptually:

```text
feature/*
    ↓
pull request
    ↓
main
    ↓
production deployment
```

The exact branch strategy may evolve.

---

# 21. Pull Requests

Pull requests should:

* describe the change
* reference relevant OpenSpec work
* pass CI
* include tests
* identify migrations
* identify security impact where relevant

---

# 22. Protected Main Branch

The production branch should eventually require:

* successful CI
* review where appropriate
* no blocking checks
* controlled merge permissions

---

# 23. Commit Quality

Commits should represent meaningful changes.

Avoid large unrelated commits containing:

```text
feature
refactor
database migration
unrelated formatting
```

all together.

---

# 24. CI Pipeline

Baseline pipeline:

```text
Checkout
 ↓
Install Dependencies
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

# 25. Dependency Installation

CI should use the committed lockfile.

Dependency versions must be deterministic.

---

# 26. Node Version

The project should define and consistently use its supported Node.js version.

The version used locally and in CI should remain aligned.

---

# 27. Package Manager

The repository should use one documented package manager consistently.

Do not mix package-manager lockfiles.

---

# 28. Build

The production build must be reproducible.

A successful local development server is not sufficient evidence of production readiness.

---

# 29. Vercel

Vercel is the initial application hosting platform.

The deployment architecture should use Vercel for:

* Next.js builds
* deployment
* preview environments
* production hosting
* environment configuration

---

# 30. Preview Deployments

Pull requests should use preview deployments where practical.

Preview deployments help validate:

```text
UI
routing
server logic
build
environment configuration
```

---

# 31. Preview Security

Preview environments must not accidentally expose production secrets or production customer data.

---

# 32. Production Deployment

Production deployment should happen only from the approved production branch/release process.

---

# 33. Deployment Flow

Conceptually:

```text
Code
 ↓
Pull Request
 ↓
CI
 ↓
Review
 ↓
Merge
 ↓
Production Build
 ↓
Deploy
 ↓
Smoke Test
 ↓
Monitor
```

---

# 34. Database

Supabase PostgreSQL is the production database.

The database is a critical production dependency.

---

# 35. Database Migrations

All schema changes must be version-controlled.

No undocumented manual production schema edits.

---

# 36. Migration Source of Truth

The repository's migration history is the source of truth for schema evolution.

---

# 37. Migration Workflow

Preferred workflow:

```text
Design
 ↓
Migration
 ↓
Local Verification
 ↓
CI Verification
 ↓
Staging
 ↓
Production
```

---

# 38. Fresh Database Verification

CI should verify that the complete migration chain can create the expected database schema from an empty database.

---

# 39. Migration Ordering

Migrations must have deterministic ordering.

Never depend on manual execution order.

---

# 40. Migration Safety

Prefer additive, backward-compatible changes.

Example:

```text
Add column
 ↓
Deploy compatible code
 ↓
Migrate data
 ↓
Switch behavior
 ↓
Remove old structure later
```

---

# 41. Destructive Migrations

Destructive operations require additional review.

Examples:

```text
drop column
drop table
remove constraint
delete data
```

---

# 42. Production Migration

Production migrations must be executed through the controlled deployment process.

---

# 43. Migration Verification

After migration:

```text
schema
 ↓
constraints
 ↓
indexes
 ↓
RLS
 ↓
RPC/functions
```

should be verified as appropriate.

---

# 44. RLS Deployment

RLS changes are security-sensitive migrations.

Every RLS change requires corresponding authorization tests.

---

# 45. Database Functions

PostgreSQL functions/RPCs must be version-controlled and tested.

---

# 46. Database Backups

Production database backups are required.

The backup configuration should align with business recovery requirements.

---

# 47. Backup Verification

Backups must be monitored and restore procedures periodically tested.

---

# 48. Storage Backups

Important uploaded assets must have appropriate backup/retention strategy.

---

# 49. Disaster Recovery

The project should define recovery procedures for:

```text
database failure
application failure
provider outage
accidental configuration change
security incident
deployment failure
```

---

# 50. Recovery Objectives

Define:

```text
RPO
Recovery Point Objective

RTO
Recovery Time Objective
```

as business requirements mature.

---

# 51. Rollback

Application deployments should support rollback where practical.

---

# 52. Database Rollback

Database rollback is more complex than application rollback.

Do not assume:

```text
application rollback
=
database rollback
```

---

# 53. Forward Fixes

For incompatible schema changes, a forward migration may be safer than reversing production data changes.

---

# 54. Deployment Compatibility

During migrations, old and new application versions may temporarily coexist.

Schema changes should account for this when the platform architecture requires it.

---

# 55. Health Checks

The platform should expose appropriate health information.

Health checks may verify:

```text
application
database connectivity
critical dependencies
```

without exposing sensitive information.

---

# 56. Readiness

A deployment should be considered ready only when critical dependencies are functioning.

---

# 57. Monitoring

Production monitoring should cover:

```text
application errors
latency
availability
database errors
authentication failures
booking failures
payment failures
notification failures
```

---

# 58. Error Tracking

Application errors should be centrally observable.

The selected error-monitoring service can be introduced when required.

---

# 59. Logging

Logs should be structured where practical.

Useful fields include:

```text
timestamp
level
request_id
organization_id
branch_id
operation
result
```

Sensitive data must be excluded.

---

# 60. No Secret Logging

Never log:

```text
password
authentication token
magic-link token
CVV
API secret
private key
```

---

# 61. Correlation IDs

Requests should have correlation identifiers where practical.

This allows:

```text
Request
 ↓
Pricing
 ↓
Booking
 ↓
Payment
 ↓
Notification
```

to be investigated as one operation.

---

# 62. Audit Integration

Important business actions must generate audit records according to `AUDIT_SYSTEM.md`.

Application logs do not replace audit records.

---

# 63. Alerting

Operational alerts may include:

```text
database unavailable
high error rate
payment failures
notification failures
booking failures
migration failure
```

---

# 64. Security Alerts

Security-related alerts may include:

```text
unusual login failures
repeated authorization failures
unexpected privilege changes
unusual refunds
bulk exports
```

---

# 65. Branch Health

HQ should eventually be able to see branch operational health.

Examples:

```text
booking failures
unassigned jobs
notification failures
payment issues
website availability
```

---

# 66. Performance

Monitor:

* server response time
* database query latency
* page performance
* booking availability latency
* pricing calculation latency

---

# 67. Database Performance

Slow queries should be identified through database monitoring and application telemetry.

---

# 68. Caching

Caching may be introduced for:

```text
public content
read-heavy configuration
reporting
availability information where safe
```

Caching must never bypass authorization.

---

# 69. Cache Invalidation

Business-critical changes should invalidate affected cached data.

Examples:

```text
published page
changed service
changed pricing
changed branch availability
```

---

# 70. Public Website Deployment

The public website should be optimized for:

* fast page delivery
* SEO
* responsive rendering
* cacheability
* availability

---

# 71. Branch Routing

Branch routes should resolve dynamically from centralized branch configuration.

Example:

```text
/berlin
```

must resolve using branch data rather than hardcoded application logic.

---

# 72. Branch Provisioning

New branch creation should not require a new deployment.

The expected flow is:

```text
HQ creates branch
 ↓
Database provisioning
 ↓
Branch becomes available
```

---

# 73. Branch Scaling

Adding 100 branches should primarily add data/configuration, not 100 deployments.

---

# 74. Custom Domains

Future custom-domain support should use centralized routing and configuration.

It should not require separate applications.

---

# 75. DNS

Production DNS should be managed through a controlled domain-management process.

---

# 76. SSL

Production public domains must use valid TLS/HTTPS.

Custom domains must receive appropriate certificate management.

---

# 77. Email Deployment

Amazon SES configuration should be environment-aware.

Development and staging should not unintentionally send production transactional emails.

---

# 78. Email Testing

Use controlled test recipients or sandbox/test configurations during development.

---

# 79. SES Credentials

SES credentials must remain server-side.

---

# 80. Email Domain Security

Production email infrastructure should use appropriate:

```text
SPF
DKIM
DMARC
```

configuration.

---

# 81. Payment Deployment

Payment providers must have separate:

```text
test credentials
production credentials
```

where supported.

---

# 82. Payment Webhooks

Production webhook endpoints must use:

* signature verification
* idempotency
* secure secrets
* logging without sensitive payload leakage

---

# 83. Webhook Deployment

Webhook processing must remain backward-compatible with provider retries and duplicate delivery.

---

# 84. Storage Deployment

Supabase Storage configuration must distinguish:

```text
public assets
private operational files
```

and apply appropriate access rules.

---

# 85. File Migration

Moving storage structures must not silently break existing customer or operational media.

---

# 86. Authentication Deployment

Production authentication configuration must use the correct production URLs, redirect configuration, and security settings.

---

# 87. Authentication Testing

Before production release, verify:

```text
login
logout
session
role resolution
authorization
magic links
```

---

# 88. Preview Authentication

Preview deployments should use appropriate test authentication configuration.

Do not accidentally connect preview environments to production user accounts.

---

# 89. Production Data Protection

Production data must not be exposed through:

* preview environments
* local development
* test fixtures
* debugging tools
* public APIs

---

# 90. Feature Flags

Feature flags may be used to safely introduce larger features.

Example:

```text
feature
 ↓
disabled
 ↓
internal testing
 ↓
one branch
 ↓
all branches
```

---

# 91. Branch-Specific Feature Flags

Future functionality may enable a feature for selected branches.

Feature flags do not replace authorization.

---

# 92. Configuration Changes

Configuration should be managed through controlled dashboard/configuration mechanisms.

Avoid direct production database edits.

---

# 93. Production Access

Production infrastructure access should use least privilege.

Only users who require production access should receive it.

---

# 94. Administrative Access

Production administrative access should be separately protected from normal application access.

---

# 95. Access Review

Production access should be reviewed periodically.

Remove inactive access.

---

# 96. Incident Response

Deployment operations must support incident response.

Basic process:

```text
Detect
 ↓
Assess
 ↓
Contain
 ↓
Recover
 ↓
Verify
 ↓
Document
```

---

# 97. Deployment Incident

If a release causes a major problem:

```text
Stop rollout
 ↓
Assess
 ↓
Rollback or forward-fix
 ↓
Verify
 ↓
Monitor
```

---

# 98. Database Incident

If a migration causes an issue:

```text
Stop further changes
 ↓
Assess schema/data impact
 ↓
Protect data
 ↓
Restore or forward-fix
 ↓
Verify
```

---

# 99. Security Incident

Security incidents follow the security procedures in `SECURITY_PRIVACY.md`.

---

# 100. Post-Incident Review

Significant incidents should result in:

* root-cause analysis
* corrective action
* regression tests
* documentation updates

---

# 101. Dependency Updates

Dependencies should be updated deliberately.

Avoid uncontrolled automatic upgrades of major versions in production.

---

# 102. Security Updates

Security-critical dependency updates should receive priority.

---

# 103. Lockfile

The package lockfile must be committed and used by CI.

---

# 104. Build Reproducibility

The same source commit and environment configuration should produce predictable application artifacts.

---

# 105. Versioning

Application releases should be traceable to:

```text
Git commit
deployment
database migration state
environment
```

---

# 106. Deployment Metadata

Production deployments should be identifiable.

Example:

```text
Version:
commit SHA
```

This enables incident investigation.

---

# 107. Health Dashboard

Future HQ functionality may display platform health:

```text
Application
Database
Storage
Email
Payments
Notifications
```

---

# 108. Observability Boundaries

Monitoring must distinguish:

```text
platform problem
branch configuration problem
external provider problem
customer input problem
```

This helps prevent incorrect incident diagnosis.

---

# 109. Background Jobs

Background processing should eventually support:

* retries
* idempotency
* monitoring
* failure visibility

---

# 110. Queue Architecture

Initial background jobs may use database-backed mechanisms.

A dedicated message broker is not required initially.

---

# 111. Scheduled Jobs

Scheduled tasks may include:

```text
reminders
recurring booking generation
retention
report generation
cleanup
```

---

# 112. Job Failure

Failed background jobs must be observable and retryable where appropriate.

---

# 113. No Infinite Retries

Retry mechanisms must use bounded attempts and backoff.

---

# 114. Maintenance

Future maintenance operations may include:

```text
data cleanup
index maintenance
aggregate refresh
storage cleanup
```

These must be controlled and observable.

---

# 115. Scaling Path

Initial architecture:

```text
Vercel
+
Supabase
```

As traffic grows:

```text
Optimize Queries
 ↓
Indexes
 ↓
Caching
 ↓
Background Processing
 ↓
Horizontal Application Scaling
 ↓
Database Scaling
```

---

# 116. No Premature Infrastructure

Do not introduce:

* Kubernetes
* microservices
* message brokers
* dedicated data warehouses
* complex container orchestration

until real requirements justify them.

---

# 117. Cost Awareness

Infrastructure should scale with actual usage.

Prefer managed services where they reduce operational complexity without creating unacceptable cost or lock-in.

---

# 118. Vendor Abstraction

External providers should be isolated behind application adapters where practical.

Examples:

```text
PaymentProvider
EmailProvider
StorageProvider
```

This keeps business logic independent from one vendor.

---

# 119. Provider Failure

Business state must not depend on an external provider being permanently available.

---

# 120. Provider Replacement

Future providers should be replaceable without rewriting the entire domain.

---

# 121. Deployment Testing

Deployment verification should test:

```text
application startup
database connection
authentication
branch routing
public website
booking
dashboard
critical APIs
```

---

# 122. Smoke Tests

Minimum production smoke tests:

```text
homepage
branch website
booking flow
authentication
dashboard
database
critical notification path
```

---

# 123. Production Booking Test

Where safe, perform a controlled test of the booking path after major deployments.

It must not create an unintended real customer booking or financial transaction.

---

# 124. Production Payment Test

Real payment testing should use controlled provider mechanisms.

Never use arbitrary real charges simply to verify deployment.

---

# 125. Production Email Test

Production email verification should use controlled internal/test recipients where appropriate.

---

# 126. Deployment Documentation

Every significant infrastructure change should update relevant documentation.

---

# 127. OpenSpec Integration

Infrastructure changes should follow the same workflow:

```text
Decision
 ↓
Documentation
 ↓
OpenSpec
 ↓
Implementation
 ↓
Testing
 ↓
Deployment
```

---

# 128. Migration and OpenSpec

Database migrations should be associated with the OpenSpec change that requires them.

---

# 129. CI and OpenSpec

CI should verify artifacts required by the OpenSpec change where practical.

---

# 130. Release Checklist

Before production:

```text
☐ Requirements complete
☐ OpenSpec verified
☐ Tests passing
☐ Build passing
☐ Security reviewed
☐ Migration verified
☐ Environment variables verified
☐ External integrations verified
☐ Backup status verified
☐ Rollback strategy understood
```

---

# 131. Post-Release Checklist

After production deployment:

```text
☐ Deployment successful
☐ Application healthy
☐ Database healthy
☐ Homepage verified
☐ Branch routing verified
☐ Booking verified
☐ Dashboard verified
☐ Monitoring checked
☐ Errors reviewed
```

---

# 132. MVP DevOps Scope

The MVP must include:

```text
GitHub
Vercel
Supabase
PostgreSQL
Supabase Auth
Supabase Storage
environment separation
secure secrets
versioned migrations
CI
production build
preview deployment
production deployment
backups
basic monitoring
audit integration
rollback/recovery procedure
SES configuration
HTTPS
```

---

# 133. Future DevOps Capabilities

Future versions may add:

* advanced observability
* dedicated error monitoring
* infrastructure-as-code
* advanced background workers
* multi-region deployment
* advanced disaster recovery
* automated security scanning
* canary deployments
* advanced feature flags
* dedicated analytics infrastructure

---

# 134. Deployment Architecture Summary

```text
                    GitHub
                       │
                       ↓
                      CI
                       │
              ┌────────┴────────┐
              ↓                 ↓
           Preview           Production
              │                 │
              └────────┬────────┘
                       ↓
                     Vercel
                       │
                       ↓
                  Next.js 16
                       │
             ┌─────────┼─────────┐
             ↓         ↓         ↓
          Supabase   Storage     SES
             │
         PostgreSQL
             │
            RLS
```

---

# 135. Golden DevOps Rule

> **CLENQO must be deployable from source control through a repeatable pipeline, with isolated environments, secure secrets, version-controlled migrations, tested releases, observable production systems, reliable backups, and a clear recovery path. Adding branches must require configuration and data—not separate deployments or infrastructure.**
