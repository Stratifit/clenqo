# CLENQO — Product Roadmap

**Status:** Source of Truth
**Scope:** Product phases, milestones, priorities, dependencies, release strategy, scaling path, and future capabilities
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL + Vercel
**Primary Principle:** Build the smallest complete foundation that can support a serious multi-branch cleaning business, then expand capability without destabilizing the core.

---

# 1. Purpose

This document defines the strategic product roadmap for CLENQO.

CLENQO is both:

1. a professional cleaning company; and
2. a centralized technology platform for operating multiple cleaning branches.

The roadmap therefore balances:

* customer acquisition;
* operational reliability;
* branch scalability;
* automation;
* financial correctness;
* workforce management;
* platform quality;
* future international expansion.

The roadmap is intentionally phased.

CLENQO should not attempt to build every future capability before the core business engine is reliable.

---

# 2. Product Vision

CLENQO should evolve from:

```text
Cleaning Business
```

into:

```text
Technology-Powered Cleaning Network
```

with:

```text
Customer Experience
        +
Cleaning Operations
        +
Workforce Platform
        +
Branch Management
        +
Financial Operations
        +
Automation
        +
Data & Intelligence
```

all operating from one centralized platform.

---

# 3. Strategic Product Principles

The roadmap follows these principles:

1. Multi-branch from day one.
2. One centralized platform.
3. One codebase.
4. One authoritative database.
5. Branches are data/configuration, not source-code copies.
6. Business correctness before feature volume.
7. Customer experience before unnecessary complexity.
8. Manual operational fallback before premature automation.
9. Deterministic pricing.
10. Server-authoritative booking.
11. Strong authorization and branch isolation.
12. Audit important actions.
13. Build for Germany initially without hardcoding Germany.
14. Design for international expansion.
15. Add complexity only when real demand requires it.

---

# 4. Roadmap Structure

The roadmap is divided into phases:

```text
Phase 0 — Foundation
Phase 1 — Core Booking Platform
Phase 2 — Operational Platform
Phase 3 — Financial & Customer Platform
Phase 4 — Multi-Branch Scale
Phase 5 — Automation & Intelligence
Phase 6 — International Platform
Phase 7 — CLENQO Network
```

Phases may overlap where dependencies allow.

A phase is not complete merely because its code exists.

It must meet its defined operational acceptance criteria.

---

# 5. Phase 0 — Foundation

## Objective

Establish the technical and architectural foundation.

### Core

* Next.js application;
* TypeScript;
* React;
* Tailwind CSS;
* shadcn/ui;
* Supabase;
* PostgreSQL;
* Supabase Auth;
* Supabase Storage;
* RLS;
* Vercel deployment;
* GitHub;
* Amazon SES foundation.

### Architecture

* modular monolith;
* App Router;
* feature-oriented structure;
* server/client boundaries;
* domain services;
* API/server contracts;
* authorization;
* validation.

### Documentation

Complete and maintain:

```text
README
PROJECT_RULES
VISION
REQUIREMENTS
ARCHITECTURE
DATABASE
DESIGN_SYSTEM
CONTENT_SYSTEM
ADMIN_SYSTEM
LOCALIZATION
SECURITY
BOOKING_SYSTEM
PRICING_ENGINE
SCHEDULING_SYSTEM
WORKER_SYSTEM
PAYMENT_SYSTEM
NOTIFICATION_SYSTEM
QUALITY_SYSTEM
BRANCH_SYSTEM
REPORTING_SYSTEM
AUDIT_SYSTEM
SECURITY_PRIVACY
TESTING_STRATEGY
DEPLOYMENT
PROJECT_STRUCTURE
API_STANDARDS
OBSERVABILITY
BACKGROUND_JOBS
SEARCH_DISCOVERY
MEDIA_STORAGE
LEGAL_COMPLIANCE
ROADMAP
```

### Exit Criteria

* architecture validated;
* database foundation working;
* authentication working;
* RLS verified;
* migrations reproducible;
* CI/deployment working;
* documentation consistent;
* OpenSpec workflow established.

---

