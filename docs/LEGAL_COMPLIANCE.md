# CLENQO — Legal & Compliance

**Status:** Source of Truth
**Scope:** Privacy, GDPR-oriented architecture, customer terms, booking policies, payments, invoicing, cookies, consent, employee data, records, and multi-country compliance
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL
**Primary Principle:** CLENQO must be designed to support applicable legal and regulatory requirements without embedding jurisdiction-specific assumptions into the core platform.

---

## 1. Purpose

This document defines the legal and compliance architecture for CLENQO.

CLENQO operates as both:

1. a cleaning business; and
2. a technology platform supporting multiple branches.

The platform therefore processes several categories of information, including:

* customer information;
* booking information;
* addresses;
* employee information;
* operational records;
* payment information;
* invoices;
* communications;
* reviews;
* website analytics;
* media;
* audit records.

The architecture must support applicable legal obligations as CLENQO expands across branches, regions, and countries.

This document provides product and engineering requirements. It is **not legal advice**.

---

# 2. Legal Design Principle

CLENQO should follow:

```text
Business Requirement
      ↓
Applicable Jurisdiction
      ↓
Legal/Compliance Review
      ↓
Configurable Platform Rule
      ↓
Implementation
      ↓
Auditability
```

Legal requirements that vary by jurisdiction should be configurable where practical.

Do not hardcode one country's rules into global business logic.

---

# 3. Jurisdiction Awareness

Every branch should have jurisdiction-related configuration.

Potential fields include:

```text
country
region/state
currency
timezone
default_locale
tax_configuration
legal_entity
```

The exact model may evolve.

A branch operating in Germany must not force German assumptions onto a future branch operating in another country.

---

# 4. Legal Entity

The platform should distinguish:

```text
organization
branch
legal entity
```

A branch may operate under a legal entity without itself being a separate legal entity.

This distinction becomes important for:

* invoices;
* tax;
* contracts;
* payment processing;
* employment;
* privacy responsibilities;
* customer-facing legal information.

---

# 5. Legal Configuration

Where rules differ by branch or jurisdiction, configuration may include:

* legal business name;
* registered address;
* tax identifiers;
* invoice information;
* applicable tax rates;
* cancellation policy;
* terms version;
* privacy notice version;
* cookie/consent requirements;
* payment rules;
* supported payment methods.

Legal configuration must be permission-controlled.

---

# 6. GDPR-Oriented Architecture

For European operations, CLENQO should be architected with GDPR principles in mind.

Core principles include:

* lawfulness;
* fairness;
* transparency;
* purpose limitation;
* data minimization;
* accuracy;
* storage limitation;
* integrity;
* confidentiality;
* accountability.

Exact legal interpretation must be reviewed by qualified counsel.

---

# 7. Data Inventory

The platform should maintain an understanding of what categories of personal data it processes.

Examples:

### Customer

* name;
* email;
* phone;
* service address;
* booking history;
* customer instructions.

### Employee

* identity information;
* employment information;
* scheduling;
* job history;
* operational records.

### Cleaner Evidence

* photographs;
* notes;
* incident information.

### Financial

* invoices;
* payment references;
* transaction history.

### Website

* consent records;
* analytics information where applicable.

---

# 8. Data Classification

Information should be classified according to sensitivity.

Conceptual categories:

```text
public
internal
confidential
restricted
```

Examples:

```text
public → published branch information

internal → operational dashboard configuration

confidential → customer booking details

restricted → employee documents / sensitive financial information
```

Access controls must reflect the classification.

---

# 9. Data Minimization

CLENQO should collect only information necessary for the intended purpose.

For example, a booking should not require unnecessary personal information simply because the system could store it.

Every new data field should have a business purpose.

---

# 10. Purpose Limitation

Data collected for one purpose should not automatically be reused for unrelated purposes.

Example:

```text
Booking phone number
```

does not automatically imply:

```text
marketing permission.
```

Transactional communication and marketing communication remain separate.

---

# 11. Legal Basis

Where required, the system should support recording the applicable processing basis.

Possible categories may include:

```text
contract
legal_obligation
consent
legitimate_interest
```

The exact legal basis must be determined by the responsible business/legal team.

