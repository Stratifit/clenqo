# CLENQO CMS & Admin Content Management

## 1. Purpose

The CLENQO Dashboard is both:

1. the **business operations platform**, and
2. the **CMS/Admin system for the public frontend**.

The dashboard must provide authorized users with the ability to manage the content and configuration that powers each branch's public website.

The public website and dashboard are therefore two interfaces over the same centralized application and database.

Core relationship:

```text
Dashboard
    ↓
Application / Domain Services
    ↓
Supabase / PostgreSQL
    ↓
Published Content
    ↓
Public Next.js Website
```

The dashboard must not maintain a separate copy of frontend content.

---

# 2. Core Principle

> **If a public-facing element is intended to be editable by an authorized administrator, it must have a controlled representation in the database and a corresponding CMS editor in the dashboard.**

This includes, where applicable:

* announcement bar
* navigation
* hero
* headings
* paragraphs
* buttons
* images
* service sections
* process sections
* feature sections
* testimonials
* reviews
* pricing presentation
* FAQs
* CTAs
* footer
* SEO metadata
* page visibility
* section ordering
* section visibility

---

> **Resolved (BD-A2 + foundation boundary — Change 8 decision record):** the V1
> `/admin` foundation delivers exactly: login + session middleware; the
> protected admin shell (permission-aware navigation, account menu, sign
> out); the organization/branch context model with selector (BRANCH_SYSTEM
> §12–13); and an **operational dashboard** — organization/network identity,
> branch overview with lifecycle/provisioning state and provisioning
> failures, operational summary (bookings/jobs/employees counts from existing
> domain queries), quick actions, current user/role, and security/permission-
> aware navigation to available modules. Analytics-style metrics (revenue,
> ratings, performance) stay deferred to the Reporting change; the dashboard
> shows only data obtainable from existing domains without new business
> logic. First-run bootstrap (BD-A1, SECURITY §14 record) is part of the
> foundation; **branch application intake (C8-2) is NOT** — it is a separate
> future change. Domain editors (bookings, customers, services, scheduling,
> pricing, website/CMS, notifications, audit, settings) are later consumers
> of this shell, not part of it.

# 3. Dashboard Is the CMS

The CLENQO Dashboard is not only:

```text
Bookings
Employees
Customers
```

It also contains:

```text
Website
Content
Pages
Sections
Media
SEO
Languages
Navigation
```

The overall dashboard concept is:

```text
CLENQO Dashboard
│
├── Overview
│
├── Website
│   ├── Pages
│   ├── Sections
│   ├── Navigation
│   ├── Footer
│   ├── Media
│   ├── SEO
│   ├── Languages
│   └── Settings
│
├── Bookings
├── Calendar
├── Jobs
├── Customers
├── Employees
├── Services
├── Pricing
├── Payments
├── Invoices
├── Reviews
├── Reports
└── Settings
```

Visible modules depend on the user's permissions and scope.

> **Resolved (BD-B1–BD-B3 — Change 9 decision record):** the Bookings and
> Customers modules enter the operational dashboard in Change 9
> (`create-booking-admin-ui`) as consumers of the existing Booking/Customer
> domain contracts under the Change 8 shell: branch-scoped lists per BD-B1,
> staff customer detail + `customers.edit` editing per BD-B2, and staff
> booking creation through the existing `staffCreateBookingAction` per
> BD-B3 (no second booking engine; no new permissions; no migration). The
> Website/Content/Sections/Media/SEO modules above remain the future CMS
> change; Payments/Invoices/Reviews/Reports remain their own future changes.
>
> **Implemented (Change 9):** both modules are live under the Change 8 shell
> (`(admin)` group): `/admin/bookings`, `/admin/bookings/new`,
> `/admin/bookings/[id]` (detail + read-only staff timeline), and
> `/admin/customers`, `/admin/customers/[id]` (detail, `customers.edit`
> editing, address manager). Navigation entries are permission-aware
> (`bookings.view` / `customers.view`); every request re-validates the
> Change 8 branch context server-side (BD-B1 isolation verified by domain +
> hosted RLS tests).

---


# 4. One Centralized Platform

There must not be a separate CMS application for every branch.

The platform consists of:

```text
One codebase
One application
One database
One CMS architecture
Many branch configurations
```

Example:

```text
CLENQO
│
├── Berlin
│   └── Website configuration/content
│
├── Munich
│   └── Website configuration/content
│
└── Hamburg
    └── Website configuration/content
```