# 6. Phase 1 — Core Booking Platform

## Objective

Allow a real customer to discover a branch, select a service, receive a deterministic price, choose an available time, and book without creating an account.

---

## 6.1 Branch Foundation

Implement:

* organization;
* branch;
* branch status;
* branch slug;
* branch settings;
* branch locale configuration;
* branch timezone;
* branch currency;
* service area;
* operating hours.

---

## 6.2 Automatic Branch Provisioning

HQ creates:

```text
Branch
```

and the platform automatically provisions:

```text
Website
Locales
Pages
Sections
Navigation
SEO defaults
Dashboard context
```

Provisioning must be:

* idempotent;
* auditable;
* retryable;
* observable.

---

# 7. Phase 1 — Public Website

Every branch should receive a website from the centralized template system.

Required capabilities:

* responsive layout;
* localized content;
* branch information;
* services;
* service areas;
* contact;
* operating hours;
* FAQ;
* CTA;
* SEO;
* booking entry points.

Branches must not require separate frontend deployments.

---

# 8. Phase 1 — CMS

HQ/authorized branch users should be able to edit approved content.

Required:

* pages;
* sections;
* headings;
* text;
* buttons;
* images;
* services presentation;
* FAQs;
* testimonials;
* CTA;
* navigation;
* footer;
* SEO.

The section registry remains the presentation contract.

---

# 9. Phase 1 — Services

Implement:

* service catalog;
* service variants;
* add-ons;
* translations;
* branch availability;
* public descriptions;
* included/excluded tasks.

Initial services:

```text
Home Cleaning
Business/Commercial Cleaning
Deep Cleaning
Move-In/Move-Out
```

---

# 10. Phase 1 — Pricing Engine

Implement deterministic server-side pricing.

Inputs may include:

* service;
* variant;
* property factors;
* duration;
* difficulty;
* add-ons;
* surcharges;
* discounts;
* tax;
* currency.

Conceptual:

```text
Duration
×
Rate
×
Difficulty
+
Add-ons
+
Surcharges
−
Discounts
+
Tax
=
Total
```

Every confirmed booking stores the relevant pricing snapshot.

---

# 11. Phase 1 — Availability

Implement:

* branch hours;
* service hours;
* employee availability;
* exceptions;
* existing jobs;
* duration;
* buffers;
* lead time;
* advance booking;
* blackout periods;
* timezone/DST handling.

Availability must be calculated server-side.

---

# 12. Phase 1 — Customer Booking

Customer flow:

```text
Choose branch
 ↓
Choose service
 ↓
Enter property/service details
 ↓
Choose date/time
 ↓
Calculate price
 ↓
Enter name/email/phone
 ↓
Review
 ↓
Confirm booking
 ↓
Confirmation
```

No mandatory customer account.

---

# 13. Phase 1 — Magic Link

After booking, customers can manage bookings through secure magic links.

Capabilities:

* view booking;
* reschedule (manual customer rescheduling is a Phase 1 capability per
  decision BD-3 — subject to the rules in `BOOKING_SYSTEM.md` §47–48;
  only rescheduling *automation* is a future capability);
* cancel;
* access permitted information;
* view relevant payment/invoice information.

No password required for the core customer experience.

---

# 14. Phase 1 — Booking Operations

Implement:

* booking numbers;
* booking status;
* booking events;
* booking source;
* customer relationship;
* address;
* booking items;
* cancellation;
* rescheduling;
* job creation.

---

# 15. Phase 1 — Initial Notifications

Implement email first.

Amazon SES should support:

* booking confirmation;
* cancellation;
* rescheduling;
* basic reminder;
* operational notifications.

Email delivery should be asynchronous and retryable.

---

# 16. Phase 1 — Branch Dashboard

Branch Managers should see:

* today's bookings;
* upcoming bookings;
* booking status;
* basic customer details;
* jobs;
* employees;
* schedule;
* operational alerts.

---

# 17. Phase 1 Exit Criteria

A real booking can successfully complete:

```text
Branch discovery
→ website
→ service
→ availability
→ price
→ booking
→ confirmation
→ dashboard
```

