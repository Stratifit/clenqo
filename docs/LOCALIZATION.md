# CLENQO Localization Architecture

## 1. Purpose

This document defines the localization and internationalization architecture for CLENQO.

CLENQO must support multiple languages from the beginning while keeping the system simple enough to operate and extend.

Initial supported languages:

```text
de — German
en — English
fr — French
es — Spanish
```

The architecture must allow additional languages without requiring a redesign of the database or frontend.

Localization applies to:

* public branch websites
* CMS content
* booking experience
* customer booking management
* cleaner PWA
* HQ dashboard
* branch dashboard
* emails
* notifications
* SEO
* service content
* FAQs
* transactional messages

---

# 2. Core Principle

> **Localization is a first-class platform capability, not a collection of hardcoded translations.**

The system must distinguish between:

1. interface translations
2. business/content translations
3. locale-specific formatting
4. branch language configuration

These are related but separate concerns.

---

# 3. Initial Languages

CLENQO launches with:

| Code | Language | Direction |
| ---- | -------- | --------- |
| `de` | German   | LTR       |
| `en` | English  | LTR       |
| `fr` | French   | LTR       |
| `es` | Spanish  | LTR       |

The codes should follow standard language-code conventions.

Do not use arbitrary identifiers such as:

```text
german
english
french
spanish
```

for database locale values.

---

# 4. Future Language Expansion

The architecture must allow languages such as:

```text
it
nl
pt
ar
```

to be added later.

Adding a language should primarily require:

```text
new locale configuration
+
translations
```

rather than database restructuring.

---

# 5. Locale vs Language

A language and a locale are not always identical.

For the initial system:

```text
de
en
fr
es
```

are sufficient.

The architecture should remain capable of supporting regional locales later:

```text
de-DE
en-DE
fr-FR
en-CM
```

Do not introduce regional complexity until there is a real business requirement.

---

# 6. Branch Language Configuration

Each branch should define:

```text
default_locale
enabled_locales
```

Example:

```text
Berlin
default:
de

enabled:
de
en
fr
es
```

Another branch may eventually use:

```text
default:
fr

enabled:
fr
en
```

The branch configuration determines which languages are publicly available.

---

# 7. Organization Language Configuration

The organization may define the master set of supported locales.

Conceptually:

```text
Organization
    ↓
Supported locales
    ↓
Branch enabled locales
```

A branch cannot enable a language that the platform does not support.

---

# 8. CMS Language Selector

The CMS should provide a clear language selector.

Example:

```text
Page: Home

Language:
[ Deutsch ▼ ]
```

Available:

```text
Deutsch
English
Français
Español
```

The administrator edits the selected language's content.

---

# 9. Translation Status

The CMS should clearly indicate translation status.

Example:

```text
Home

German       ✓ Published
English      ✓ Published
French       ⚠ Draft
Spanish      ○ Not translated
```

Possible statuses:

```text
not_started
draft
published
outdated
```

The exact implementation may evolve.

---

# 10. Translation Workflow

The intended workflow is:

```text
Create content
      ↓
Default language
      ↓
Translate
      ↓
Review
      ↓
Publish
```

A translation should not automatically become public merely because the source language was published.

---

# 11. Default Language

Every branch website must have one default locale.

Example:

```text
default_locale = de
```

The default locale should be used when:

* no locale is explicitly selected
* a user visits the default route
* fallback rules require it

There must be exactly one default locale per website.

---

# 12. Public Language Selection

The public website should provide a language selector where multiple languages are enabled.

Example:

```text
DE | EN | FR | ES
```

The selected language should persist appropriately through the user's session or URL.

---

# 13. URL Strategy

The initial branch URL structure is:

```text
clenqo.com/{branch-slug}
```

Example:

```text
clenqo.com/berlin
```

Language routing should be designed consistently.

The preferred initial approach is to avoid unnecessarily complex URL structures.

A possible future structure is:

```text
clenqo.com/berlin
clenqo.com/berlin/en
clenqo.com/berlin/fr
```

The final routing implementation should be decided during frontend architecture implementation.

The database must not depend on one URL strategy.

---

# 14. Branch Resolution

Public rendering should first resolve:

```text
branch
```

then:

```text
locale
```

Conceptually:

```text
URL
 ↓
Branch
 ↓
Website
 ↓
Requested Locale
 ↓
Fallback Locale
 ↓
Published Content
```

Branch resolution must occur independently from language resolution.

---

# 15. Interface Translations

Interface translations cover application UI.

Examples:

```text
Book a Cleaning
Save
Cancel
Next
Back
Confirm
Loading
No results
```

These translations should generally be maintained in application translation resources rather than the CMS database.

---

# 16. CMS Content Translations

CMS-managed content is stored in the database.

Examples:

```text
Hero headline
Hero description
Service description
FAQ question
FAQ answer
SEO title
SEO description
CTA label
```

