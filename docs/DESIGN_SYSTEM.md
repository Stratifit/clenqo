# CLENQO Design System

## 1. Purpose

This document defines the visual and interaction system for CLENQO.

The design system exists to ensure that every CLENQO experience feels like the same product, regardless of:

* branch
* page
* device
* language
* user role
* feature
* future country

The system applies to:

* public branch websites
* booking experience
* customer booking management
* cleaner PWA
* branch dashboard
* HQ administration
* emails and transactional interfaces
* future CLENQO applications

The design system must be implemented as reusable tokens and components rather than isolated page-specific styling.

---

# 2. Design Philosophy

CLENQO should communicate:

* cleanliness
* trust
* freshness
* professionalism
* simplicity
* reliability
* modern technology
* human service

The visual identity should feel:

> **Clean, fresh, confident, modern, and approachable.**

CLENQO should not look like:

* a generic SaaS dashboard
* a luxury hotel brand
* a cheap cleaning marketplace
* an overly playful startup
* a medical product
* a template website

---

# 3. Brand Foundation

## 3.1 Brand Name

**CLENQO**

The name should always be presented consistently across the product.

---

## 3.2 Brand Slogan

**Clean Spaces. Better Living.**

The slogan may be used in:

* homepage hero sections
* brand presentations
* marketing materials
* selected campaigns

It should not be forced into every interface.

---

# 4. Typography

CLENQO uses two primary typefaces.

## 4.1 Display / Heading Font

**Sora**

Sora is used for:

* page headings
* section headings
* hero headlines
* major numbers
* important promotional statements
* high-level dashboard headings where appropriate

Recommended weights:

```text
500 Medium
600 SemiBold
700 Bold
```

Avoid excessive use of 700 weight.

---

## 4.2 Body / UI Font

**Plus Jakarta Sans**

Plus Jakarta Sans is used for:

* body text
* navigation
* buttons
* forms
* labels
* tables
* dashboard interfaces
* metadata
* notifications
* supporting text

Recommended weights:

```text
400 Regular
500 Medium
600 SemiBold
700 Bold
```

---

# 5. Typography Hierarchy

The exact sizes may be adjusted responsively, but the hierarchy should remain consistent.

## Display

Used primarily for major marketing headlines.

```text
Desktop:
56–72px

Mobile:
40–48px
```

Weight:

```text
600–700
```

Line height:

```text
0.95–1.10
```

---

## H1

```text
Desktop:
48–56px

Mobile:
36–42px
```

Weight:

```text
600–700
```

---

## H2

```text
Desktop:
36–44px

Mobile:
30–36px
```

Weight:

```text
600
```

---

## H3

```text
Desktop:
26–32px

Mobile:
24–28px
```

Weight:

```text
600
```

---

## H4

```text
20–24px
```

Weight:

```text
600
```

---

## Body Large

```text
18–20px
```

Used for:

* hero supporting text
* important introductions
* prominent descriptions

---

## Body

```text
16px
```

Default reading size.

---

## Body Small

```text
14px
```

Used for:

* metadata
* helper text
* secondary information

---

## Caption

```text
12–13px
```

Used sparingly.

---

# 6. Color System

The CLENQO core brand palette is:

| Token      | Value     | Purpose               |
| ---------- | --------- | --------------------- |
| Primary    | `#07742F` | Main brand green      |
| Accent     | `#F2E543` | Fresh Lemon accent    |
| Background | `#F3F8EE` | Clean Mist background |
| Text       | `#18211C` | Primary charcoal      |

These are the foundational brand colors.

---

# 7. Primary Green

```text
CLENQO Green
#07742F
```

Primary uses:

* primary buttons
* active navigation
* important links
* brand elements
* selected states
* confirmations
* key interface actions

Green should communicate:

* trust
* freshness
* action
* reliability

Do not use the primary green for every element on a page.

---

# 8. Fresh Lemon

```text
Fresh Lemon
#F2E543
```