All are managed through the same dashboard.

---

# 5. Branch-Aware CMS

Every branch website is identified through its branch context.

For example:

```text
Dashboard
    ↓
Branch: Berlin
    ↓
Website
    ↓
Home
    ↓
Hero
```

The CMS loads only content the authenticated user is authorized to manage.

A Branch Manager assigned to Berlin must not be able to edit Munich's website.

---

# 6. HQ CMS Scope

HQ administrators may manage:

* global website templates
* organization-wide content
* branch websites
* approved section types
* global navigation rules
* global SEO defaults
* brand configuration
* media policies
* supported languages
* branch-specific content where authorized

HQ should control the master design system.

---

# 7. Branch CMS Scope

A Branch Manager may manage approved local content such as:

* branch homepage content
* local service descriptions
* branch contact information
* opening hours
* local images
* local FAQs
* local promotions
* local SEO
* branch-specific pages
* local testimonials/reviews

They must not be able to modify protected global design standards.

---

# 8. CMS and Frontend Relationship

The frontend is a renderer of CMS content.

Conceptually:

```text
Database Content
       ↓
Content Resolver
       ↓
Section Registry
       ↓
React Components
       ↓
Public Website
```

The CMS does not generate React source code.

It provides structured data consumed by predefined frontend components.

---

# 9. Section Registry

Every editable frontend section must belong to a controlled section registry.

Example:

```text
section_type          component
------------------------------------------------
hero                  HeroSection
announcement          AnnouncementSection
trust                 TrustSection
services_grid         ServicesGridSection
process               ProcessSection
features              FeaturesSection
testimonials          TestimonialsSection
pricing               PricingSection
faq                   FAQSection
cta                   CTASection
```

The registry connects:

```text
Database
    ↓
Section Type
    ↓
Validation Schema
    ↓
Editor
    ↓
Frontend Component
```

---

# 10. Section Definition

Each section type should have a definition containing:

```text
id
section_type
label
description
editor_schema
frontend_component
allowed_locations
supported_features
```

Conceptually:

```ts
{
  type: "hero",
  label: "Hero",
  schema: HeroSchema,
  editor: HeroEditor,
  renderer: HeroSection
}
```

The exact implementation belongs to the application architecture.

---

# 11. Section Editor

Every editable section should have a corresponding dashboard editor.

Example:

```text
Hero
────────────────────────────

Eyebrow
[ Professional Cleaning        ]

Headline
[ Clean Spaces. Better Living. ]

Description
[ Reliable professional cleaning... ]

Image
[ Select Media ]

Primary Button
Label: [ Book a Cleaning ]
Action: [ Booking ]

Secondary Button
Label: [ View Services ]
Action: [ Internal Page ]

[ Save Draft ] [ Publish ]
```

The editor should be generated from controlled schemas where practical.

---

# 12. Section Schema

Each section must have a validation schema.

Example:

```text
Hero
├── eyebrow: optional string
├── headline: required string
├── description: optional string
├── image: optional media reference
├── primary_cta: optional CTA
└── secondary_cta: optional CTA
```

Zod should validate section data.

Invalid content must not be silently saved or rendered.

---

# 13. Structured Editing

The CMS should expose structured fields rather than raw JSON.

Administrators should see:

```text
Headline
Description
Image
Button
```

not:

```json
{
  "headline": "...",
  "description": "..."
}
```

Raw JSON editing should not be part of the normal CMS experience.

Developer/debug tools may expose raw configuration where necessary.

---

# 14. Page Builder

The CMS should provide a controlled page-building experience.

Conceptually:

```text
Home
────────────────────────────

☰ Announcement
☰ Navigation
☰ Hero
☰ Trust
☰ Services
☰ Process
☰ Why CLENQO
☰ Reviews
☰ Pricing
☰ FAQ
☰ CTA
☰ Footer
```

Administrators should be able to:

* reorder sections
* enable sections
* disable sections
* edit sections
* duplicate supported sections where appropriate
* preview changes

---

# 15. Section Ordering

Each page section has a `sort_order`.

Example:

```text
10  Hero
20  Trust
30  Services
40  Process
50  Reviews
60  FAQ
70  CTA
```

Using gaps allows future insertions without requiring constant renumbering.

The frontend renders sections in their active order.

---

# 16. Section Visibility

Sections should support:

```text
enabled
disabled
```