without manual database intervention.

---

# 18. Phase 2 — Operational Platform

## Objective

Turn bookings into reliable cleaning operations.

---

# 19. Workforce

Implement:

* employee profiles;
* branch assignments;
* employment types;
* skills;
* availability;
* exceptions;
* status.

Initial employment types:

```text
part_time
minijob
flexible
full_time
```

---

# 20. Job Management

Implement:

* jobs;
* job status;
* assignments;
* assignment history;
* check-in/out;
* job checklist;
* notes;
* evidence photos;
* incidents;
* completion.

---

# 21. Cleaner PWA

Build a mobile-first cleaner interface.

Core screens:

```text
Today
Jobs
Job Detail
Schedule
Notifications
Profile
```

Job detail should provide:

* service;
* time;
* location;
* customer instructions;
* checklist;
* notes;
* check-in/out;
* evidence;
* incident reporting.

> **Resolved (BD-C1…BD-C9 — Change 7 decision record):** the Cleaner PWA scope
> above proceeds with no GPS/location capture, no customer signature, an
> in-app-only notification surface (delivery deferred), a lightweight offline
> action queue, before/after/incident photos only, and completion gates
> (check-in + mandatory checklist + no unresolved high/critical incident with
> audited manager override).
>
> **Implemented (Change 7, create-cleaner-pwa):** the execution surface is
> live at `/cleaner` (Today/Tomorrow/Upcoming/Completed job lists + job
> detail): en_route → check-in → start work → checklist → notes → incident
> reporting → before/after/incident_evidence photos → checkout → completion
> with BD-C9 gates and audited `jobs.manage` manager override. Installable
> PWA (manifest + service worker, app-shell caching only) with a lightweight
> idempotent offline action queue (no offline media). Customer data stays
> minimized to the BD-C1 field set; migration `0013_cleaner_execution.sql`
> carries the checklist/media structures.

---

# 22. Manual Assignment First

The initial system should use manual assignment.

Managers can assign:

```text
Job
→ Cleaner
```

The platform validates:

* branch;
* availability;
* skill;
* schedule conflicts.

Automatic assignment comes later.

---

# 23. Operational Alerts

Implement alerts for:

* unassigned jobs;
* approaching job start;
* late check-in;
* job conflict;
* incomplete job;
* incident;
* customer complaint.

---

# 24. Quality Foundation

Implement:

* customer ratings;
* reviews;
* complaints;
* quality issues;
* rework tracking;
* moderation;
* branch quality metrics.

Customer reviews should become available after completed service.

---

# 25. Phase 2 Exit Criteria

A booking can progress through:

```text
Confirmed
→ Assigned
→ En Route
→ Checked In
→ In Progress
→ Completed
```

with operational history and appropriate notifications.

---

# 26. Phase 3 — Financial & Customer Platform

## Objective

Create reliable financial workflows and deepen the customer relationship.

---

# 27. Payments

Implement provider abstraction and an initial online payment integration.

Support architecture for:

* card;
* PayPal;
* SEPA;
* Apple Pay;
* Google Pay;
* bank transfer;
* cash.

Actual provider availability depends on market and provider capabilities.

---

# 28. Payment Timing

Initial residential default:

```text
Payment after completion
```

Architecture should support:

```text
payment at booking
deposit
invoice
manual payment
```

---

# 29. Invoices

Implement:

* invoice generation;
* invoice numbering;
* line items;
* tax;
* currency;
* payment status;
* invoice delivery;
* refund relationship.

---

# 30. Refunds

Support:

* full refund;
* partial refund;
* cancellation-related fees;
* manual adjustments.

All financial mutations must be audited.

---

# 31. Customer Experience

Expand customer capabilities:

* booking history;
* invoice access;
* payment history;
* reviews;
* recurring services;
* saved service preferences where appropriate.

The no-password experience remains a core design principle unless a future authenticated account becomes genuinely valuable.

---

# 32. Recurring Services

Implement recurring booking plans.

Potential frequencies:

```text
weekly
biweekly
monthly
custom
```