Primary uses:

* accents
* highlights
* promotional elements
* badges
* visual emphasis
* selected marketing graphics
* secondary CTAs where appropriate

Fresh Lemon should remain an accent rather than becoming the dominant interface color.

Avoid placing large amounts of small dark text directly on the lemon background if readability is poor.

---

# 9. Clean Mist

```text
Clean Mist
#F3F8EE
```

Primary uses:

* page backgrounds
* section backgrounds
* cards in selected contexts
* subtle visual separation

Clean Mist should provide a softer alternative to pure white.

White remains available for surfaces where stronger contrast is required.

---

# 10. Charcoal

```text
Charcoal
#18211C
```

Primary uses:

* headings
* body text
* navigation
* labels
* important interface content

Avoid pure black unless there is a specific accessibility or technical reason.

---

# 11. Supporting Color Tokens

The four core colors should be extended into semantic tokens.

The exact final values can be tuned during implementation, but the semantic system must include:

```text
background
background-muted
surface
surface-elevated

text-primary
text-secondary
text-muted
text-inverse

border
border-subtle

primary
primary-hover
primary-active
primary-soft

accent
accent-soft

success
success-soft

warning
warning-soft

error
error-soft

info
info-soft
```

Semantic colors must be used instead of hardcoded colors throughout components.

---

# 12. Color Accessibility

All text and interactive states must maintain sufficient contrast.

Do not choose a color merely because it matches the brand.

Accessibility takes priority over visual decoration.

The design must support:

* readable body text
* visible focus states
* distinguishable form errors
* distinguishable disabled states
* non-color-only status indicators

---

# 13. Color Usage Ratio

A practical visual balance is:

```text
Clean Mist / White
≈ dominant background

Charcoal
≈ primary text

CLENQO Green
≈ primary action and brand emphasis

Fresh Lemon
≈ accent
```

The interface should feel clean rather than saturated.

---

# 14. Layout Philosophy

CLENQO layouts should prioritize:

* generous whitespace
* clear hierarchy
* predictable alignment
* strong grouping
* easy scanning
* responsive behavior

Avoid:

* excessive cards
* unnecessary borders
* dense layouts
* decorative UI that competes with the booking CTA
* inconsistent spacing

---

# 15. Container System

The public website should use a centered responsive container.

Recommended maximum width:

```text
1200–1280px
```

Wider layouts may be used for:

* dashboards
* data tables
* operational screens

but content should remain readable.

Typical horizontal padding:

```text
Mobile:
16–20px

Tablet:
24–32px

Desktop:
32–48px
```

---

# 16. Spacing System

Use a consistent spacing scale.

Base unit:

```text
4px
```

Recommended values:

```text
4
8
12
16
20
24
32
40
48
64
80
96
120
```

Avoid arbitrary spacing such as:

```text
17px
23px
37px
```

unless there is a documented reason.

---

# 17. Border Radius

CLENQO should use modern but restrained rounding.

Suggested system:

```text
sm:
6px

md:
10px

lg:
14px

xl:
20px

2xl:
28px

pill:
9999px
```

Primary cards should generally use:

```text
14–20px
```

Buttons may use:

```text
10–14px
```

Pills and tags may use full rounding.

---

# 18. Borders

Borders should be subtle.

Use borders primarily for:

* input fields
* tables
* cards requiring separation
* navigation boundaries
* form grouping

Avoid heavy borders around every component.

---

# 19. Shadows

Shadows should communicate elevation rather than decoration.

Use a small number of elevation levels:

```text
none
sm
md
lg
```

Avoid excessive shadows.

Public marketing pages should generally use softer shadows.

Operational dashboards may use slightly stronger elevation where hierarchy benefits from it.

---

# 20. Buttons

Buttons must have a clear hierarchy.

## Primary Button

Use for the most important action.

Examples:

```text
Book a Cleaning
Get a Quote
Create Branch
Confirm Booking
```

Primary appearance:

```text
CLENQO Green background
Light/white text
```

---

## Secondary Button

Used for supporting actions.

Examples:

```text
Learn More
View Services
Manage Booking
```

May use:

* outlined style
* neutral surface
* subtle green styling

---

## Accent Button

Fresh Lemon may be used selectively for marketing-focused actions.

It must not compete with the primary green action.

---

## Destructive Button

Used for actions such as:

```text
Cancel Booking
Delete
Deactivate
```

Use semantic error styling.

Destructive actions should never rely on color alone.

---

# 21. Button Behavior

Buttons must have visible states:

```text
default
hover
active
focus
disabled
loading
```

Loading states must prevent accidental duplicate submissions.

Button labels should describe the action.

Prefer:

```text
Confirm Booking
```

over:

```text
Submit
```

---

# 22. Forms

Forms are critical to CLENQO because booking and operational workflows are form-heavy.

Forms must prioritize:

* clear labels
* large touch targets
* predictable validation
* helpful errors
* minimal cognitive load

Every field should have a visible label.

Placeholder text must not replace labels.

---

# 23. Form Validation

Validation should happen at:

```text
client
+
server
```

Client validation improves UX.

Server validation protects business integrity.

Zod should provide shared validation schemas where practical.

Errors should explain:

* what is wrong
* how to correct it

Avoid:

```text
Invalid input
```

Prefer:

```text
Please enter a valid phone number.
```

---

# 24. Cards

Cards should group related information.

Good uses:

* service selection
* booking summary
* dashboard metrics
* job information
* branch configuration

Cards should not be used simply because a design system contains cards.

Prefer flat layouts when cards add no meaningful hierarchy.

---

# 25. Navigation

## Public Website

Desktop navigation should provide:

* CLENQO logo
* primary navigation
* language selector
* booking CTA

Mobile navigation should remain simple.

---

## Dashboard

Dashboard navigation should prioritize:

* overview
* bookings
* jobs
* customers
* services
* employees
* payments
* reports
* settings

Actual navigation depends on user permissions.

Users must only see navigation relevant to their access.

---

# 26. Mobile Navigation

Mobile operational experiences should prioritize thumb-friendly interaction.

Cleaner PWA navigation should favor a bottom navigation or similarly accessible structure.

Primary actions should be easy to reach.

Do not simply shrink the desktop dashboard onto a phone.

The cleaner experience should be designed mobile-first.

---

# 27. Responsive Breakpoints

Use Tailwind's responsive system.

The design should conceptually support:

```text
mobile
tablet
desktop
large desktop
```

Exact breakpoint behavior should be determined by layout needs rather than device-name assumptions.

---

# 28. Public Website Visual Language

The public website should feel:

* spacious
* premium but approachable
* fresh
* trustworthy
* conversion-focused

Primary visual priorities:

```text
1. Clear value proposition
2. Trust
3. Services
4. Pricing/quote clarity
5. Booking CTA
6. Social proof
```

The booking action should always remain easy to find.

---

# 29. Booking Experience

Booking is a core product interaction.

The interface should minimize unnecessary steps.

Preferred flow:

```text
Service
 ↓
Details
 ↓
Date & Time
 ↓
Price
 ↓
Customer Information
 ↓
Confirmation
```

Where appropriate, steps may be combined.

The customer should always understand:

* what they selected
* what it costs
* when it will happen
* what happens next

---

# 30. Booking Price Presentation

Price should be visually prominent.

Example hierarchy:

```text
Estimated total
€129
```

Then:

```text
Base service
Add-ons
Surcharges
Discount
Tax
```

The customer should not be forced to interpret a complex pricing formula.

The interface should communicate the result clearly while allowing transparency where useful.

---

# 31. Status System

Operational states should use semantic status indicators.

Examples:

```text
Confirmed
Assigned
In Progress
Completed
Cancelled
```

Each status should have:

* label
* visual indicator
* accessible text

Do not communicate status through color alone.