Disabled sections remain stored.

They are simply not rendered publicly.

This allows an administrator to temporarily hide content without deleting it.

---

# 17. Section Duplication

Some section types may support duplication.

For example:

```text
Feature Grid
Feature Grid
Feature Grid
```

However, not every section should be freely duplicated.

The registry should define:

```text
allow_multiple
```

or an equivalent rule.

---

# 18. Protected Sections

Certain sections may be required or controlled by the platform.

Examples:

* legal footer
* booking system integration
* mandatory navigation
* required compliance information

The CMS must distinguish between:

```text
editable
optional
required
protected
```

---

# 19. Page Templates

A page template defines the default structure for a page.

Example:

```text
Home Template
├── Announcement
├── Navigation
├── Hero
├── Trust
├── Services
├── Process
├── Why CLENQO
├── Reviews
├── FAQ
├── CTA
└── Footer
```

When a new branch is provisioned, the branch website receives the approved template.

---

# 20. Template vs Content

Templates define structure.

Content defines values.

Example:

```text
Template:
Hero section exists.

Content:
Headline = "Professional Cleaning in Berlin"
```

Do not store branch content directly inside template definitions.

---

# 21. Master Templates

HQ controls master templates.

A master template may define:

* page types
* allowed sections
* default ordering
* required sections
* default content
* design constraints

Branches receive an instance of the template.

---

# 22. Branch Overrides

Branches may override approved content.

Example:

```text
Master:
"Professional Cleaning"

Berlin:
"Professional Cleaning in Berlin"
```

The branch override belongs to the branch website content.

It does not modify the master template.

---

> **Resolved (C8-4 — Change 8 decision record):** V1 uses the **lighter
> ownership model (option B)**: role + RLS + explicit domain rules — no
> generic field-level configuration-metadata engine is built. The V1 rule:
> *HQ/master-controlled* = brand, master website structure/components,
> master policy templates, security/permission framework, supported-language
> framework, global booking rules (enforced by `hq_admin`-only permissions
> and RLS); *branch-owned* = contact details, local content/images/SEO,
> services offering, pricing configuration, hours/service area operations
> (enforced by branch-scoped permissions + `membership_branches`); *system-
> protected* = organization/branch IDs, provisioning lifecycle, audit
> metadata, RLS configuration (no application role can write these — schema
> enforced). "Default / inherited / overridden" semantics exist only where a
> domain already models them (website template defaults per branch;
> cancellation policies); no new inheritance mechanism in V1. HQ default
> changes do not retroactively mutate branch-owned values. All ownership-
> relevant changes are audited per existing domain conventions. Revisit a
> metadata-driven engine only when a concrete domain requires it.

> **Resolved (C8-5 — Change 8 decision record):** no generic policy engine in
> V1. Classification: *cancellation policy* — already modeled (booking
> domain, versioned); *rescheduling policy* — global booking rules (booking
> domain constraints, BD-3), not branch-authored in V1; *service-area* —
> branch-owned operational configuration (existing `branches.service_area`);
> *payment policy, privacy/terms pages, operational policy templates* —
> **deferred**: master-template instantiation for legal/policy content
> belongs to the public-website/policy change and is recorded there, not
> invented here. Nothing in this decision removes an existing modeled
> policy.

# 23. Content Inheritance

Where inheritance is implemented:

```text
Global
 ↓
Organization
 ↓
Branch
 ↓
Page
 ↓
Section
```

The CMS should clearly indicate the source of inherited content.

Administrators should never have to guess why a value appears on the frontend.

---

# 24. CMS Content Sources

A public section may receive information from:

### Static CMS content

Example:

```text
Hero headline
```

### Database entity

Example:

```text
Services section
 → active branch services
```

### Dynamic business data

Example:

```text
Opening hours
 → branch configuration
```

### Computed data

Example:

```text
Starting price
 → pricing engine
```

The CMS must not duplicate authoritative business data unnecessarily.

---

# 25. Business Data vs Marketing Content

This distinction is mandatory.

For example:

```text
Service Name
```

should come from the service domain.

```text
Service Price
```

should come from the pricing engine.

```text
Marketing headline about the service
```

may come from the CMS.

The CMS must not become a second source of truth for operational data.

---

# 26. Direct Database Connection

The dashboard and frontend both connect to the centralized Supabase/PostgreSQL architecture.

The browser must never receive unrestricted database credentials.

Preferred architecture:

```text
Dashboard UI
    ↓
Next.js Server Actions / Route Handlers
    ↓
Authorization
    ↓
Domain Service
    ↓
Supabase
    ↓
PostgreSQL
```

Public frontend:

```text
Public Request
    ↓
Next.js
    ↓
Published Content Resolver
    ↓
Supabase/PostgreSQL
```

---

# 27. Supabase RLS

RLS remains the database-level security boundary.

CMS permissions must be enforced through:

* authenticated identity
* organization membership
* branch scope
* role
* database policies

Frontend visibility is not security.

---

# 28. CMS Save Flow

When an administrator saves content:

```text
Admin edits section
       ↓
Client validation
       ↓
Server validation
       ↓
Authorization
       ↓
Database transaction
       ↓
Draft saved
       ↓
Audit event
```

The frontend should continue displaying the currently published version until the draft is published.

---

# 29. Draft System

Content should support:

```text
draft
published
archived
```

An administrator may edit a draft without immediately changing the public website.

Example:

```text
Published:
"Professional Cleaning"

Draft:
"Professional Cleaning — Now Available 7 Days a Week"
```

The public website continues showing the published version until publication.

---

# 30. Publishing Flow

Publishing should be explicit.

```text
Draft
 ↓
Validate
 ↓
Publish
 ↓
Published
 ↓
Cache Revalidation
```

Publishing should validate:

* required fields
* section schema
* translations
* referenced media
* referenced entities
* SEO
* CTA targets

---

# 31. Preview

The CMS should support previewing draft content before publishing.

Conceptually:

```text
Dashboard
    ↓
Preview
    ↓
Preview Renderer
    ↓
Draft Content
```

Preview must not expose drafts as public content.

A secure preview mechanism should be used.

---

# 32. Preview Modes

The system should eventually support:

```text
Desktop
Tablet
Mobile
```

and:

```text
German
English
French
Spanish
```

This helps administrators verify localized layouts.

---

# 33. Live Preview

A future enhanced CMS may support near-live preview:

```text
Editor
   ↕
Preview
```

Changes can appear in the preview without being published.

This is optional for the first implementation.

The architecture should not prevent it.

---

# 34. Media Manager

The dashboard should contain a centralized media manager.

Capabilities:

* upload
* browse
* search
* preview
* replace
* metadata editing
* alt text
* delete/archive where safe
* branch filtering

Media ownership must be enforced.

---

# 35. Media Selection

When editing a section:

```text
Hero Image
[ Select Media ]
```

the administrator should be able to choose an existing media asset or upload a new one.

The editor should store a media reference rather than duplicating the file.

---

# 36. Media Optimization

Uploaded media should eventually support:

* validation
* size limits
* image optimization
* responsive variants
* metadata extraction

The public frontend should use optimized images.

---

# 37. SEO Editor

Each page should provide an SEO panel.

Example:

```text
SEO
────────────────────────────

Meta Title
[ CLENQO Berlin | Professional Cleaning ]

Meta Description
[ Professional cleaning services... ]

Social Image
[ Select Media ]

Canonical URL
[ Automatic ]

Robots
[ Index / Follow ]
```

Automatic defaults should exist so administrators do not need to configure everything manually.

---

# 38. Navigation Editor

The dashboard should allow authorized administrators to manage navigation.

Example:

```text
Navigation
────────────────────────────

☰ Home
☰ Services
☰ About
☰ Contact
☰ Book a Cleaning
```

Supported operations:

* reorder
* enable/disable
* change label
* change target
* add approved navigation item

---

# 39. Footer Editor

The footer should be configurable through the CMS where appropriate.

Possible editable areas:

* footer text
* navigation groups
* contact presentation
* service links
* social links

Operational contact information should continue to come from branch data.

---

# 40. Global Design Restrictions

The CMS must not allow normal branch editors to change core CLENQO design tokens.

Protected values include:

```text
Sora
Plus Jakarta Sans

#07742F
#F2E543
#F3F8EE
#18211C
```

The CMS edits content and approved configuration.

It does not allow arbitrary CSS modification.

---

# 41. Component Safety

CMS content must never execute arbitrary code.

Administrators must not be able to enter:

```text
JavaScript
React code
server code
SQL
```

as CMS content.

Rich text must be sanitized and controlled.

---

# 42. Rich Text

Where rich text is necessary, use a controlled rich-text format.

Supported formatting may include:

* paragraph
* bold
* italic
* headings
* links
* lists
* quotes

Avoid arbitrary HTML unless there is a documented requirement.

---

# 43. CTA Editor

CTA configuration should use structured fields.

Example:

```text
Button label:
Book a Cleaning

Action:
Booking

Style:
Primary
```

Supported targets may include:

```text
page
booking
phone
email
external URL
```

The system should validate targets.

---

# 44. Dynamic Service Sections

A Services section should be able to operate dynamically.

Example:

```text
Services Section
    ↓
Branch ID
    ↓
Active Services
    ↓
Render Service Cards
```

The administrator may configure:

```text
title
description
display style
selected services
```

but the service's authoritative operational state remains in the services domain.

---

# 45. Dynamic Review Sections

Review sections may query published/approved reviews.

The CMS may control:

* heading
* layout
* number displayed
* selected reviews
* display options

The review system remains the source of truth for review records.

---

# 46. Dynamic Pricing Sections

Pricing sections may display pricing information supplied by the pricing engine.

The CMS can control:

* headline
* explanatory text
* layout
* CTA

The CMS must not manually override calculated booking prices.

---

# 47. Forms

Website forms such as:

* contact
* booking
* quote requests

are application functionality.

The CMS may configure:

* labels
* descriptions
* confirmation messages
* selected fields where supported

but validation and business processing belong to application domains.

---

# 48. CMS Permissions

CMS permissions should be granular enough to protect important content.

Potential permissions:

```text
website.view
website.edit
website.publish

pages.view
pages.edit
pages.publish

media.view
media.manage

seo.edit

navigation.edit

global_content.edit
branch_content.edit
```

The exact permission system may be implemented later.

---

# 49. Role Defaults

### HQ Admin

Full CMS access.

### HQ Staff

Configurable according to assigned permissions.

### Branch Manager

CMS access for assigned branches.

### Cleaner

No public website CMS access by default.

---

# 50. Auditability

Important CMS actions must be audited.

Examples:

```text
page_created
page_updated
section_created
section_updated
section_deleted
content_published
content_unpublished
media_uploaded
media_deleted
seo_updated
navigation_updated
```

Audit records should identify:

* actor
* branch
* entity
* action
* timestamp

---

# 51. Versioning

The CMS should eventually support content revisions.

A revision may contain:

```text
entity
version
content
created_by
created_at
published_at
```

This enables:

* history
* rollback
* comparison
* accountability

Full revision tooling is not required before the core CMS is operational.

---

# 52. Autosave

Autosave may be introduced later.

If implemented, autosave should save drafts only.

It must never automatically publish public content.

---

# 53. Scheduled Publishing

Future support may include:

```text
Publish:
2027-01-01 00:00
```

The architecture should allow scheduled publication without redesigning the content model.

This is not required for the first MVP.

---

# 54. Cache Revalidation

After publishing:

```text
Publish
 ↓
Invalidate/revalidate affected routes
 ↓
Frontend receives published content
```

The system must avoid unnecessary global cache invalidation.

Prefer invalidating:

* affected branch
* affected page
* affected locale

where practical.

---

# 55. Public Rendering Rule

The public website must render only:

```text
published
```

content.

It must never accidentally render:

```text
draft
archived
```

content.

Preview is the only controlled exception.

---

# 56. Failure Handling

If CMS content is invalid or unavailable:

The frontend should fail gracefully.

Possible strategies:

* fallback to previous published version
* fallback to default content
* hide optional section
* show safe error state

A single malformed optional section should not unnecessarily destroy the entire public website.

---

# 57. Branch Provisioning and CMS

When HQ creates a branch:

```text
Create Branch
      ↓
Provision Website
      ↓
Provision Pages
      ↓
Provision Sections
      ↓
Provision Locales
      ↓
Provision Default Content
      ↓
Ready for CMS Editing
```

The branch manager should be able to enter the dashboard immediately and customize the approved content.

---

# 58. Example Branch Creation

HQ creates:

```text
Branch:
Berlin

Slug:
berlin
```

The system automatically creates:

```text
clenqo.com/berlin

Home
Services
About
Contact
FAQ
Booking

Hero
Trust
Services
Process
Reviews
FAQ
CTA
```

The manager then edits:

```text
Headline:
Professional Cleaning in Berlin

Phone:
+49 ...

Opening Hours:
...

Local Service Area:
...
```

No new frontend project is created.

---