The platform should provide configuration and records without pretending to make the legal determination itself.

---

# 12. Consent

Consent should be:

* specific;
* informed;
* distinguishable;
* recorded;
* revocable where applicable.

Consent must not be bundled unnecessarily into mandatory booking acceptance.

---

# 13. Consent Records

Where consent is required, store enough information to demonstrate it.

Conceptual:

```text
consent_id
subject_id
purpose
status
timestamp
policy_version
source
locale
```

Do not store more personal data than required.

---

# 14. Consent vs Terms Acceptance

These are different concepts.

### Terms acceptance

The customer agrees to contractual/service terms.

### Consent

The customer grants permission for a specified processing activity where consent is the applicable legal basis.

Do not treat one as automatically proving the other.

---

# 15. Marketing Consent

Marketing preferences must be separate from transactional communication.

Example:

```text
booking confirmation
```

must not depend on:

```text
marketing = true
```

Marketing opt-in/opt-out should be independently managed.

---

# 16. Transactional Communications

Required operational communications may include:

* booking confirmation;
* cancellation;
* rescheduling;
* payment information;
* invoice;
* job-related communication.

These should remain distinct from marketing subscriptions.

---

# 17. Cookie Architecture

The website should distinguish cookies/technologies by purpose where applicable.

Potential categories:

```text
necessary
preferences
analytics
marketing
```

Only required categories should operate without additional consent where legally permitted.

The exact consent requirements depend on jurisdiction and technology.

---

# 18. Cookie Consent

If consent is required, the system should support:

* accept;
* reject;
* customize;
* withdraw/change preferences.

The consent state must be respected by analytics/marketing technologies.

Do not load non-essential technologies before the required consent decision.

---

# 19. Privacy Notice

Each public website should provide access to the applicable privacy information.

Because branches may differ by:

* legal entity;
* jurisdiction;
* contact information;
* processing activities;

the privacy notice architecture should support branch/legal-entity context.

---

# 20. Terms & Conditions

Customer terms should define applicable business rules such as:

* services;
* booking;
* pricing;
* payment;
* cancellation;
* rescheduling;
* access to property;
* customer responsibilities;
* service limitations;
* complaints;
* liability;
* dispute handling.

The exact legal wording requires professional review.

---

# 21. Terms Versioning

When terms change, the platform should preserve versions.

Conceptually:

```text
terms_version
effective_at
locale
jurisdiction
content/reference
published_at
```

Important customer acceptance records should identify the applicable version.

---

# 22. Privacy Policy Versioning

Privacy information should also be versioned.

The platform should be able to establish which version was presented at a relevant time.

---

# 23. Booking Policy

The booking system must expose the applicable policies before confirmation where required.

Relevant policies include:

* cancellation;
* rescheduling;
* payment timing;
* service limitations;
* additional charges;
* access requirements.

The customer should not discover material contractual conditions only after booking.

---

# 24. Cancellation Policy

The current CLENQO business policy is configurable:

```text
24+ hours      → free
12–24 hours    → 25%
2–12 hours     → 50%
under 2 hours  → 100%
```

These values are business configuration, not universal legal requirements.

Jurisdiction-specific consumer rules may override or constrain the configured policy.

The platform must therefore support policy configuration rather than assuming these percentages are legally valid everywhere.

---

# 25. Surcharges

Potential business surcharges include:

```text
night
Sunday
holiday
emergency
```

The pricing system must present applicable charges transparently.

Surcharges must not be hidden in unexplained totals.

---

# 26. Pricing Transparency

Before final booking confirmation, the customer should understand:

* base service;
* duration or relevant pricing basis;
* add-ons;
* surcharges;
* discounts;
* taxes where applicable;
* final total;
* currency.

The exact presentation depends on applicable consumer requirements.

---

# 27. Price Snapshots

Once a booking is confirmed, the relevant price information should be preserved.

This supports:

* customer transparency;
* invoicing;
* disputes;
* refunds;
* audit;
* historical reproducibility.

Future pricing changes must not silently rewrite historical bookings.

---

# 28. Quotes and On-Site Assessment

