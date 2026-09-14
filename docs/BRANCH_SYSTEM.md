# CLENQO HQ and Branch Administration

## 1. Purpose

The CLENQO HQ and Branch Administration system is the centralized administrative control plane for the entire CLENQO organization.

It manages:

* organization-wide configuration
* branches
* branch activation
* branch managers
* branch websites
* CMS
* services
* pricing
* bookings
* workforce
* operations
* payments
* invoices
* quality
* reporting
* permissions

The system must support:

```text
1 Branch
   ↓
5 Branches
   ↓
20 Branches
   ↓
100+ Branches
```

without requiring separate applications or databases for each branch.

---

# 2. Core Administration Principle

> **CLENQO operates from one centralized platform with branch-scoped operations and organization-wide governance.**

There should be:

```text
one codebase
one application
one database
one admin platform
many branches
```

---

# 3. HQ vs Branch Administration

The system has two primary administrative scopes.

### HQ

Controls the organization.

### Branch

Controls authorized local operations.

Conceptually:

```text
HQ
 ├── Branch A
 ├── Branch B
 ├── Branch C
 └── Branch N
```

---

# 4. HQ Admin

HQ Admin is the highest normal application role.

HQ Admin may manage:

* organization configuration
* branches
* global website standards
* branch provisioning
* users
* roles
* permissions
* pricing governance
* services
* reporting
* operational policies

Access remains permission-controlled.

---

# 5. HQ Staff

HQ Staff supports configurable organization-level responsibilities.

Examples:

```text
operations
finance
marketing
customer support
content
quality
```

HQ Staff should receive only the permissions necessary for their role.

---

# 6. Branch Manager

A Branch Manager manages one or more assigned branches.

Typical access:

```text
bookings
jobs
employees
customers
local content
services
branch operations
quality
```

The exact access depends on assigned permissions.

---

# 7. Cleaner

Cleaners are operational users.

They primarily use the Cleaner PWA.

They should not have unrestricted dashboard access.

---

# 8. Customer

Customers are external users.

They do not need a normal internal dashboard account.

Customer access uses secure booking management/magic links.

---

# 9. Organization Context

Every internal administrative request should have a resolved organization context.

Conceptually:

```text
Authenticated User
 ↓
Membership
 ↓
Organization
```

---

# 10. Branch Context

Branch-scoped operations additionally resolve:

```text
Organization
 ↓
Branch
```

The active branch shown in the UI is a convenience.

It is not authorization.

---

# 11. Active Branch Is Not Permission

A user selecting:

```text
Branch B
```

does not automatically gain access to Branch B.

The authorization layer must verify that the user is authorized for that branch.

---

# 12. Branch Context Switcher

Authorized users may switch between branches.

Example:

```text
Current:
Berlin

Switch to:
Leipzig
Hamburg
Munich
```

The list must contain only authorized branches.

---

# 13. HQ Global Context

HQ users may also have:

```text
All Branches
```

for organization-wide reporting and administration.

This should be distinct from an individual branch context.

---

# 14. Branch Creation

HQ Admin should be able to create a branch from the dashboard.

Required information may include:

```text
branch name
slug
country
timezone
currency
default locale
enabled locales
contact information
service area
status
```

---

# 15. Branch Creation Flow

Conceptually:

```text
HQ Admin
 ↓
Create Branch
 ↓
Validate
 ↓
Create Branch Record
 ↓
Provision Website
 ↓
Provision Locales
 ↓
Provision Pages
 ↓
Provision Default Sections
 ↓
Provision Initial Configuration
 ↓
Create Audit Events
 ↓
Branch Ready
```

---

# 16. Branch Provisioning

Branch creation should trigger deterministic provisioning.

Provisioning may create:

```text
branch website
website locales
pages
default sections
navigation
footer
SEO defaults
service configuration
basic operational configuration
```

---

# 17. Provisioning Idempotency

Provisioning must be safe to retry.

If provisioning fails halfway through:

```text
Retry
 ↓
Detect existing resources
 ↓
Create only missing resources
 ↓
Complete provisioning
```

Duplicate pages, sections, or configuration records must not be created.

---

# 18. Provisioning Status

Branch provisioning may have a lifecycle:

```text
pending
provisioning
ready
failed
```

A branch should not be publicly activated until required provisioning succeeds.

---

# 19. Branch Activation

Creating a branch and activating a branch are separate operations.

Conceptually:

```text
Created
 ↓
Provisioned
 ↓
Configured
 ↓
Reviewed
 ↓
Active
```

---

# 20. Branch Deactivation

A branch may be deactivated.

Deactivation should generally:

* stop new bookings
* stop new assignments
* disable public booking
* preserve historical records

Existing bookings require explicit operational handling.

---

# 21. Branch Archiving

Archived branches should remain available for historical reporting and records according to retention policies.

Archiving must not destroy historical financial or operational data.

---

# 22. Branch Slug

Each branch should have a unique public slug.

Example:

```text
/berlin
```

The slug must be unique within the public routing namespace.

---

# 23. Public Branch URL

Initial architecture:

```text
clenqo.com/{branch-slug}
```

Example:

```text
clenqo.com/berlin
```

The exact production domain is environment configuration.

---

# 24. Future Domains

The architecture should eventually support:

```text
berlin.clenqo.com
```

and potentially:

```text
custom-domain.example
```

without requiring a separate application.

---

# 25. Branch Website

Every branch receives a localized website instance from the centralized master template.

It should include:

```text
homepage
service pages
contact
FAQ
legal pages
booking
navigation
footer
SEO configuration
```

---

# 26. Master Website Template

HQ controls the master website structure and design system.

Branches should not create arbitrary frontend code.

Branches configure approved:

* content
* images
* services
* contact details
* local information
* SEO
* approved sections

---

# 27. Branch Website Overrides

The content hierarchy may be:

```text
Platform Defaults
 ↓
Organization Defaults
 ↓
Branch Configuration
 ↓
Page Content
```

The exact inheritance model follows the CMS specification.

---

# 28. CMS Integration

The admin dashboard is also the CLENQO CMS.

Authorized users can edit frontend content through the dashboard.

Examples:

```text
announcement
hero
headings
paragraphs
buttons
images
services
process
testimonials
FAQ
CTA
footer
SEO
```

---

# 29. No Separate CMS

CLENQO should not introduce a separate CMS application for branch websites.

The architecture remains:

```text
Dashboard
 ↓
Central Database
 ↓
Public Next.js Frontend
```

---

# 30. Website Governance

HQ owns:

* design tokens
* typography
* component standards
* section registry
* approved section types
* core navigation rules
* global brand standards

Branch users manage approved local content.

---

# 31. Branch Customization

Branches may customize:

```text
local text
local images
local services
service availability
local contact information
local service area
local SEO
local promotions
```

subject to permissions and governance.

---

# 32. Protected Design

Branch users should not directly modify:

```text
React components
CSS architecture
Tailwind configuration
core design tokens
database schema
application logic
```

---

# 33. Global Content

Some content belongs to HQ.

Examples:

```text
brand story
corporate policies
core legal structure
global navigation standards
global footer standards
```

Global content should not be editable by ordinary branch users.

---

# 34. Branch Content

Branch-specific content may include:

```text
branch description
local phone
local address
opening hours
service area
local promotions
local testimonials
local SEO
```

---

# 35. Business Data vs CMS Content

The dashboard may display business data in frontend sections.

However, the CMS should not duplicate authoritative operational data.

Example:

```text
Service Price
→ Pricing Domain

Service Description
→ CMS

Service Availability
→ Service/Operations Domain
```

---

# 36. Service Management

Authorized administrators may manage:

* services
* variants
* add-ons
* branch availability
* service requirements

Service operational data remains separate from presentation content.

---

# 37. Pricing Management

Authorized users may manage:

* pricing profiles
* pricing versions
* rates
* difficulty
* add-ons
* surcharges
* discounts

Pricing follows `PRICING_ENGINE.md`.

---

# 38. Booking Management

Administrators should be able to:

```text
view
search
filter
create
modify
reschedule
cancel
assign
```

according to permissions.

---

# 39. Customer Management

Authorized staff may access customer information required for operations.

Customer access must remain branch-scoped unless HQ permissions allow broader visibility.

---

# 40. Employee Management

Authorized users may:

* create employees
* assign branches
* manage skills
* manage availability
* deactivate employees
* view operational schedules

Employment data must remain protected.

---

# 41. Operations Dashboard

The branch dashboard should provide:

```text
Today's Jobs
Unassigned
Starting Soon
In Progress
Completed
Issues
```

---

# 42. HQ Dashboard

The HQ dashboard should provide organization-wide visibility.

Possible metrics:

```text
total branches
active branches
bookings
revenue
jobs
employees
rating
open issues
```

---

# 43. Dashboard Personalization

Users may eventually configure:

```text
favorite views
dashboard widgets
default branch
saved filters
```

These preferences must not change authorization.

---

# 44. Branch Onboarding

A branch should have an onboarding workflow.

Example:

```text
Branch Created
 ↓
Basic Configuration
 ↓
Website Configuration
 ↓
Services
 ↓
Pricing
 ↓
Service Area
 ↓
Operating Hours
 ↓
Employees
 ↓
Manager
 ↓
Testing
 ↓
Activation
```

---

# 45. Branch Readiness

The dashboard should identify missing activation requirements.

Example:

```text
✓ Website
✓ Locale
✓ Services
✓ Pricing
✗ Operating Hours
✗ Service Area
```

The branch should not be activated until mandatory requirements are satisfied.

---

# 46. Branch Manager Assignment

HQ Admin may assign one or more managers to a branch.

Manager access is represented through authorization membership/scope.

---

# 47. Multiple Managers

A branch may have multiple managers.

This prevents the system from assuming:

```text
one branch = one manager
```

---

# 48. Multiple Branch Managers

A manager may eventually manage multiple branches.

Authorization must support this.

---

# 49. User Invitations

Authorized administrators may invite internal users.

Invitation flow:

```text
Admin
 ↓
Invite User
 ↓
Email
 ↓
Accept
 ↓
Account
 ↓
Membership
 ↓
Permissions
```

---

# 50. User Deactivation

Deactivating an internal user should revoke application access while preserving historical audit records.

Existing assignments or ownerships must be handled appropriately.

---

# 51. Permissions

Administration depends on explicit permissions.

Examples:

```text
branches.view
branches.create
branches.edit
branches.activate
branches.archive

users.view
users.invite
users.edit
users.deactivate

website.edit
website.publish

bookings.view
bookings.edit
bookings.cancel

employees.view
employees.edit

pricing.view
pricing.edit
pricing.publish

payments.view
payments.refund

quality.view
quality.manage
```

---

# 52. Global vs Branch Permissions

A permission and scope are separate.

Example:

```text
Permission:
bookings.edit

Scope:
Branch Berlin
```

does not grant:

```text
Branch Munich
```

access.

---

# 53. HQ Permissions

Some permissions may be organization-wide.

Example:

```text
branches.create
```

This should normally be restricted to HQ roles.

---

# 54. Branch Permissions

Branch-specific permissions may include:

```text
bookings.edit
employees.edit
website.edit
quality.manage
```

with branch scope.

---

# 55. Authorization Enforcement

The dashboard UI may hide unauthorized controls.

However, server-side authorization remains mandatory.

---

# 56. RLS

Supabase Row Level Security must enforce appropriate:

```text
organization scope
branch scope
customer ownership
employee/job scope
```

---

# 57. Server-Side Authorization

Every sensitive server action must validate authorization before executing business logic.

Example:

```text
Request
 ↓
Authentication
 ↓
Authorization
 ↓
Domain Validation
 ↓
Business Operation
```

---

# 58. Branch Creation Security

Branch creation must be restricted to authorized HQ users.

A normal branch manager must not be able to create arbitrary organization branches.

---

# 59. Branch Data Isolation

A branch manager must not be able to access another branch by manipulating:

```text
URL
query parameter
branch ID
request body
```

---

# 60. Audit Logging

Administrative operations should create audit records.

Examples:

```text
branch created
branch activated
branch deactivated
manager assigned
pricing published
website published
booking cancelled
refund issued
employee deactivated
```

---

# 61. Audit Metadata

Audit logs should capture appropriate:

```text
actor
organization
branch
action
resource
resource ID
timestamp
relevant change metadata
```

Avoid storing unnecessary sensitive payloads.

---

# 62. Dashboard Navigation