# 59. CMS-to-Frontend Example

Administrator changes:

```text
Hero headline:
"Professional Cleaning in Berlin"
```

Database:

```text
website_sections
    ↓
section_type = hero
    ↓
content
```

Frontend:

```text
HeroSection
    ↓
reads published hero content
    ↓
renders new headline
```

After publishing and cache revalidation, the public website displays the new content.

---

# 60. CMS-to-Frontend Data Flow

The complete model is:

```text
                  ┌───────────────────────┐
                  │      Dashboard        │
                  │                       │
                  │ CMS / Admin / Ops     │
                  └───────────┬───────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Server / Domain  │
                    │ Services         │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Supabase         │
                    │ PostgreSQL       │
                    │ RLS              │
                    └────────┬─────────┘
                             │
                     Published Data
                             │
                             ▼
                    ┌──────────────────┐
                    │ Next.js Frontend │
                    │ Section Registry │
                    └────────┬─────────┘
                             │
                             ▼
                    Public Branch Website
```

---

# 61. CMS Does Not Mean Page Code Editing

The administrator edits:

```text
content
configuration
ordering
visibility
media
SEO
navigation
```

The administrator does not edit:

```text
React
TypeScript
CSS source
Next.js routes
database SQL
```

This keeps the platform safe and maintainable.

---

# 62. Developer vs Administrator Responsibilities

### Developer

Controls:

* component implementation
* section registry
* schemas
* design system
* routing
* business logic
* database migrations
* permissions
* security
* frontend architecture

### Administrator

Controls:

* content
* pages
* sections
* media
* SEO
* local information
* approved configuration
* publication

This boundary is essential.

---

# 63. CMS Extensibility

Adding a new editable frontend section should follow:

```text
1. Define business/content requirement
2. Create section schema
3. Create editor
4. Create frontend component
5. Register section
6. Add database support if required
7. Add permissions
8. Add tests
9. Document behavior
10. Deploy
```

Existing branches should receive the new section only when intentionally enabled.

---

# 64. No Hardcoded Branch Content

Avoid:

```tsx
if (branch === "berlin") {
  return "Professional Cleaning in Berlin";
}
```

Instead:

```text
branch
 ↓
database
 ↓
published content
 ↓
renderer
```

The codebase must remain branch-independent.

---

# 65. No Separate Branch Frontends

Do not create:

```text
clenqo-berlin
clenqo-munich
clenqo-hamburg
```

as separate applications.

Use:

```text
one CLENQO frontend
+
branch context
+
branch content
```

---

# 66. CMS Performance

The CMS must remain responsive even as content grows.

Use:

* indexed queries
* server-side data fetching
* appropriate caching
* pagination for large datasets
* optimized media
* selective revalidation

Do not load the entire organization content database into every dashboard page.

---

# 67. CMS Testing

CMS testing must verify:

### Editing

* section creation
* section editing
* section deletion
* section ordering
* visibility changes

### Publishing

* drafts remain private
* published content appears publicly
* invalid content cannot publish
* cache revalidation occurs

### Permissions

* HQ access works
* branch isolation works
* unauthorized users are denied

### Rendering

* correct component renders
* correct content renders
* missing optional data is handled safely

---

# 68. Initial CMS MVP

The first CMS implementation should support:

```text
Website
 ├── Pages
 │   ├── Create
 │   ├── Edit
 │   ├── Delete/Archive
 │   └── Publish
 │
 ├── Sections
 │   ├── Add
 │   ├── Edit
 │   ├── Reorder
 │   ├── Enable/Disable
 │   └── Publish
 │
 ├── Media
 │   ├── Upload
 │   ├── Browse
 │   └── Select
 │
 ├── SEO
 ├── Navigation
 └── Preview
```

Combined with the existing operational modules.

---

# 69. Future CMS Capabilities

The architecture should leave room for:

* drag-and-drop page building
* visual preview
* revision history
* rollback
* scheduled publishing
* content approval workflow
* reusable content blocks
* A/B testing
* campaign management
* advanced personalization
* AI-assisted content generation
* AI translation
* custom domains

These are not initial requirements.

---

# 70. CMS Golden Rule

> **The CLENQO Dashboard is the controlled CMS and operational command center for the entire platform. Authorized administrators edit structured content in the dashboard, that content is stored in the centralized Supabase/PostgreSQL database, and the public Next.js frontend renders the published database state through a safe section registry.**