If a booking cannot be priced reliably online, CLENQO may use a quote/assessment workflow.

Example:

```text
quote_required
```

The customer should clearly understand that the displayed amount is:

* an estimate;
* a call-out fee;
* or a confirmed price,

depending on the workflow.

The previously defined planning/call-out fee can be configured rather than hardcoded.

---

# 29. Payment Compliance

Payment processing should minimize the data CLENQO handles directly.

The platform should prefer provider-hosted or tokenized payment mechanisms where appropriate.

CLENQO must not store raw:

* card numbers;
* CVV;
* payment authentication secrets.

---

# 30. Payment Records

CLENQO may retain:

* provider;
* provider transaction reference;
* amount;
* currency;
* status;
* timestamps;
* booking/invoice relationship.

These are business records, not raw payment credentials.

---

# 31. Invoicing

Invoice requirements may vary by jurisdiction.

The invoice model should support:

* legal entity information;
* customer information where required;
* invoice number;
* issue date;
* service date;
* line items;
* tax information;
* total;
* currency;
* payment status.

Jurisdiction-specific invoice requirements must be configurable or implemented through country-specific rules.

---

# 32. Invoice Numbering

Invoice numbers must be:

* unique;
* predictable enough for accounting;
* resistant to accidental duplication;
* generated server-side.

If numbering requirements differ by legal entity or country, numbering sequences must support that scope.

---

# 33. Tax

Tax calculation must not be hardcoded globally.

Potential configuration:

```text
jurisdiction
tax type
rate
effective date
applicability
```

The tax engine should remain separate from CMS presentation.

Professional tax/accounting review is required for production rules.

---

# 34. Currency

Every financial transaction must identify its currency.

The system should not infer currency solely from locale.

Example:

```text
EUR
```

is explicit.

Historical financial records must preserve their original currency.

---

# 35. Employee Data

Employee information requires controlled access.

The platform should distinguish:

* operational employee data;
* employment records;
* sensitive HR information.

Only the information required for operational workflows should be available to cleaners and branch users.

---

# 36. Employee Documents

Restricted employee documents should:

* use private storage;
* have controlled access;
* be auditable where appropriate;
* follow retention rules;
* not be exposed through normal search.

---

# 37. Employment Compliance

Employment rules may vary substantially by:

* country;
* region;
* employment type;
* working hours;
* minimum wage;
* leave;
* taxes;
* social insurance;
* contracts.

The platform should support configuration and record keeping but must not assume that one employment model is legally valid everywhere.

---

# 38. Initial Employment Types

The current business model includes:

```text
part_time
minijob
flexible
full_time
```

These are operational categories.

Their legal meaning and requirements must be validated for the relevant jurisdiction.

---

# 39. Working Time

Employee scheduling must support rules such as:

* working hours;
* availability;
* breaks;
* leave;
* exceptions;
* maximum working periods where applicable.

Legal working-time constraints must be configurable and reviewed by jurisdiction.

---

# 40. Employee Monitoring

Operational telemetry should not become uncontrolled employee surveillance.

The system should collect only information necessary for:

* job execution;
* scheduling;
* safety;
* quality;
* payroll/business operations.

Any employee monitoring feature requires appropriate legal and HR review.

---

# 41. Location Data

Cleaner check-in/out and navigation may involve location-related information.

Location data is sensitive from a privacy perspective.

The platform should:

* collect only what is necessary;
* define the purpose;
* limit retention;
* restrict access;
* avoid unnecessary continuous tracking.

Continuous employee location tracking should not be assumed as a default feature.

---

# 42. Job Photos

Cleaner evidence photos may contain personal information.

The system should:

* define the purpose;
* limit access;
* avoid unnecessary faces/personal documents;
* apply retention rules;
* prevent public exposure.

---

# 43. Customer Addresses

Cleaning addresses are operationally necessary in many bookings.

They must be treated as confidential customer data.

Access should be limited to:

* authorized branch staff;
* assigned cleaner where necessary;
* authorized operational systems.

---

# 44. Data Retention

CLENQO should define retention schedules by data category.

Potential categories:

```text
customer records
bookings
financial records
employee records
job evidence
audit records
notifications
consent records
CMS content
logs
```