These should use the database content model described in `CONTENT_SYSTEM.md`.

---

# 17. Why UI and CMS Translations Are Separate

The dashboard UI should not require a database request simply to display:

```text
Save
Cancel
Delete
```

Likewise, a branch's marketing content should not be compiled into the application source code.

Therefore:

```text
UI translations
→ application locale resources

CMS content
→ PostgreSQL/Supabase
```

---

# 18. Translation Keys

Application UI strings should use stable translation keys.

Example:

```text
booking.actions.confirm
booking.actions.cancel
booking.summary.total
```

Avoid using English sentences as translation keys.

Bad:

```text
"Confirm Booking"
```

Better:

```text
booking.confirm
```

---

# 19. Translation Resource Structure

A conceptual structure:

```text
i18n/
├── de/
│   ├── common.json
│   ├── booking.json
│   ├── dashboard.json
│   └── validation.json
│
├── en/
│   ├── common.json
│   ├── booking.json
│   ├── dashboard.json
│   └── validation.json
│
├── fr/
│   └── ...
│
└── es/
    └── ...
```

The final directory structure may change with the selected i18n implementation.

---

# 20. Translation Interpolation

UI translations must support variables.

Example:

```text
Hello, {name}
```

or:

```text
You have {count} bookings.
```

Do not concatenate translated fragments manually.

Avoid:

```text
"Hello " + name + ", welcome"
```

because word order can differ between languages.

---

# 21. Pluralization

The localization system must support language-appropriate pluralization.

Example:

```text
1 booking
2 bookings
```

French, German, Spanish, and future languages may have different grammatical rules.

Use the selected i18n library's pluralization capabilities.

Do not implement plural rules manually inside components.

---

# 22. Date Formatting

Dates must be formatted according to locale.

Example:

```text
German:
14.09.2026

English:
09/14/2026

French:
14/09/2026
```

The exact format should be generated by locale-aware APIs.

Do not hardcode display formats.

---

# 23. Time Formatting

Time should respect the user's or relevant branch timezone.

For example:

```text
14:30
```

or:

```text
2:30 PM
```

depending on locale and user preference.

The database stores timestamps in UTC.

---

# 24. Timezone

Timezone is separate from language.

A German-language user does not necessarily have the same timezone as every other German-language user.

Operational branch times should use the branch timezone.

Customer-facing dates may use the appropriate booking/branch context.

---

# 25. Currency Formatting

Currency formatting must use locale-aware formatting.

Example:

```text
€129.00
129,00 €
```

depending on locale and formatting context.

The underlying financial value must remain numeric.

Never store formatted currency strings as the financial source of truth.

---

# 26. Financial Records

Financial records store:

```text
amount
currency
```

For example:

```text
amount:
129.00

currency:
EUR
```

The frontend decides how to display the value.

---

# 27. Number Formatting

Locale-aware number formatting should be used for:

* prices
* percentages
* quantities
* distances
* statistics

Do not manually replace commas and periods.

---

# 28. Relative Dates

Where appropriate:

```text
Today
Tomorrow
Yesterday
In 3 days
```

must be localized.

Avoid hardcoded English relative-date labels.

---

# 29. Address Formatting

Addresses are locale-sensitive.

The database should store structured address fields:

```text
street
house_number
postal_code
city
region
country
```

The frontend determines presentation order.

Do not store only one preformatted address string as the authoritative representation.

---

# 30. Phone Numbers

Phone numbers should be stored in a standardized format where practical.

International formatting should be handled by the application.

The interface should not assume:

```text
+49
```

for every branch.

---

# 31. SEO Localization

Each public page should have localized SEO fields.

Example:

```text
German:
meta_title
meta_description

English:
meta_title
meta_description
```

The CMS should allow administrators to edit these independently.

---

# 32. SEO Fallback

If a localized SEO value is missing:

```text
Requested locale
 ↓
Branch default locale
 ↓
Organization fallback
```

The exact fallback chain should be deterministic.

---

# 33. Browser Language

The website may detect the browser's preferred language.

However:

> Browser language must not override explicit user selection.

If a visitor explicitly selects French, the website should continue using French appropriately.

---

# 34. Language Persistence

The selected language may be persisted through:

* URL
* cookie
* session
* local preference

The final implementation should prioritize predictable behavior and SEO.

The system must avoid language switching unexpectedly between visits.

---

# 35. Translation Fallback

The fallback hierarchy should be simple.

Recommended:

```text
Requested locale
      ↓
Branch default locale
      ↓
Organization default locale
      ↓
Platform fallback
```

The system should not mix multiple fallback languages within one component unnecessarily.

---

# 36. Missing Translation Behavior

If a translation is missing:

For public content:

```text
use deterministic fallback
```

For required CMS fields:

```text
warn administrator
```

For critical published content:

```text
prevent publication
```

where appropriate.

---

# 37. Translation Completeness

The CMS should show translation completeness.

Example:

```text
Home
German       100%
English      100%
French        72%
Spanish       45%
```

This helps administrators identify incomplete localized websites.

---

# 38. Publishing Per Language

Each locale may have its own publication state.

Example:

```text
German:
Published

English:
Published

French:
Draft

Spanish:
Not published
```

Publishing German must not automatically publish French.

---

# 39. Translation Versioning

When source content changes, translations may become outdated.

Example:

```text
English:
Published

German:
Outdated
```

The CMS should be capable of indicating that the translation no longer reflects the latest source content.

Advanced translation versioning can be introduced later.

---

# 40. Translation Editing

The CMS editor should make language context obvious.

Example:

```text
HOME / HERO

Language:
🇩🇪 Deutsch

Headline:
[ Professionelle Reinigung in Berlin ]

Description:
[ ... ]
```

Switching to:

```text
🇬🇧 English
```

loads the English translation.

---

# 41. Side-by-Side Translation

A future CMS enhancement may support:

```text
German                    English

Headline                  Headline
[... ]                     [...]

Description               Description
[... ]                     [...]
```

This is useful for professional translation workflows but is not required for the initial MVP.

---

# 42. Translation Metadata

Where useful, translation records may track:

```text
translated_at
translated_by
reviewed_at
reviewed_by
source_version
```

This supports future translation workflows.

---

# 43. Machine Translation

AI-assisted translation may be introduced later.

If implemented:

```text
Source content
 ↓
AI translation suggestion
 ↓
Human review
 ↓
CMS draft
 ↓
Publish
```

AI output must not automatically become public content without appropriate controls.

---

# 44. Language-Specific Media

Some media may require localized versions.

For example:

```text
German promotional image
English promotional image
```

The media model should support locale metadata where needed.

Most media should remain language-neutral.

---

# 45. Text Expansion

The UI must accommodate different text lengths.

For example, a button that fits:

```text
Book Now
```

may need more space for:

```text
Jetzt Reinigung buchen
```

Components must not depend on fixed text widths.

---

# 46. Typography and Localization

The CLENQO typography system remains:

```text
Headings:
Sora

Body/UI:
Plus Jakarta Sans
```

The implementation must verify that the selected fonts properly support all launch languages.

If a future language requires additional glyph coverage, appropriate fallback fonts may be added without changing the visual hierarchy.

---

# 47. RTL Readiness

Initial languages are LTR.

The application should nevertheless avoid architectural decisions that make RTL support impossible later.

Prefer logical CSS properties where appropriate:

```text
margin-inline
padding-inline
inset-inline
text-align: start
```

instead of excessive left/right-specific assumptions.

RTL support is not an MVP requirement.

---

# 48. CMS Localization Permissions

Localization permissions follow CMS permissions.

For example:

```text
website.edit
website.publish
```

may be combined with language/branch scope.

A future permissions model may support:

```text
German editor
French translator
English reviewer
```

but this is not required initially.

---

# 49. Notification Localization

Notification templates should support locale.

Example:

```text
notification_templates

event:
booking_confirmed

locale:
de

channel:
email
```

and:

```text
locale:
en
```

The notification engine selects the appropriate template based on the recipient's locale.

---

# 50. Customer Locale

Customers may have a preferred locale.

Possible field:

```text
customers.locale
```

This should be used for:

* confirmation emails
* booking reminders
* invoices where applicable
* customer portal
* future WhatsApp messages

If no customer locale exists, use a deterministic branch/default fallback.

---

# 51. Employee Locale

Employees may also have a preferred locale.

This can be used for:

* cleaner PWA
* job notifications
* schedule notifications
* internal messages

---

# 52. Dashboard Locale

The dashboard should support the initial languages where required.

The dashboard language should be independent of the branch website language.

For example:

```text
Admin UI:
English

Managed branch website:
German
```

This is a valid configuration.

---

# 53. Content Language vs Dashboard Language

These must never be assumed to be identical.

An English-speaking HQ administrator may manage a German branch website.

Therefore:

```text
User interface locale
≠
Website content locale
```

unless the user chooses otherwise.

---

# 54. Localization in Booking

The booking system should localize:

* service labels
* form labels
* validation errors
* date/time presentation
* pricing presentation
* confirmation
* cancellation policy
* payment instructions

The underlying booking state and financial values remain language-independent.

---

# 55. Localization in Cleaner PWA

The cleaner PWA should localize:

* job statuses
* checklists
* navigation
* notifications
* schedule
* instructions

Operational data should remain structured.

> **Resolved (BD-C1/C6 context — Change 7 decision record):** the cleaner PWA uses the existing
> localization architecture; the employee's `preferred_language` is the
> default cleaner UI language with the standard fallback rules, and dates and
> times render in the branch-local timezone. Launch locales remain
> de/en/fr/es.