Each occurrence must independently pass availability and pricing rules.

---

# 33. Phase 3 Exit Criteria

CLENQO can operate a complete business transaction:

```text
Customer
→ Booking
→ Cleaning Job
→ Completion
→ Payment
→ Invoice
→ Review
```

with financial and operational records connected.

---

# 34. Phase 4 — Multi-Branch Scale

## Objective

Prove that CLENQO can operate multiple branches from one platform.

---

# 35. HQ Administration

Implement advanced HQ capabilities:

* branch creation;
* branch activation;
* suspension;
* archive;
* branch configuration;
* manager assignment;
* global settings;
* master content;
* master design controls.

---

# 36. Branch Lifecycle

Formalize:

```text
draft
→ provisioning
→ ready
→ active
→ suspended
→ archived
```

Activation should require appropriate readiness checks.

---

# 37. HQ Cross-Branch Reporting

Implement:

* revenue;
* bookings;
* completion;
* cancellation;
* customer growth;
* workforce;
* quality;
* branch performance.

HQ can compare branches without weakening branch isolation.

---

# 38. Branch Customization

Allow approved branch customization:

* local content;
* imagery;
* service presentation;
* service area;
* hours;
* pricing configuration;
* local promotions.

HQ retains control of:

* core design system;
* brand identity;
* approved component system;
* global rules.

---

# 39. Multi-Branch Operations

Test:

```text
1 branch
→ 5 branches
→ 20 branches
```

without architectural changes to the core model.

The same application and database architecture should remain valid.

---

# 40. Phase 4 Exit Criteria

The platform can create and operate multiple active branches without:

* duplicated frontend code;
* duplicated databases;
* cross-branch data leakage;
* manual database provisioning;
* inconsistent branch configuration.

---

# 41. Phase 5 — Automation & Intelligence

## Objective

Reduce operational workload through reliable automation.

---

# 42. Automation Engine

Implement workflows such as:

```text
Booking Created
→ Confirmation

Booking Tomorrow
→ Reminder

Job Unassigned
→ Manager Alert

Payment Failed
→ Retry/Notification

Job Completed
→ Review Request
```

All workflows remain idempotent and observable.

---

# 43. Automated Assignment

After sufficient operational data exists, introduce automatic cleaner assignment.

Candidate factors:

* availability;
* skills;
* branch;
* distance/travel;
* workload;
* schedule;
* employee preferences where appropriate.

Managers must retain override capability.

---

# 44. Scheduling Intelligence

Future scheduling can optimize:

* cleaner utilization;
* travel;
* job coverage;
* overtime;
* customer preferences;
* recurring routes.

AI should assist rather than silently control high-impact decisions.

---

# 45. Operational Intelligence

Introduce dashboards for:

* branch health;
* booking conversion;
* capacity;
* employee utilization;
* quality;
* revenue;
* customer retention.

---

# 46. AI Assistance

Potential AI capabilities:

* customer support;
* content generation;
* translation assistance;
* operational summaries;
* schedule recommendations;
* anomaly detection;
* review summarization;
* marketing assistance.

AI must remain subject to authorization and privacy controls.

---

# 47. Phase 5 Exit Criteria

Automation should measurably reduce manual work without reducing:

* booking reliability;
* pricing correctness;
* employee fairness;
* customer experience;
* auditability.

---

# 48. Phase 6 — International Platform

## Objective

Expand beyond the initial market while preserving one platform architecture.

---

# 49. Internationalization

Support:

* multiple countries;
* multiple currencies;
* multiple timezones;
* multiple tax configurations;
* multiple legal entities;
* multiple locales;
* country-specific business rules.

Initial locales:

```text
de
en
fr
es
```

---

# 50. Country Activation

New countries should follow:

```text
Country Assessment
→ Legal Setup
→ Financial Setup
→ Operational Setup
→ Localization
→ Technical Configuration
→ Testing
→ Activation
```

A country must not be activated merely by adding a flag or locale.

---

# 51. International Payments

Add payment methods appropriate to each market.

Use provider adapters rather than hardcoding one payment provider globally.