Retention periods must account for:

* legal requirements;
* contractual needs;
* dispute periods;
* operational needs;
* privacy obligations.

Exact periods require jurisdiction-specific legal/accounting review.

---

# 45. Deletion and Anonymization

Not every record can simply be deleted.

Some records may need to be:

```text
retained
```

while personal identifiers may eventually be:

```text
anonymized or restricted
```

where legally and operationally appropriate.

Deletion workflows must preserve required business and legal records.

---

# 46. Data Subject Rights

Where applicable, the platform should support workflows for rights such as:

* access;
* correction;
* deletion;
* restriction;
* portability;
* objection.

The exact rights and exemptions depend on applicable law.

---

# 47. Data Export

Authorized privacy/admin workflows may eventually generate a structured customer data export.

Exports must:

* verify identity;
* verify authorization;
* include only relevant data;
* protect the resulting file;
* expire access appropriately;
* be audited.

---

# 48. Data Correction

Customers and authorized staff should be able to correct permitted information.

Corrections should be audited where appropriate.

Historical financial/audit records should not be silently rewritten when preservation is legally or operationally required.

---

# 49. Identity Verification

Sensitive privacy operations may require additional identity verification.

The exact verification mechanism should be determined by the legal/privacy process.

A simple magic link should not automatically be treated as sufficient proof for every sensitive request.

---

# 50. Data Breach Architecture

The system should support investigation of potential data incidents.

Observability and audit should allow investigation of:

```text
who accessed what
when
from which operation
under which scope
what changed
```

This is one reason auditability is a core architecture requirement.

---

# 51. Incident Response

A security/privacy incident should follow a controlled process:

```text
Detect
 ↓
Contain
 ↓
Assess
 ↓
Investigate
 ↓
Remediate
 ↓
Notify where legally required
 ↓
Document
 ↓
Improve
```

Specific notification obligations must be handled according to applicable law and professional advice.

---

# 52. Data Processing Agreements

As CLENQO uses external service providers, the business should maintain appropriate contractual/privacy documentation where required.

Potential providers include:

* hosting;
* database/storage;
* email;
* payments;
* analytics;
* messaging;
* AI services.

The application should maintain a registry of significant subprocessors/providers where useful.

---

# 53. Third-Party Data Sharing

Third-party integrations must have explicit purposes.

Before adding an integration, determine:

```text
what data leaves CLENQO?
why?
where does it go?
who receives it?
how long is it retained?
what security controls apply?
```

Do not send complete customer or employee records to a provider when only a subset is required.

---

# 54. AI and Privacy

Future AI features must follow strict data-access controls.

AI must receive only authorized data necessary for the task.

Example:

```text
AI scheduling
→ authorized scheduling data
```

not:

```text
AI scheduling
→ entire customer database
```

Sensitive data should be minimized or anonymized where possible.

---

# 55. AI-Generated Decisions

AI should not silently make high-impact decisions involving:

* employment;
* customer eligibility;
* pricing exceptions;
* refunds;
* complaints;
* legal status.

AI recommendations should remain reviewable by authorized humans when the decision has material impact.

---

# 56. Accessibility

Public customer interfaces should be designed for accessibility.

This includes:

* keyboard access;
* readable typography;
* adequate contrast;
* labels;
* focus states;
* semantic HTML;
* accessible forms;
* reduced-motion support.

Applicable accessibility requirements should be evaluated for the relevant market.

---

# 57. Consumer Protection

Customer-facing experiences should avoid:

* deceptive pricing;
* hidden mandatory charges;
* misleading availability;
* fake urgency;
* unclear cancellation rules;
* misleading reviews;
* dark patterns.

The system must display real business state.

---

# 58. Reviews

Reviews must be authentic and handled transparently.

CLENQO should not:

* fabricate reviews;
* secretly alter customer ratings;
* misrepresent review averages;
* suppress legitimate criticism solely because it is negative.

Moderation rules should be documented.

---

# 59. Marketing Claims

Website claims should be supportable.

Examples:

```text
"98% fulfillment"
"4.7★ average rating"
"eco-friendly"
"best cleaning service"
```

must not be presented as factual claims unless the business can substantiate them.