The centralized dashboard may be organized as:

```text
Overview

Operations
├── Bookings
├── Jobs
├── Calendar
├── Customers
└── Incidents

Workforce
├── Employees
├── Availability
└── Assignments

Website
├── Pages
├── Sections
├── Media
├── Navigation
└── SEO

Business
├── Services
├── Pricing
├── Payments
├── Invoices
└── Reports

Quality
├── Reviews
├── Complaints
└── Quality

Administration
├── Branches
├── Users
├── Roles
└── Settings
```

Visible items depend on permissions.

---

# 63. Dashboard Responsive Design

The admin application should support:

```text
desktop
tablet
mobile where operationally useful
```

The cleaner PWA remains a separate optimized experience.

---

# 64. Public vs Admin Application

The public website and admin dashboard may exist within the same Next.js application/codebase.

Conceptually:

```text
Next.js
├── Public Website
├── Booking
├── Customer Management
├── Admin Dashboard
└── Cleaner PWA
```

Shared infrastructure and domain modules should be reused.

---

# 65. No Branch-Specific Codebases

Do not create:

```text
berlin-app
munich-app
hamburg-app
```

Each branch is data/configuration.

---

# 66. Branch Configuration

Branch-specific behavior belongs in configuration/data.

Examples:

```text
locale
currency
timezone
operating hours
services
pricing
service area
contact details
website content
```

---

# 67. Country Configuration

Future multi-country operation may introduce country-level configuration.

Example:

```text
Country
 ↓
Tax
 ↓
Currency
 ↓
Payment Methods
 ↓
Legal Configuration
```

Country logic should remain modular.

---

# 68. HQ Governance

HQ should be able to establish organization-wide standards while allowing approved local variation.

This prevents every branch from becoming a separate product.

---

# 69. Configuration Precedence

Where inheritance is used, resolution must be deterministic.

Conceptually:

```text
Platform
 ↓
Organization
 ↓
Branch
 ↓
Service/Page/Feature
```

The exact precedence follows each domain's specification.

---

# 70. Branch Cloning

Future functionality may allow a new branch to start from an existing configuration/template.

Example:

```text
Create Branch
 ↓
Use Standard Branch Template
 ↓
Provision
```

Cloning must copy configuration intentionally, not create cross-branch dependencies.

---

# 71. Branch Template

A branch template may define:

```text
default pages
default sections
default services
default booking settings
default notification templates
```

Sensitive or branch-specific data must never be cloned accidentally.

---

# 72. Branch Deletion

Physical deletion of a branch should be extremely restricted.

Historical:

* bookings
* payments
* invoices
* jobs
* audits

should generally be retained according to retention rules.

Archiving is preferred over destructive deletion.

---

# 73. Branch Health

The HQ dashboard may eventually show branch health:

```text
website status
booking availability
unassigned jobs
employee coverage
quality
revenue
incidents
```

---

# 74. Branch Operational Readiness

A branch should be considered operationally ready only when required configuration exists.

Minimum examples:

```text
active branch
website
locale
service
pricing
operating hours
service area
booking configuration
notification configuration
```

---

# 75. Branch Activation Checklist

The system may provide an explicit checklist:

```text
☐ Branch profile
☐ Website
☐ Locales
☐ Services
☐ Pricing
☐ Hours
☐ Service area
☐ Manager
☐ Notifications
☐ Test booking
☐ Activate
```

---

# 76. Test Booking

Before activation, authorized staff should be able to perform a safe test booking.

Test operations must not accidentally:

* charge real money
* notify real customers
* create production jobs

when executed in a test mode.

---

# 77. Branch Monitoring

HQ should eventually be able to identify:

```text
booking failures
payment failures
notification failures
assignment failures
website errors
```

---

# 78. Branch-Level Analytics

Branch dashboards may expose:

```text
bookings
revenue
average order value
completion rate
rating
cancellation rate
employee utilization
```

---

# 79. Cross-Branch Analytics

HQ may compare branches.

Examples:

```text
revenue by branch
booking conversion
quality
completion
customer retention
```

Cross-branch analytics must use authorized aggregate access.

---

# 80. Data Export

Future dashboard functionality may support authorized exports.

Examples:

```text
bookings
customers
employees
financial records
quality reports
```

Exports must respect authorization and privacy requirements.

---

# 81. Admin Search

HQ may search across the organization where permitted.

Branch managers search only within authorized scope.

---

# 82. Global Search

Future global search may cover:

```text
branches
bookings
customers
jobs
employees
invoices
```

Results must remain permission-filtered.

---

# 83. System Settings

Global settings should be centrally managed where appropriate.

Examples:

```text
supported locales
brand settings
feature flags
notification defaults
platform policies
```

Branch-specific settings remain branch-scoped.

---

# 84. Feature Flags

Future functionality may use feature flags.

Example:

```text
WhatsApp notifications
enabled:
Branch A

disabled:
Branch B
```

Feature flags must not be used as a replacement for authorization.

---

# 85. Deployment Independence

All branches run from the same deployed application version.

A new deployment updates the platform.

Branch-specific behavior is controlled by data/configuration.

---

# 86. Migration Safety

Database migrations must be designed for all branches.

Never write migrations assuming:

```text
only one branch exists
```

---

# 87. Seed Data

Seeds may provide platform defaults.

Branch-specific production data must not be embedded as development seed assumptions.

---

# 88. Performance

The platform must remain performant as branch count increases.

Avoid queries that unnecessarily load:

```text
all customers
all bookings
all employees
```

when the current request only concerns one branch.

---

# 89. Scalability

The initial architecture remains a modular monolith.

Scaling strategy:

```text
Single Application
      ↓
Database Optimization
      ↓
Caching
      ↓
Background Workers
      ↓
Horizontal App Scaling
```

Microservices are not required for initial branch growth.

---

# 90. Reliability

Branch failures should not unnecessarily affect unrelated branches.

Examples:

```text
Branch A notification problem
```

should not prevent:

```text
Branch B booking
```

from functioning.

---

# 91. Background Processing

Long-running operations should use background processing where appropriate.

Examples:

```text
branch provisioning
bulk notifications
report generation
large exports
```

---

# 92. Provisioning Failure Handling

If provisioning fails:

```text
Branch
→ provisioning_failed
```

The system should provide:

* error visibility
* retry
* audit history

rather than requiring manual database repair.

---

# 93. Security

Administrative functionality must protect against:

* privilege escalation
* branch data leakage
* unauthorized branch creation
* unauthorized financial actions
* CMS abuse
* destructive configuration changes

---

# 94. Last Admin Protection

The system should prevent accidental removal/deactivation of the final organization administrator where that would lock the organization out.

---

# 95. Administrative Confirmation

High-impact actions may require explicit confirmation.

Examples:

```text
branch deactivation
large refund
user deactivation
pricing publication
```

---

# 96. Audit Requirements

High-impact administrative operations must be auditable.

Auditability is mandatory for:

```text
branch lifecycle
permissions
pricing
financial actions
customer-data access where required
CMS publishing
operational overrides
```

---

# 97. MVP Administration Scope

Initial implementation should include:

```text
organization
branches
branch creation
branch provisioning
branch activation
branch deactivation
branch context
HQ Admin
HQ Staff foundation
Branch Manager
permissions
dashboard
CMS integration
service management
pricing management
booking management
employee management
basic operations dashboard
audit logging
```

---

# 98. Future Administration Capabilities

Future versions may add:

* advanced role builder
* custom domains
* branch cloning
* advanced analytics
* feature flags
* bulk operations
* global search
* advanced reporting
* multi-country governance
* centralized support center
* franchise-style controls

---

# 99. Architectural Summary

The centralized administrative architecture is:

```text
                    CLENQO HQ
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Branch A     Branch B     Branch N
          │            │            │
          ↓            ↓            ↓
      Website      Website      Website
          │            │            │
          └────────────┼────────────┘
                       ↓
              Central Platform
                       ↓
              Central Database
```

All branches share the same platform while remaining isolated by authorization and branch-scoped data.

---

# 100. Golden Administration Rule

> **CLENQO must operate as one centralized platform, not a collection of branch applications. HQ controls global governance and creates/provisions branches, while authorized local users manage their branches within explicit scope. Every branch must be independently configurable, operationally isolated, auditable, and capable of scaling without architectural duplication.**