---

# 52. International Tax

Country-specific tax rules should be introduced through controlled configuration/modules.

Historical transactions must preserve the applicable tax state.

---

# 53. International Employment

Employment configuration should support jurisdiction-specific:

* employment types;
* working time;
* leave;
* payroll-related data;
* compliance requirements.

---

# 54. Phase 6 Exit Criteria

CLENQO can activate a new country without rewriting core booking, pricing, branch, authorization, or customer architecture.

---

# 55. Phase 7 — CLENQO Network

## Objective

Transform CLENQO into a broader cleaning network and technology platform.

Potential capabilities:

* franchise/partner model;
* partner onboarding;
* partner portals;
* external APIs;
* customer marketplace;
* commercial contracts;
* enterprise accounts;
* advanced workforce marketplace;
* centralized procurement;
* insurance integrations;
* accounting integrations.

---

# 56. Enterprise Cleaning

Expand commercial capabilities:

* multiple locations;
* contracts;
* recurring schedules;
* service-level agreements;
* purchase orders;
* invoicing;
* account contacts;
* enterprise reporting.

---

# 57. Partner/Franchise Architecture

Future branches may be:

```text
company-owned
partner-operated
franchise
```

The core organization/branch architecture should evolve carefully to support these relationships.

---

# 58. Customer Network

Potential future capabilities:

```text
discover CLENQO branches
compare services
book across regions
manage multiple properties
```

The customer experience should remain simple despite increasing platform complexity.

---

# 59. Platform APIs

Eventually expose controlled APIs for:

* enterprise customers;
* partners;
* booking integrations;
* accounting;
* property-management systems;
* calendars;
* future mobile applications.

All external APIs must use the same domain and authorization contracts.

---

# 60. Product Prioritization Framework

New features should be evaluated using:

```text
Customer Value
+
Business Value
+
Operational Value
+
Strategic Value
+
Security
+
Reliability
+
Implementation Cost
+
Maintenance Cost
```

A feature should not be built simply because it is technically interesting.

---

# 61. Priority Levels

### P0 — Critical

Required for business correctness or platform operation.

Examples:

* authentication;
* RLS;
* booking;
* pricing;
* payments;
* critical security.

### P1 — Core

Important for a professional production business.

Examples:

* cleaner PWA;
* scheduling;
* notifications;
* invoices;
* quality;
* branch management.

### P2 — Growth

Improves scale or customer experience.

Examples:

* recurring services;
* advanced reporting;
* automation;
* advanced search.

### P3 — Future

Strategic but not required for current operation.

Examples:

* AI optimization;
* franchise marketplace;
* advanced integrations;
* dedicated search infrastructure.

---

# 62. Feature Gate Principle

Features should be released when their dependencies are ready.

Example:

```text
Automatic Assignment
requires:
workforce data
+
availability
+
job model
+
branch scope
+
observability
```

Do not implement advanced automation before its data foundation exists.

---

# 63. MVP Definition

The CLENQO MVP should provide:

```text
Multi-branch foundation
+
Authentication
+
Authorization
+
HQ branch management
+
Automatic branch provisioning
+
Public branch websites
+
CMS
+
Services
+
Pricing
+
Availability
+
Customer booking
+
Magic-link management
+
Basic notifications
+
Branch dashboard
```

This is the minimum complete platform foundation.

---

# 64. MVP Business Readiness

The MVP is not considered business-ready until a real operational cycle works:

```text
Customer
→ discovers branch
→ books
→ receives confirmation
→ branch sees booking
→ employee/job is prepared
→ service is completed
→ customer can manage/review booking
```

Critical operations must work without direct database manipulation.

---

# 65. Launch Readiness

Before public launch, verify:

### Product

* [ ] Website.
* [ ] Booking.
* [ ] Pricing.
* [ ] Availability.
* [ ] Customer management.
* [ ] Branch operations.

### Security

* [ ] Auth.
* [ ] Authorization.
* [ ] RLS.
* [ ] Magic-link security.
* [ ] Storage security.
* [ ] Rate limiting.

### Operations