Dynamic metrics should identify their measurement basis where useful.

---

# 60. Service Scope

Customers should understand what a cleaning service includes and excludes.

Service definitions should support:

* included tasks;
* excluded tasks;
* conditions;
* add-ons;
* limitations.

This reduces disputes and improves operational consistency.

---

# 61. Property Access

Cleaning often requires property access.

Terms and booking flows should address relevant responsibilities such as:

* keys;
* access codes;
* entry instructions;
* pets;
* alarms;
* restricted areas.

The exact contractual treatment requires legal review.

---

# 62. Damage and Incident Handling

The quality/incident system should record:

* incident type;
* description;
* evidence;
* time;
* job;
* responsible workflow;
* resolution.

Financial compensation or refunds must remain owned by the finance domain.

---

# 63. Cancellation and Refund Consistency

Legal/customer policies and technical behavior must remain synchronized.

Example:

```text
Policy says 12–24h = 25%
```

but the pricing/payment engine should not independently implement a different rule.

There must be one authoritative business configuration.

---

# 64. Legal Content in CMS

Legal pages may be managed through the CMS but require stronger publication controls.

Examples:

* terms;
* privacy notice;
* cookie information;
* cancellation policy;
* imprint/legal notice where applicable.

Only appropriately authorized users should publish legal content.

---

# 65. Legal Content Versioning

Legal content should support:

* draft;
* review;
* approved;
* published;
* archived.

Important changes should create audit records.

---

# 66. Branch Legal Content

A branch may have localized legal information where permitted.

However, branches must not independently modify legally controlled master content without the required authorization.

HQ/legal governance should control the structure and required elements.

---

# 67. Language Requirements

Legal content may require multiple languages depending on market and customer audience.

The localization system supports:

```text
de
en
fr
es
```

but legal translation quality must be reviewed appropriately.

Machine translation alone should not be assumed sufficient for legally important documents.

---

# 68. Country Expansion

Before activating a new country, perform a compliance readiness review covering:

```text
legal entity
privacy
consumer law
tax
invoicing
payments
employment
insurance
working time
service regulations
marketing
cookies
language
data transfers
```

A branch should not become operational merely because its technical provisioning succeeded.

---

# 69. Compliance Readiness

Branch activation may eventually require:

```text
technical readiness
+
operational readiness
+
legal/compliance readiness
```

The activation checklist should support jurisdiction-specific requirements.

---

# 70. Compliance Configuration

Configuration should be versioned where business/legal rules affect historical behavior.

Examples:

* tax rates;
* cancellation policy;
* terms version;
* privacy version;
* payment requirements.

Historical bookings must preserve the relevant configuration/snapshot where necessary.

---

# 71. Compliance Audit Trail

Important compliance changes should be auditable.

Examples:

```text
terms.published
privacy_policy.published
cookie_policy.updated
tax_configuration.updated
cancellation_policy.updated
consent_recorded
consent_withdrawn
data_export.created
data_deletion.requested
```

---

# 72. Access Control

Compliance-related information should be restricted.

Examples:

* consent records;
* employee documents;
* privacy requests;
* legal configuration;
* tax configuration.

Permissions should follow the authorization architecture.

---

# 73. Privacy Request Workflow

A future privacy request workflow may use:

```text
Request received
 ↓
Identity verified
 ↓
Scope determined
 ↓
Data located
 ↓
Legal exceptions evaluated
 ↓
Data exported/corrected/deleted/restricted
 ↓
Action recorded
 ↓
Request closed
```

The workflow must not automatically delete data that legal or accounting requirements require CLENQO to retain.

---

# 74. Legal Hold

Future functionality may support legal holds.

A legal hold may prevent deletion of relevant records while a dispute or investigation is active.

Retention automation must respect such holds.

---

# 75. Data Residency

As CLENQO expands internationally, data residency requirements may differ.

The architecture should avoid assuming that all future data must permanently reside in one geographic region.

Provider and regional infrastructure decisions should be reviewed before country expansion.

---

# 76. Cross-Border Transfers

Where personal data crosses jurisdictions, the business must evaluate applicable transfer requirements and contractual safeguards.