---

# 56. Localization in Emails

Transactional emails should be generated using:

```text
event
+
recipient locale
+
template
+
data
```

Example:

```text
booking_confirmed
+
de
+
email template
+
booking data
```

---

# 57. Localization and Legal Content

Legal content requires special care.

Different countries may require different legal documents.

The architecture should therefore support:

```text
country
+
organization
+
branch
+
locale
```

as appropriate.

Do not assume that translating one legal document automatically satisfies another country's requirements.

---

# 58. Localization and Branch Expansion

When a new branch is created:

```text
Create Branch
 ↓
Select default locale
 ↓
Select enabled locales
 ↓
Provision website
 ↓
Provision localized content
```

The branch should be ready for CMS translation immediately.

---

# 59. New Branch Example

A new branch could be configured as:

```text
Branch:
Munich

Default:
de

Enabled:
de
en
```

The CMS creates:

```text
Home / Deutsch
Home / English

Services / Deutsch
Services / English

About / Deutsch
About / English
```

The same frontend application renders both.

---

# 60. Translation Data Model

The database should generally follow:

```text
Entity
   │
   ├── Translation: de
   ├── Translation: en
   ├── Translation: fr
   └── Translation: es
```

Example:

```text
service
   ↓
service_translations
```

and:

```text
website_page
   ↓
website_page_translations
```

This keeps translatable fields separate from structural fields.

---

# 61. What Should Not Be Translated in Database

Certain values are language-independent.

Examples:

```text
UUID
booking ID
employee ID
currency code
country code
database status code
service internal key
```

Do not create translations for technical identifiers.

---

# 62. Internal Keys vs Display Labels

Use stable internal keys:

```text
home_cleaning
deep_cleaning
move_out
```

and localized display labels:

```text
German:
Grundreinigung

English:
Deep Cleaning

French:
Nettoyage en profondeur

Spanish:
Limpieza profunda
```

The internal key remains unchanged.

---

# 63. Content Validation by Locale

A section should be validated independently for each locale where required.

Example:

```text
Hero / German
✓ valid

Hero / English
✓ valid

Hero / French
✗ missing headline
```

The CMS should show the administrator exactly what is missing.

---

# 64. Localization and Accessibility

Accessible content must remain accessible in every language.

This includes:

* image alt text
* button labels
* form labels
* error messages
* headings
* navigation
* ARIA labels where needed

A translated interface must not lose accessibility metadata.

---

# 65. Localization Testing

Every major feature should be tested in:

```text
de
en
fr
es
```

Testing should include:

* layout
* text wrapping
* buttons
* forms
* errors
* dates
* numbers
* currency
* navigation
* SEO
* emails where applicable

---

# 66. Localization Quality

Machine-generated or manually entered translations must be reviewed for:

* correctness
* grammar
* terminology
* brand voice
* local appropriateness

Technical correctness alone is not sufficient.

---

# 67. Performance

Localization must not require loading every language's content for every page.

Prefer:

```text
requested locale
+
required fallback
```

rather than loading all translations unnecessarily.

---

# 68. Caching

Published localized content should be cached independently where practical.

For example:

```text
Berlin + de + Home
Berlin + en + Home
Berlin + fr + Home
```

Publishing German should not require invalidating unrelated languages.

---

# 69. Localization and SEO URLs

If localized URLs are introduced later, the system must support appropriate:

* canonical URLs
* alternate language links
* sitemap entries
* metadata
* redirects

The content model should remain independent of the URL strategy.

---

# 70. Content Editor Rule

The CMS must make the distinction between:

```text
content exists
translation exists
translation is published
```

clear.

A language should never appear publicly simply because a translation record exists.

---

# 71. Initial Localization MVP

The first implementation should support:

```text
de
en
fr
es
```

for:

### Public website

* page content
* sections
* services
* FAQs
* navigation
* SEO

### Dashboard

* core UI
* language selector

### Booking

* UI
* service labels
* validation
* confirmation

### Notifications

* email templates

---

# 72. Future Localization Features

Possible future additions:

* translation workflow
* translation memory
* AI translation
* human review
* language-specific media
* regional locales
* RTL languages
* localized domains
* localized URLs
* country-specific legal content

These should be introduced only when business requirements justify them.

---

# 73. Localization Source of Truth

For public branch content:

```text
Supabase/PostgreSQL
```

is the source of truth.

For application UI translations:

```text
version-controlled translation resources
```

are the source of truth.

Neither system should be duplicated unnecessarily.

---

# 74. Golden Localization Rule

> **CLENQO must allow each branch to serve the right content in the right language while keeping business data, interface translations, CMS content, formatting, and branch configuration clearly separated and consistently connected.**