* [ ] Employee workflow.
* [ ] Job workflow.
* [ ] Notifications.
* [ ] Error handling.
* [ ] Support process.

### Finance

* [ ] Payment workflow.
* [ ] Invoice workflow.
* [ ] Refund process.

### Compliance

* [ ] Privacy.
* [ ] Terms.
* [ ] Cookie/consent requirements.
* [ ] Tax configuration.
* [ ] Data retention.

### Reliability

* [ ] Backups.
* [ ] Monitoring.
* [ ] Alerts.
* [ ] Smoke tests.
* [ ] Recovery procedure.

---

# 66. Pilot Strategy

The first operational launch should remain intentionally controlled.

Recommended approach:

```text
Single launch market
→ controlled customer acquisition
→ real bookings
→ operational feedback
→ fix reliability issues
→ stabilize
→ add branches
```

The architecture remains multi-branch from the beginning even if only one branch is initially active.

---

# 67. Growth Validation

Before aggressively adding branches, measure:

* booking conversion;
* booking completion;
* customer satisfaction;
* cancellation;
* on-time arrival;
* cleaner utilization;
* payment success;
* notification reliability;
* branch profitability;
* support workload.

Use actual data to determine the next bottleneck.

---

# 68. Current Business Targets

Initial operational targets may include:

```text
Booking conversion      → 12%
Job fulfillment         → 98%
On-time arrival         → 95%
Customer rating         → 4.7★
```

These are business targets, not guaranteed outcomes.

They should be measured consistently before being used for strategic decisions.

---

# 69. Scaling Strategy

Scale in stages:

```text
1 branch
 ↓
5 branches
 ↓
20 branches
 ↓
100+ branches
 ↓
multiple countries
```

At each stage evaluate:

* database performance;
* application performance;
* operational staffing;
* notification volume;
* storage;
* payment volume;
* support;
* reporting;
* compliance;
* infrastructure cost.

---

# 70. Architecture Scaling Rule

Do not scale infrastructure merely because the roadmap says:

```text
100 branches
```

Scale when measured demand requires it.

The architecture should provide a path to scale without forcing premature complexity.

---

# 71. Infrastructure Evolution

Initial:

```text
Next.js
+
Vercel
+
Supabase/PostgreSQL
+
Supabase Storage
+
SES
```

Potential future additions:

```text
Redis
Dedicated workers
Queue infrastructure
Search engine
Data warehouse
Advanced observability
Regional infrastructure
```

Each addition requires a demonstrated need.

---

# 72. Product Data Strategy

Operational systems remain the source of truth.

Reporting aggregates from operational data.

Analytics may later use:

```text
warehouse
data lake
analytics platform
```

but must not replace operational business systems.

---

# 73. AI Roadmap

AI should be introduced in stages.

### Stage 1

AI-assisted development and internal productivity.

### Stage 2

Customer-facing assistance.

### Stage 3

Operational recommendations.

### Stage 4

Advanced optimization.

### Stage 5

Intelligent network-level decision support.

At every stage:

```text
Authorization
+
Privacy
+
Human oversight
+
Auditability
```

remain mandatory.

---

# 74. AI Must Not Become the Source of Truth

AI may recommend:

```text
cleaner assignment
pricing suggestion
content
customer response
operational action
```

but authoritative state remains in CLENQO's domain systems.

---

# 75. Technical Debt Strategy

Technical debt should be managed deliberately.

Do not optimize everything immediately.

Prioritize debt affecting:

1. security;
2. data integrity;
3. reliability;
4. maintainability;
5. scalability;
6. performance.

---

# 76. Documentation Synchronization

Every meaningful architecture/product change should update:

```text
relevant docs
+
OpenSpec
+
implementation
+
tests
```

The roadmap must remain aligned with actual product priorities.

---

# 77. OpenSpec Workflow

Every significant feature follows:

```text
Business Decision
        ↓
Source-of-Truth Documentation
        ↓
OpenSpec Proposal
        ↓
Specification
        ↓
Implementation
        ↓
Tests
        ↓
Verification
        ↓
Commit
        ↓
Archive
```