The application should minimize unnecessary cross-border transfers.

---

# 77. Compliance Documentation

The project should maintain a controlled record of:

* data categories;
* providers;
* processing purposes;
* retention rules;
* policies;
* consent mechanisms;
* security controls;
* jurisdictional configuration.

This may eventually become an internal compliance registry.

---

# 78. Legal Change Management

When a legal/business rule changes:

```text
Legal/business decision
→ documentation update
→ OpenSpec change
→ configuration/schema/code
→ tests
→ audit
→ deployment
```

Agents must not independently invent legal rules.

---

# 79. No Hardcoded Legal Rules

Avoid hardcoding:

```text
one country's tax rate
one country's cancellation law
one country's invoice requirements
one country's employment rules
one country's privacy language
```

unless the rule is explicitly scoped to that jurisdiction.

---

# 80. Compliance Testing

Compliance-sensitive features should test:

* consent recording;
* consent withdrawal;
* privacy policy versioning;
* terms acceptance;
* data access restrictions;
* deletion/anonymization;
* retention;
* branch jurisdiction;
* tax configuration;
* invoice generation;
* customer policy presentation.

---

# 81. Security Testing

Compliance and security overlap.

Test:

* cross-branch data access;
* employee document access;
* customer data isolation;
* private media;
* audit access;
* administrative privileges;
* data exports;
* magic links;
* provider credentials.

---

# 82. MVP Legal/Compliance Foundation

The MVP should include:

* privacy policy/legal content capability;
* terms acceptance foundation;
* configurable cancellation policy;
* transparent pricing;
* customer data minimization;
* privacy-safe logging;
* role-based access;
* branch isolation;
* secure customer magic links;
* private operational media;
* invoice/legal entity fields foundation;
* tax configuration foundation;
* audit trail;
* retention architecture.

---

# 83. Future Compliance Capabilities

Future capabilities may include:

* full privacy request management;
* consent management platform;
* cookie preference center;
* automated retention;
* legal holds;
* compliance dashboard;
* country-specific compliance modules;
* advanced tax engines;
* accounting integrations;
* employment compliance modules;
* data residency controls.

---

# 84. Architecture Rules

The following are mandatory:

1. Legal requirements must be treated as configurable where jurisdiction varies.
2. The platform must not hardcode one country's legal assumptions globally.
3. Personal data must be minimized.
4. Purpose must be defined for significant data collection.
5. Consent and terms acceptance are separate concepts.
6. Transactional and marketing communication remain separate.
7. Public and private data must remain separated.
8. Customer and employee data must be access-controlled.
9. Financial records must preserve historical truth.
10. Legal content must be versioned where historical evidence matters.
11. Important compliance changes must be auditable.
12. Retention must be deliberate.
13. Deletion must respect legal/business retention requirements.
14. Privacy workflows must verify identity and authorization.
15. External providers must receive only necessary data.
16. AI must not receive unauthorized sensitive information.
17. Branch activation must eventually support compliance readiness.
18. Legal rules must be reviewed by qualified professionals.
19. Engineering agents must not invent legal requirements.
20. Compliance behavior must be documented and tested.

---

# 85. Definition of Done

A legal/compliance feature is complete when:

* [ ] Applicable jurisdiction is identified.
* [ ] Business/legal requirement is documented.
* [ ] Data processed is identified.
* [ ] Purpose is documented.
* [ ] Access controls are defined.
* [ ] Retention behavior is defined.
* [ ] Required consent/acceptance behavior is defined.
* [ ] Relevant policy versioning exists.
* [ ] Historical state is preserved where required.
* [ ] Security controls are implemented.
* [ ] Audit requirements are implemented.
* [ ] Customer-facing disclosures are clear.
* [ ] Tests exist.
* [ ] Documentation is synchronized.
* [ ] OpenSpec acceptance criteria pass.
* [ ] Qualified legal/accounting review is obtained where required.

---

# 86. Golden Compliance Rule

> **CLENQO must be legally adaptable, privacy-conscious, transparent, auditable, and jurisdiction-aware; legal requirements must become explicit, reviewed, configurable platform rules rather than hidden assumptions inside application code.**