---

# 32. Tables

Tables are primarily for operational/admin interfaces.

Use tables for:

* bookings
* employees
* customers
* invoices
* payments
* branches

Tables should provide:

* clear column hierarchy
* sorting where useful
* filtering where useful
* pagination where necessary
* responsive behavior

On mobile, dense tables should transform into cards or horizontally scroll only when appropriate.

---

# 33. Dashboard Metrics

Dashboard metrics should answer operational questions quickly.

Examples:

```text
Today's bookings
Upcoming jobs
Revenue
Completion rate
Customer rating
Open issues
```

Metrics should include context.

Avoid displaying a large number without explaining what it represents.

---

# 34. Icons

Icons should be:

* simple
* consistent
* recognizable
* functional

Icons should support labels rather than replacing labels where ambiguity exists.

Do not mix unrelated icon styles.

The project should standardize on one primary icon library.

---

# 35. Imagery

Photography should communicate real-world cleanliness and trust.

Preferred imagery:

* clean homes
* professional cleaners
* modern offices
* real service environments
* bright, natural spaces
* authentic human interaction

Avoid overly generic stock imagery whenever possible.

Images should support the story rather than simply fill empty space.

---

# 36. Illustration

Illustration may be used for:

* empty states
* onboarding
* educational content
* lightweight marketing sections

Illustrations should remain consistent with the CLENQO identity.

---

# 37. Animation

Animation should communicate:

* hierarchy
* state changes
* progress
* interaction
* continuity

It should not exist purely for visual novelty.

---

# 38. GSAP Usage

GSAP may be used for selected high-value marketing animations.

Good examples:

* hero entrance
* section reveal
* large visual transitions
* scroll-driven storytelling
* brand moments

Avoid using GSAP for ordinary form interactions when CSS transitions or lightweight React animation are sufficient.

---

# 39. Motion Principles

Animations should be:

* purposeful
* smooth
* restrained
* interruptible
* responsive

Avoid:

* excessive parallax
* long loading animations
* distracting infinite motion
* animation that blocks interaction

---

# 40. Reduced Motion

The application must respect:

```text
prefers-reduced-motion
```

Users who request reduced motion should receive minimal or no nonessential animation.

---

# 41. Loading States

Every asynchronous interface must have a clear loading state.

Examples:

```text
button spinner
skeleton
progress indicator
inline loading message
```

Avoid blank screens during data loading.

---

# 42. Empty States

Empty states should explain:

1. what is empty
2. why it may be empty
3. what the user can do next

Example:

```text
No upcoming bookings

Your next confirmed cleaning will appear here.

[Create Booking]
```

---

# 43. Error States

Errors should be:

* understandable
* actionable
* non-technical for customers

Internal admin errors may provide more technical detail where appropriate.

Never expose:

* database errors
* stack traces
* secrets
* internal provider credentials
* sensitive identifiers

to customers.

---

# 44. Toasts and Notifications

Use transient notifications for:

* successful updates
* minor confirmations
* non-blocking errors

Do not use toasts for critical information that users may miss.

Critical actions should provide persistent feedback.

---

# 45. Accessibility

CLENQO must target strong accessibility from the beginning.

Requirements include:

* keyboard navigation
* visible focus states
* semantic HTML
* accessible forms
* screen-reader-friendly labels
* sufficient contrast
* logical heading hierarchy
* touch-friendly controls
* reduced-motion support

Accessibility is a product requirement, not a final polishing phase.

---

# 46. Touch Targets

Interactive controls should be comfortable on mobile.

Target approximately:

```text
44px+
```

for touch-friendly controls where practical.

Avoid tiny icon-only buttons for important actions.

---

# 47. Localization Design

The UI must accommodate different text lengths.

German may require more horizontal space than English.

French and Spanish may produce different button and navigation lengths.

Therefore:

* avoid fixed-width text containers where unnecessary
* allow labels to wrap where appropriate
* avoid hardcoded positioning based on English text
* test all supported locales