The coding agent must not skip directly from idea to implementation for significant changes.

---

# 78. Release Strategy

Releases should be small and verifiable.

Preferred:

```text
small change
→ tests
→ verify
→ commit
```

rather than:

```text
large collection of unrelated changes
→ difficult debugging
```

---

# 79. Rollback Strategy

Every production feature should have a recovery strategy.

Possible mechanisms:

* revert deployment;
* disable feature;
* rollback configuration;
* forward-fix migration;
* restore from backup where absolutely necessary.

Database migrations should generally favor safe forward migrations over destructive rollback assumptions.

---

# 80. Roadmap Governance

The roadmap is strategic, not an excuse to build every listed feature immediately.

Priority may change based on:

* customer demand;
* operational pain;
* revenue;
* regulatory changes;
* reliability;
* competitive landscape;
* infrastructure constraints.

Changes to the roadmap should be deliberate and documented.

---

# 81. What Not to Build Too Early

Avoid premature investment in:

* microservices;
* complex event buses;
* dedicated search infrastructure;
* advanced AI agents;
* custom payment infrastructure;
* custom identity systems;
* complex analytics warehouses;
* elaborate workflow builders;
* unnecessary mobile-native applications;
* infrastructure that does not solve a demonstrated problem.

The modular monolith should carry the early product.

---

# 82. Product Quality Gate

Before moving to a more advanced phase, confirm that the previous phase is stable.

Example:

```text
Do not optimize assignment
until:
booking
+
availability
+
employee schedules
+
job data
```

are reliable.

Advanced automation built on unreliable foundations only amplifies errors.

---

# 83. Success Definition

CLENQO succeeds when it can reliably provide:

```text
A great customer booking experience
+
Reliable cleaning operations
+
Happy/efficient cleaners
+
Profitable branches
+
Centralized HQ control
+
Scalable technology
+
Trustworthy financial records
+
Strong customer retention
```

Technology exists to enable this outcome.

---

# 84. Long-Term Vision

The long-term CLENQO platform can become:

```text
CLENQO Network
│
├── Customers
├── Branches
├── Cleaners
├── Managers
├── HQ
├── Enterprise Clients
├── Partners
├── Payments
├── Workforce
├── Scheduling
├── Automation
├── Analytics
└── Intelligence
```

The underlying platform remains unified.

---

# 85. Architecture Rules

The following are mandatory:

1. Build the core before advanced features.
2. Keep multi-branch architecture from day one.
3. Never create branch-specific source-code copies.
4. Keep business domains authoritative.
5. Keep pricing deterministic.
6. Keep booking server-authoritative.
7. Keep authorization and RLS foundational.
8. Keep customer access simple.
9. Prefer manual fallback before automation.
10. Introduce automation only when its dependencies are reliable.
11. Introduce infrastructure based on measured demand.
12. Preserve historical financial/business truth.
13. Treat compliance as part of product readiness.
14. Make important operations observable.
15. Test before scaling.
16. Keep documentation synchronized.
17. Use OpenSpec for significant changes.
18. Do not allow AI to bypass domain, privacy, or authorization rules.
19. Optimize for business outcomes, not feature count.
20. Maintain a clear path from one branch to many countries.

---

# 86. Definition of Done

A roadmap phase is complete when:

* [ ] Its product objective is achieved.
* [ ] Required domains are implemented.
* [ ] Security requirements pass.
* [ ] RLS/authorization is verified.
* [ ] Critical workflows work end-to-end.
* [ ] Observability exists.
* [ ] Relevant business metrics are measurable.
* [ ] Operational fallback exists.
* [ ] Documentation is synchronized.
* [ ] OpenSpec changes are archived.
* [ ] Production verification passes.
* [ ] The system is stable enough for the next phase.

---

# 87. Golden Roadmap Rule

> **Build CLENQO as a reliable cleaning business first, a scalable multi-branch platform second, and an intelligent network third—without sacrificing the architecture, security, simplicity, or trust required at every stage.**

The roadmap exists to control complexity, not accelerate it.
