# CLENQO Content Models

## 1. Purpose

This document defines how content is structured, stored, localized, validated, published, and displayed across CLENQO.

CLENQO uses a centralized content architecture.

Each branch receives localized content through configuration and content records rather than through a separate website codebase.

The content system must support:

* Multiple branches
* Multiple languages
* Reusable page templates
* Structured sections
* Services
* Pricing-related content
* Media
* SEO
* Local branch information
* Promotions
* Reviews
* Future content expansion

The content model must remain structured enough for reliable rendering while allowing controlled flexibility.

---

# 2. Content Architecture Principles

## 2.1 Structured content over arbitrary HTML

Content should be represented as structured data whenever practical.

Prefer:

```text
section_type
section_configuration
translation
media_reference
```

over storing entire pages as arbitrary HTML.

This allows:

* consistent rendering
* validation
* localization
* accessibility
* SEO control
* reusable components
* safer editing

---

## 2.2 Content is separate from presentation

Content defines:

```text
what to display
```

Components define:

```text
how to display it
```

For example:

```text
Hero content
    ↓
HeroSection component
```

The database should not contain React or presentation code.

---

# 3. Content Ownership

Content belongs to one of several scopes.

```text
Global
Organization
Branch
Page
Section
Service
Customer/Operational
```

The system must clearly distinguish these scopes.

---

# 4. Global Content

Global content is controlled centrally.

Examples:

* CLENQO brand name
* core brand identity
* legal defaults
* global navigation conventions
* global footer structure
* supported locales
* global website templates

Branches should not independently modify global brand standards.

---

# 5. Organization Content

Organization-level content represents content controlled by the organization.

Examples:

* company description
* organization contact information
* legal business information
* company-wide policies
* organization-wide promotions
* global testimonials where applicable

Organization content may be inherited by branches when explicitly configured.

---

# 6. Branch Content

Branch content represents localized operational and marketing information.

Examples:

* branch name
* branch address
* branch phone
* branch email
* service area
* opening hours
* local team
* local promotions
* local services
* local reviews
* local imagery
* local SEO metadata

Branch content must never override protected global brand standards.

---

# 7. Content Inheritance

The system may support controlled inheritance:

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

However, inheritance must be explicit.

Do not create complex automatic inheritance chains that make content difficult to understand.

The editor should be able to determine where displayed content originates.

---

# 8. Content Status

Content should use explicit lifecycle states.

Initial states:

```text
draft
published
archived
```

Some content may also require:

```text
scheduled
```

A draft must never accidentally appear on the public website.

---

# 9. Publishing Model

Publishing should be deliberate.

Conceptually:

```text
Draft
 ↓
Review
 ↓
Publish
 ↓
Public
```

The initial system may omit a formal review workflow, but the data model should not prevent one from being added later.

---

# 10. Website Model

A branch website is a configured instance of the CLENQO website system.

Conceptually:

```text
Branch
  ↓
Website
  ↓
Pages
  ↓
Sections
  ↓
Translations
  ↓
Media
```

There is one centralized frontend application.

There are many branch website configurations.

---

# 11. Website Template

A website template defines the approved structure and visual system.

Example:

```text
template_key:
clenqo-main
```

Templates should determine:

* available section types
* layout rules
* navigation patterns
* visual components
* page structure

Templates should not contain branch-specific content.

---

# 12. Page Model

A page represents a public website route.

Examples:

```text
/
/services
/services/home-cleaning
/about
/contact
/book
/faq
```

Suggested page properties:

```text
id
website_id
slug
page_type
status
sort_order
```

---

# 13. Page Types

Initial page types may include:

```text
home
services
service_detail
about
contact
booking
faq
reviews
legal
custom
```

The model must allow additional page types without database redesign.

---

# 14. Page Slugs

Slugs should be:

* URL-safe
* lowercase
* predictable
* unique within the website

Example:

```text
/services
/about
/contact
```

Localized URLs may be supported in the future.

The initial routing model should not require localized URL structures.

---

# 15. Page Translation

Each translatable page should have localized content.

Example:

```text
Page
 ├── German
 ├── English
 ├── French
 └── Spanish
```

Translation records should contain:

```text
title
meta_title
meta_description
```

and other page-level localized fields.

---

# 16. Supported Locales

Initial CLENQO locales:

```text
de
en
fr
es
```

The architecture must support additional locales later.

The supported language list should be configuration-driven rather than hardcoded throughout components.

---