---

# 48. RTL Future Readiness

Initial languages are left-to-right.

The component architecture should avoid assumptions that make future right-to-left languages difficult to introduce.

Prefer logical CSS properties where appropriate.

---

# 49. Website Branch Customization

Branches may customize approved content without breaking the CLENQO design system.

Allowed examples:

* branch name
* contact information
* service area
* opening hours
* approved imagery
* local service availability
* local promotions
* approved local content

Branches must not arbitrarily redefine:

* core brand colors
* primary typography
* global spacing
* component behavior
* accessibility standards
* core interaction patterns

HQ owns the master design system.

---

# 50. Design Tokens in Code

Design tokens should be centralized.

Avoid:

```tsx
className="bg-[#07742F]"
```

throughout the application.

Prefer semantic tokens such as:

```tsx
className="bg-primary"
```

or equivalent project token conventions.

The exact implementation may use:

* Tailwind theme variables
* CSS custom properties
* shadcn/ui conventions

but the result must be centralized and maintainable.

---

# 51. Component Architecture

The UI should be built from reusable components.

Conceptual structure:

```text
components/
    ui/
    layout/
    navigation/
    forms/
    booking/
    services/
    dashboard/
    jobs/
    customers/
    branches/
```

Shared primitives should remain reusable.

Domain components should contain domain-specific presentation.

---

# 52. shadcn/ui

shadcn/ui should provide foundational interface primitives where appropriate.

Examples:

* Button
* Input
* Select
* Dialog
* Sheet
* Dropdown
* Tabs
* Table
* Badge
* Tooltip
* Form

Components should be adapted to CLENQO rather than using default styling unchanged.

---

# 53. Component States

Reusable components must define their important states.

Example button:

```text
default
hover
active
focus
disabled
loading
```

Example input:

```text
default
focus
filled
error
disabled
readonly
```

Example booking:

```text
available
selected
unavailable
loading
error
confirmed
```

---

# 54. Design Consistency

A component should not be redesigned independently on every page.

If a booking button exists on:

* homepage
* service page
* header
* pricing section

it should still belong to the same button system.

Consistency is more important than page-specific decoration.

---

# 55. Brand Photography and Media Rules

Images should have:

* meaningful filenames
* alt text
* correct aspect ratios
* optimized formats
* appropriate loading strategy

Decorative images should use empty alt text where appropriate.

Important content images must have meaningful descriptions.

---

# 56. Performance

Visual quality must not come at the cost of performance.

Priorities include:

* optimized images
* responsive image sizes
* lazy loading where appropriate
* minimal client-side JavaScript
* controlled animation
* font optimization
* appropriate caching

The public website should remain fast on mobile networks.

---

# 57. Design System Governance

The design system is centrally governed.

Changes should be documented when they affect:

* typography
* brand colors
* spacing
* component behavior
* accessibility
* navigation
* major interaction patterns

Significant design changes should go through the project's OpenSpec workflow.

---

# 58. Design QA

Before a feature is considered complete, verify:

### Visual

* correct typography
* correct colors
* correct spacing
* correct responsive layout
* correct component states

### Functional

* interactions work
* forms validate
* loading states work
* errors work
* navigation works

### Accessibility

* keyboard navigation
* focus states
* semantic structure
* contrast
* labels
* reduced motion

### Localization

* all supported languages render correctly
* no text overflow
* no broken layouts

---

# 59. Official Core Tokens

The initial CLENQO identity is therefore:

```text
Display Font:
Sora

Body/UI Font:
Plus Jakarta Sans

Primary:
#07742F

Accent:
#F2E543

Background:
#F3F8EE

Text:
#18211C

Slogan:
Clean Spaces. Better Living.
```

These values form the baseline identity for the platform.

---

# 60. Golden Design Rule

> **CLENQO should always look clean, trustworthy, modern, and easy to use—while the brand remains recognizable across every branch and every product surface.**