# 17. Translation Rules

Translatable content should not be hardcoded directly inside components.

Avoid:

```tsx
if (locale === "de") {
  return "Reinigung buchen";
}
```

Prefer:

```text
content record
      ↓
locale
      ↓
rendered content
```

Application-level translation dictionaries may still be used for interface strings.

---

# 18. Interface Translation vs Content Translation

These are different systems.

## Interface translation

Controls application UI:

```text
Book now
Cancel
Save
Next
Back
```

## Content translation

Controls marketing/business content:

```text
Professional home cleaning in your area.
```

Both must support the same locale strategy but should remain logically separate.

---

# 19. Section Model

Pages are composed of ordered sections.

Conceptually:

```text
Page
 ├── Hero
 ├── Trust
 ├── Services
 ├── Process
 ├── Why CLENQO
 ├── Reviews
 ├── CTA
 └── Footer
```

Each section should have:

```text
section_type
section_key
sort_order
is_enabled
content
```

---

# 20. Section Registry

The frontend should maintain a section registry.

Conceptually:

```text
section_type
      ↓
component
      ↓
validation schema
```

Example:

```text
hero
  → HeroSection
  → HeroSchema

services_grid
  → ServicesGrid
  → ServicesGridSchema

testimonials
  → TestimonialsSection
  → TestimonialsSchema
```

The registry prevents arbitrary database content from becoming arbitrary executable UI.

---

# 21. Section Configuration

Section-specific configuration may use structured JSON.

Example:

```json
{
  "layout": "split",
  "alignment": "left",
  "showBadge": true
}
```

The exact structure must be validated using Zod.

Invalid configuration must not be rendered blindly.

---

# 22. Section Content

A section may contain:

```text
headline
eyebrow
description
CTA
image
items
metadata
```

Content should be separated where localization requires it.

---

# 23. Hero Model

A hero section may contain:

```text
eyebrow
headline
description
primary_cta
secondary_cta
image
badge
```

Example conceptual content:

```text
Eyebrow:
Professional Cleaning

Headline:
Clean Spaces. Better Living.

Description:
Reliable professional cleaning for homes and businesses.
```

The actual branch-specific text should come from content records.

---

# 24. CTA Model

Calls to action should be structured.

A CTA may contain:

```text
label
action_type
target
variant
```

Possible action types:

```text
internal_link
external_link
booking
phone
email
```

This avoids embedding arbitrary URLs throughout content.

---

# 25. Services Content

Services are operational entities, not merely marketing content.

A service may therefore have:

```text
service data
+
marketing content
+
translations
+
media
+
pricing relationship
```

The public website should derive service availability from the service configuration.

Do not advertise a branch service that is disabled operationally unless explicitly intended.

---

# 26. Service Content Fields

A service may expose:

```text
name
short_description
description
benefits
duration_information
included_items
excluded_items
image
faq
cta
```

Pricing itself should come from the pricing engine.

Marketing content must not become the authoritative source for calculated pricing.

---

# 27. Service Variants

A service may have variants.

Example:

```text
Home Cleaning
 ├── Regular Cleaning
 ├── Deep Cleaning
 └── Recurring Cleaning
```

Variant content should be structured independently.

This allows the booking system and website to use the same service catalog.

---

# 28. Add-On Content

Add-ons may contain:

```text
name
description
image
pricing display mode
availability
```

Actual pricing should come from the pricing engine.

The content system may display:

```text
From €15
```

only when that value is explicitly derived from the pricing system.

---

# 29. Pricing Content

Marketing pages may explain pricing concepts.

Examples:

```text
Simple pricing
Transparent quotes
No hidden fees
```

However:

> The content system must never become the authoritative pricing engine.

The pricing engine determines actual booking prices.

---

# 30. Branch Information Model

Branch pages may display:

```text
branch name
address
phone
email
opening hours
service area
```

These values should come from branch configuration wherever possible.

Avoid duplicating operational branch data as independent marketing content.

---

# 31. Contact Content

Contact pages may combine structured branch data with localized marketing copy.

Example:

```text
Structured:
phone
email
address
opening hours

Localized:
"Need help choosing a cleaning service?"
```

This keeps operational information synchronized.

---

# 32. Opening Hours

Opening hours should be modeled structurally.

Conceptually:

```text
Monday
09:00–18:00

Tuesday
09:00–18:00
```

Do not store opening hours only as free-form text.

Structured hours can later support:

* customer contact
* booking availability
* staff operations
* website display

---

# 33. Service Area

A branch service area should support structured configuration.

Possible representations include:

```text
postal codes
cities
districts
radius
custom zones
```

The initial implementation should use the simplest model that satisfies actual booking requirements.

---

# 34. SEO Model

Every public page should support:

```text
title
meta_title
meta_description
canonical_url
robots directives
social image
```

Not every field must be editable by branch users.

HQ-controlled defaults should be available.

---

# 35. SEO Defaults

Branch SEO may inherit defaults from the organization.

Example:

```text
Default title:
CLENQO | Professional Cleaning

Branch title:
CLENQO Berlin | Professional Cleaning
```

The final rendered value should be deterministic.

---

# 36. Open Graph

Pages may define:

```text
og_title
og_description
og_image
```

If no custom social image exists, the system may use the branch website default image.

---

# 37. Structured Data

The website should support structured data where appropriate.

Potential schema types:

```text
LocalBusiness
Service
Review
FAQPage
BreadcrumbList
```

Structured data should be generated from trusted application data.

Do not allow arbitrary schema markup from branch editors.

---

# 38. FAQ Model

FAQ content should be structured.

Each FAQ item:

```text
question
answer
sort_order
is_enabled
```

Translations should be supported.

FAQs may belong to:

* global website
* branch
* service
* page

---

# 39. Testimonials and Reviews

Testimonials and operational reviews are related but should not automatically be treated as identical.

A verified customer review should originate from the review system.

Marketing testimonials may be curated separately if the business later requires them.

Verified reviews should retain their source and status.

---

# 40. Promotions

Promotions should be structured rather than embedded inside arbitrary page text.

Possible fields:

```text
title
description
code
discount_type
start_at
end_at
status
```

The actual discount logic belongs to the pricing/booking domain.

Content only describes and presents the promotion.

---

# 41. Media Model

Media references should use database records.

Content should reference:

```text
media_asset_id
```

rather than embedding arbitrary storage paths everywhere.

This allows:

* asset replacement
* metadata management
* alt text
* ownership checks
* cleanup

---

# 42. Image Content

Images should include:

```text
asset
alt_text
caption
focal_point
```

where appropriate.

Alt text is content and should be localizable when necessary.

---

# 43. Video Content

Videos should use external or managed references rather than storing video binaries directly in ordinary database fields.

A video model may contain:

```text
provider
video_id
poster_image
title
```

The initial product does not require a complex video CMS.

---

# 44. Content References

Structured content may reference other entities.

Examples:

```text
Hero
 → Booking action

Services section
 → Services table

Reviews section
 → Reviews table

Branch contact
 → Branch record
```

References should be validated.

A deleted or disabled service must not silently produce broken public content.

---

# 45. Content Validation

Every editable content type must have a schema.

Example:

```text
HeroSchema
ServiceCardSchema
FAQSchema
CTA Schema
SEO Schema
```

Zod should validate content before:

* saving
* publishing
* rendering where necessary

---

# 46. Publishing Validation

Before publishing a page, validate:

* required translations
* required fields
* referenced media
* referenced services
* SEO requirements
* section configuration
* CTA targets
* accessibility-critical content

Invalid content must not be published.

---

# 47. Draft and Published Versions

The content architecture should allow a distinction between:

```text
current draft
published version
```

The initial implementation may use a simpler record status model.

As the CMS becomes more advanced, explicit revision tables can be introduced.

---

# 48. Content Revision Strategy

Important content may eventually require:

```text
content_revisions
```

with:

```text
id
entity_type
entity_id
version
content
created_by
created_at
published_at
```

This allows:

* rollback
* history
* auditability
* scheduled publishing

Do not implement full revision infrastructure until the product requires it.

---

# 49. Content Permissions

Content editing permissions follow the organizational hierarchy.

### HQ Admin

Can manage:

* global content
* organization content
* branch content

### HQ Staff

Access depends on assigned permissions.

### Branch Manager

Can manage approved content for assigned branches.

### Cleaner

Does not manage public website content.

Branch users must not be able to modify protected global brand configuration.

---

# 50. Content and RLS

Content tables must follow the same branch isolation principles as operational tables.

A branch manager for branch A must not be able to modify:

```text
branch B content
```

even if they manually call the API.

RLS and server-side authorization must enforce this.

---

# 51. Public Rendering

Public rendering should follow approximately:

```text
Request
 ↓
Resolve branch
 ↓
Resolve locale
 ↓
Load website
 ↓
Load page
 ↓
Load published sections
 ↓
Resolve referenced entities
 ↓
Validate/normalize content
 ↓
Render section registry
```

The public website must never render draft content accidentally.

---

# 52. Caching

Published website content is highly cacheable.

The architecture should support:

* static generation
* server caching
* revalidation
* CDN caching

When content is published, the appropriate cache should be invalidated or revalidated.

---

# 53. Content Editing Experience

The future admin content editor should provide:

* clear field labels
* previews
* language selection
* draft/publish controls
* media selection
* validation
* error messages
* section ordering
* enable/disable controls

The editor should not expose raw database structures to normal users.

---

# 54. Content Safety

Editors must not be able to inject arbitrary:

* JavaScript
* executable code
* unsafe HTML
* database queries
* server-side instructions

Rich text, where required, must be sanitized and controlled.

---

# 55. Content Accessibility

Editors should be guided toward accessible content.

Examples:

* required image alt text
* meaningful button labels
* heading hierarchy
* readable contrast
* descriptive links

Accessibility validation should be integrated into publishing where practical.

---

# 56. Content Analytics

Content may later include analytics metadata such as:

```text
campaign_id
source
experiment_id
```

However, analytics should not be embedded into every content record unnecessarily.

Analytics remains a separate domain.

---

# 57. Branch Website Default Structure

A newly provisioned branch website should be able to start from a standard structure such as:

```text
Home
 ├── Announcement
 ├── Navigation
 ├── Hero
 ├── Trust
 ├── Services
 ├── Process
 ├── Why CLENQO
 ├── Reviews
 ├── Pricing / Quote
 ├── FAQ
 ├── CTA
 └── Footer
```

Additional pages:

```text
Services
About
Contact
Booking
FAQ
Legal
```

The exact page set may evolve.

---

# 58. Content Provisioning

When a branch is created, the platform should provision:

```text
website
locales
default pages
default sections
default navigation
default SEO configuration
```

The content should be generated from approved master templates.

Branch-specific values should come from the new branch configuration.

---

# 59. Content Duplication Rule

Do not duplicate the same content into every branch unless necessary.

Prefer:

```text
Master configuration
+
Branch overrides
```

over:

```text
Branch A copy
Branch B copy
Branch C copy
...
```

This makes global updates easier.

However, branch content must remain independently editable where local customization is required.

---

# 60. Navigation Model

Navigation should be structured.

Conceptual fields:

```text
label
target_type
target
sort_order
is_enabled
locale
```

Navigation should not depend on hardcoded arrays scattered across page components.

---

# 61. Footer Model

The footer may contain:

```text
brand
branch contact
navigation
services
legal links
social links
language selector
```

Operational contact information should preferably come from structured branch data.

---

# 62. Legal Content

Legal pages should support:

```text
privacy
terms
imprint
cancellation_policy
```

Legal content may require organization-level or country-level control.

Branches should not independently alter legally sensitive global content unless explicitly authorized.

---

# 63. Localization Fallback

If a requested translation does not exist, the system should use a deterministic fallback.

Example:

```text
Requested:
fr

Fallback:
en

Fallback:
default branch locale
```

The final fallback strategy must be explicitly implemented.

A missing translation must never result in an unpredictable language mix.

---

# 64. Content Model Evolution

Content models will evolve as CLENQO grows.

Changes must follow:

```text
Business requirement
 ↓
Content model decision
 ↓
Documentation
 ↓
OpenSpec
 ↓
Migration
 ↓
Implementation
 ↓
Validation
```

Do not introduce arbitrary content fields directly in production.

---

# 65. Initial Content Model Priority

The first implementation should support:

```text
Branch
Website
Locales
Pages
Page translations
Sections
Section configuration
Media
Services
Service translations
FAQs
SEO
Navigation
```

Advanced features such as:

* revisions
* scheduled publishing
* experiments
* advanced personalization
* headless content APIs

can be introduced later.

---

# 66. Content System Boundary

The content system owns:

```text
what the website says
what sections exist
which media is displayed
which translations exist
which pages are published
```

It does not own:

```text
price calculation
booking availability
payment processing
employee scheduling
authentication
financial accounting
```

Those belong to their respective domains.

---

# 67. Golden Content Rule

> **CLENQO content must be structured, localized, validated, branch-aware, reusable, and safe to render—while keeping business logic outside the content layer.**
