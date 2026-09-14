# CLENQO — Search & Discovery

**Status:** Source of Truth
**Scope:** Public discovery, branch discovery, service discovery, dashboard search, filtering, indexing, authorization, relevance, pagination, and future search infrastructure
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL
**Primary Principle:** Search is a controlled read capability, never an alternative path around authorization or data ownership.

---

## 1. Purpose

This document defines how CLENQO handles search and discovery across the platform.

Search exists at several levels:

* public branch discovery;
* public service discovery;
* website content discovery;
* customer booking discovery;
* branch operational search;
* HQ cross-branch search;
* employee/job search;
* reporting filters;
* future global platform search.

The system must provide useful search while preserving:

* organization isolation;
* branch isolation;
* role permissions;
* customer privacy;
* employee privacy;
* performance;
* predictable relevance.

---

# 2. Core Principle

CLENQO follows:

```text
Search Request
    ↓
Authenticate if required
    ↓
Authorize
    ↓
Apply organization scope
    ↓
Apply branch/resource scope
    ↓
Validate query
    ↓
Search authoritative data
    ↓
Filter permitted results
    ↓
Paginate
    ↓
Return minimal result fields
```

Search must never be implemented as:

```text
search everything
→ filter permissions in the browser
```

---

# 3. Search vs Discovery

### Discovery

Helps a user find publicly available content.

Examples:

* branches;
* services;
* public website pages.

### Search

Finds records within an authorized data scope.

Examples:

* bookings;
* customers;
* employees;
* jobs;
* invoices.

The two capabilities have different security requirements.

---

# 4. Public Discovery

The public website may expose discoverable:

* active branches;
* published services;
* public service areas;
* published website pages;
* FAQs;
* approved reviews;
* public contact information.

Only published and publicly visible content may appear.

Draft or internal content must never leak through public search.

---

# 5. Branch Discovery

A future public branch finder may allow customers to search by:

* branch name;
* city;
* region;
* postal code;
* service area;
* country.

Example:

```text
Berlin
→ Berlin branch
```

The public discovery layer should return only active/public branches.

Suspended or archived branches should not appear as available booking destinations unless explicitly intended.

---

# 6. Branch Slugs

Public branch routing uses branch slugs.

Example:

```text
/clenqo/berlin
```

or the configured public route:

```text
/berlin
```

The exact URL structure is owned by the routing architecture.

Branch slugs must be:

* unique;
* normalized;
* validated;
* immutable or deliberately redirected when changed.

Branch-specific source code must never be created.

---

# 7. Service Discovery

Customers should be able to discover available services.

Examples:

```text
Home Cleaning
Business Cleaning
Deep Cleaning
Move-In/Move-Out
```

Service discovery must respect:

* branch availability;
* publication state;
* locale;
* service status;
* booking eligibility.

A service existing globally does not automatically mean it is bookable at every branch.

---

# 8. Service Search

Public service search may use:

* service name;
* translated name;
* description;
* category;
* branch availability.

Operational pricing details should not be exposed unless explicitly intended for public presentation.

The pricing engine remains authoritative for actual price calculation.

---

# 9. Website Content Search

If CLENQO introduces public website search, it should search only:

* published pages;
* published sections;
* approved FAQ content;
* approved service content;
* approved public reviews/content.

Draft and internal CMS content must remain excluded.

Search results must respect locale and branch.

---

# 10. Locale-Aware Search

Search should consider the requested locale.

Example:

```text
locale = de
query = Reinigung
```

should prioritize German content.

Fallback behavior should follow the localization rules:

```text
requested locale
→ branch default
→ organization default
→ platform fallback
```

A translated result must never be returned merely because its content belongs to another branch.

---

# 11. Dashboard Search

The dashboard may provide centralized search across authorized operational records.

Potential categories:

```text
Bookings
Customers
Employees
Jobs
Invoices
Payments
Branches
Services
Reviews
CMS content
```

Search results should be grouped by entity type where appropriate.

---

# 12. HQ Search

HQ users with appropriate permissions may search across branches.

Example:

```text
Customer: John Doe
→ Berlin booking
→ Hamburg booking
```

The HQ user must have the required organization-wide permission.

Cross-branch visibility must never be granted simply because the interface is an HQ interface.

---

# 13. Branch Manager Search

Branch Managers should search only authorized branch data.

Example:

```text
Branch Manager — Berlin
→ Berlin bookings
→ Berlin customers
→ Berlin employees
→ Berlin jobs
```

Changing:

```text
branchId=hamburg
```

must not expose Hamburg data.

---

# 14. Cleaner Search

Cleaners should have very limited search capabilities.

Search should generally be restricted to:

* assigned jobs;
* relevant schedules;
* authorized operational information.

A cleaner must not gain a global customer or employee search interface.

---

# 15. Customer Search

Customers should not receive unrestricted search access to the CLENQO database.

A customer may access their own:

* bookings;
* invoices where applicable;
* review history;
* relevant service information.

Magic-link access must remain narrowly scoped.

---

# 16. Search Authorization

Search must enforce the same permission model as ordinary record retrieval.

Example:

```text
bookings.view
customers.view
employees.view
jobs.view
invoices.view
payments.view
branches.view
website.view
```

Search must not create hidden permissions.

If a user cannot directly access a record, search must not reveal it.

---

# 17. Search and RLS

RLS remains an additional protection layer.

Search queries must be compatible with RLS.

Do not solve search performance by disabling RLS and assuming application filters are sufficient.

If privileged database access is required for a specific operation, the server must explicitly authorize the caller before using it.

---

# 18. Search Result Minimization

Search results should return only fields needed to identify the record.

Example customer result:

```text
name
masked/limited contact information
booking count where permitted
branch
```

Do not return complete records in a search response.

The user can open the authorized record detail page afterward.

---

# 19. Search Query Validation

Search input must be validated.

Controls should include:

* minimum query length where appropriate;
* maximum query length;
* allowed filters;
* allowed sort fields;
* allowed entity types;
* pagination limits.

Do not accept arbitrary SQL or database expressions.

---

# 20. Search Injection Protection

Search must use parameterized queries or safe database APIs.

Never construct SQL from raw search text.

Unsafe:

```text
SELECT *
FROM customers
WHERE name ILIKE '%${query}%'
```

Safe implementation must use parameterized values.

---

# 21. Wildcard Handling

Search systems should deliberately handle:

```text
%
_
```

and other wildcard/special characters where relevant.

A user query must not unexpectedly transform into an expensive unrestricted database pattern.

---

# 22. Full-Text Search

PostgreSQL full-text capabilities may be used initially where they provide sufficient performance.

Potential uses:

* CMS content;
* FAQs;
* services;
* branch descriptions.

Do not introduce a dedicated search engine before database search becomes insufficient.

---

# 23. Search Indexes

Use appropriate indexes for common searches.

Potential indexes include:

```text
branch slug
branch status
service status
service name
booking number
booking status
scheduled start
customer email
customer phone
employee name
employee status
job status
invoice number
```

Index design must follow actual query patterns.

---

# 24. Booking Search

Dashboard booking search may support:

* booking number;
* customer name;
* email;
* phone;
* booking status;
* date range;
* service;
* branch;
* cleaner;
* booking type.

Filters must respect authorization scope.

---

# 25. Customer Search

Authorized staff may search customers by:

* name;
* email;
* phone;
* booking number;
* customer ID where appropriate.

Search should avoid unnecessarily exposing sensitive customer data.

---

# 26. Employee Search

Authorized managers may search employees by:

* name;
* employee status;
* employment type;
* skill;
* branch;
* availability.

Sensitive employment information must only be shown to authorized roles.

---

# 27. Job Search

Operational job search may include:

* job number;
* booking number;
* customer name;
* cleaner;
* status;
* scheduled date;
* branch.

Cleaner visibility remains restricted to authorized jobs.

---

# 28. Invoice and Payment Search

Financial search may include:

* invoice number;
* booking number;
* payment reference;
* customer;
* status;
* date;
* branch.

Financial access must be permission-controlled.

Payment credentials must never be searchable.

---

# 29. Branch Search

HQ users may search branches by:

* branch name;
* branch code;
* slug;
* city;
* country;
* status.

Branch search should support operational filtering:

```text
active
suspended
provisioning
ready
archived
```

---

# 30. CMS Search

Authorized dashboard users may search:

* pages;
* sections;
* media;
* navigation items;
* SEO records.

Search results must respect:

* branch;
* locale;
* content permissions;
* draft/published state.

---

# 31. Media Search

Media manager search may support:

* filename;
* alt text;
* media type;
* branch;
* page usage;
* upload date.

Private employee/customer media must remain outside ordinary public CMS search.

---

# 32. Search Ranking

Ranking should remain simple initially.

Possible ranking signals:

```text
exact match
prefix match
word match
text relevance
recency where useful
business priority
```

Do not build an unnecessarily sophisticated ranking system before real usage demonstrates the need.

---

# 33. Exact Identifier Search

Known identifiers should receive high priority.

Examples:

```text
CLNQ-2026-00123
INV-2026-00045
```

If the query exactly matches a booking or invoice number, the corresponding result should rank highly.

---

# 34. Typo Tolerance

Future search may support typo tolerance.

Examples:

```text
Reiniguing
→ Reinigung
```

This should be introduced only when useful.

The first implementation can rely on normalized matching and sensible database search.

---

# 35. Normalization

Search may normalize:

* case;
* whitespace;
* common punctuation;
* phone number formatting;
* Unicode forms where appropriate.

Normalization must not destroy meaningful identifiers.

---

# 36. Phone Search

Phone searches require careful normalization.

Examples:

```text
+49 170 1234567
0170 1234567
```

may represent the same number.

Search normalization should be deterministic.

Phone data remains sensitive and must be protected by authorization.

---

# 37. Email Search

Email search should generally be case-insensitive for practical lookup.

However, the stored canonical representation and provider semantics remain authoritative.

Do not expose emails to unauthorized users simply because they are searchable.

---

# 38. Pagination

All potentially large search results must be paginated.

The server must enforce a maximum page size.

Example conceptual limit:

```text
default = 25
maximum = 100
```

The exact values may be adjusted during implementation.

---

# 39. Cursor Pagination

Cursor pagination should be preferred for very large operational datasets.

Potential examples:

* audit logs;
* booking history;
* notification deliveries;
* job history.

Offset pagination remains acceptable for smaller dashboard lists.

---

# 40. Sorting

Sorting must use allowlisted fields.

Examples:

```text
created_at
scheduled_start
name
status
updated_at
```

The client must not provide arbitrary SQL expressions.

---

# 41. Filtering

Filters should be explicit.

Examples:

```text
status
branch
service
date range
employee
locale
payment status
booking type
```

Each filter must be validated and authorized.

---

# 42. Date Search

Date-based search must respect the relevant timezone.

For branch operations:

```text
branch timezone
```

should determine the interpretation of operational dates.

Database timestamps remain UTC.

---

# 43. Search Performance

Search must remain responsive for normal dashboard workflows.

Optimize through:

* indexes;
* bounded result sets;
* selective fields;
* appropriate pagination;
* query planning;
* caching where safe.

Do not sacrifice authorization for performance.

---

# 44. Expensive Search

Potentially expensive operations should be:

* rate-limited;
* paginated;
* monitored;
* optionally moved to asynchronous processing.

Examples:

* large exports;
* complex cross-branch searches;
* historical analytics;
* full audit searches.

---

# 45. Search Caching

Public discovery may be cached.

Examples:

* published branch list;
* published services;
* public website search.

Authenticated operational search should be cached cautiously.

Cache keys must include relevant authorization scope.

---

# 46. Search Exports

Future dashboard exports may support:

* CSV;
* spreadsheet;
* PDF/report.

Exports are not equivalent to search.

They require:

* authorization;
* scope validation;
* potentially asynchronous processing;
* audit logging;
* rate limiting.

---

# 47. Search and Reporting

Search answers:

> Which records match this query?

Reporting answers:

> What does the data tell us?

Do not turn search into a replacement for the reporting system.

---

# 48. Search and CMS

CMS search should help administrators find content without changing the content source of truth.

Example:

```text
Search "Berlin"
→ Hero section
→ Branch page
→ SEO metadata
→ FAQ
```

Editing still happens through the CMS domain.

---

# 49. Search and Website Routing

Public branch discovery and routing must resolve through branch data.

The system must never use hardcoded route-to-branch mappings such as:

```text
/berlin → hardcoded branch object
```

Instead:

```text
/berlin
→ resolve branch slug
→ validate published/active state
→ load branch configuration
→ render template
```

---

# 50. Search Security

Search endpoints should defend against:

* enumeration;
* scraping;
* excessive queries;
* unauthorized filtering;
* cross-branch access;
* cross-organization access;
* SQL injection;
* expensive wildcard queries.

Public search should reveal only intended public information.

---

# 51. Enumeration Protection

Sensitive resources should not expose predictable sequential IDs.

CLENQO uses UUID-based identifiers where appropriate.

Search responses should also avoid revealing internal database structure unnecessarily.

---

# 52. Public Branch Enumeration

If a branch directory is public, public branch discovery is intentional.

However, it should expose only approved public fields.

For example:

```text
name
city
country
public slug
service availability
public contact information
```

not:

```text
internal IDs
employee counts
financial metrics
internal configuration
```

---

# 53. Customer Privacy

Search must never become a way to discover customers.

Public endpoints must not allow:

```text
search customer by email
search customer by phone
search customer by name
```

unless a narrowly defined authorized flow requires it.

---

# 54. Employee Privacy

Public search must not expose employee records.

Internal employee search remains permission-controlled.

Sensitive employee information must be excluded from ordinary operational search results.

---

# 55. Search Logging

Important search operations may be logged for:

* performance;
* abuse detection;
* debugging;
* security monitoring.

Search logs should not unnecessarily store complete sensitive queries.

---

# 56. Search Analytics

Public discovery analytics may measure:

* popular searches;
* zero-result searches;
* search-to-booking conversion;
* branch discovery;
* service discovery.

Analytics should remain privacy-conscious.

---

# 57. Zero Results

Search should provide a useful zero-result state.

Examples:

```text
No matching branches.
Try another city.
```

or:

```text
No bookings found.
Try a different booking number or date.
```

Do not reveal whether hidden/unauthorized records exist.

---

# 58. Search Suggestions

Future autocomplete may provide:

* branches;
* services;
* booking numbers;
* customers for authorized staff;
* employees;
* jobs.

Suggestions must use the same authorization rules as full search.

---

# 59. Search Debouncing

Client-side search inputs may debounce requests to reduce unnecessary traffic.

However, debouncing is only a UX/performance optimization.

It is not a security control.

---

# 60. Search API Contract

Conceptually:

```text
/api/search
```

or domain-specific routes may be used.

The implementation should prefer domain-specific endpoints when search behavior becomes complex.

For example:

```text
/api/bookings/search
/api/customers/search
/api/branches/search
```

may be preferable to a single unrestricted global endpoint.

---

# 61. Global Search

A global dashboard search may eventually provide a unified interface.

It must internally execute authorized searches across individual domains.

Conceptually:

```text
Global Search
   ↓
Permission checks
   ↓
Branch scope
   ↓
Booking search
Customer search
Employee search
Job search
Invoice search
CMS search
```

The global interface must not create a separate data-access layer that bypasses domain ownership.

---

# 62. Search Architecture Evolution

Initial:

```text
Next.js
+
PostgreSQL
+
indexes
+
full-text search where useful
```

Future, if justified:

```text
Dedicated search infrastructure
```

Possible technologies can be evaluated later based on:

* scale;
* latency;
* multilingual relevance;
* fuzzy matching;
* geographic search;
* indexing complexity.

---

# 63. Multilingual Search

As CLENQO expands internationally, search may need to support:

* German;
* English;
* French;
* Spanish;
* future languages.

Search indexes should account for language-specific tokenization where beneficial.

Do not hardcode the initial four languages into the architecture.

---

# 64. Geographic Discovery

Future branch discovery may support:

* city;
* postal code;
* region;
* country;
* coordinates;
* service radius.

Geographic search should be introduced only when branch/service-area requirements justify it.

---

# 65. Service Area Search

A customer may eventually ask:

> Which CLENQO branch serves this address?

The system should resolve service-area coverage through branch configuration and operational rules.

The result must not assume that the nearest branch automatically serves the address.

---

# 66. Search Observability

Monitor:

* search latency;
* error rate;
* result counts;
* zero-result rate;
* expensive queries;
* rate-limit events;
* authorization failures.

This helps distinguish:

```text
no matching record
```

from:

```text
search system malfunction.
```

---

# 67. Testing

Search must be tested for:

### Functional

* exact matches;
* partial matches;
* filtering;
* sorting;
* pagination;
* localization.

### Security

* unauthorized access;
* cross-branch access;
* cross-organization access;
* hidden record leakage.

### Performance

* large datasets;
* concurrent searches;
* expensive queries.

### Privacy

* customer data minimization;
* employee data protection;
* public/internal separation.

---

# 68. Search Fixtures

Tests should include representative:

* branches;
* services;
* customers;
* bookings;
* employees;
* jobs;
* invoices;
* localized content.

Fixtures must avoid unnecessary real personal data.

---

# 69. MVP Search

The MVP should prioritize:

### Public

* branch resolution;
* public service discovery;
* localized website content lookup where needed.

### Admin

* branch search;
* booking search;
* customer search;
* employee search;
* job search;
* basic invoice/payment search where authorized.

### Cleaner

* assigned-job lookup.

### Security

* authorization;
* branch isolation;
* RLS;
* pagination;
* query validation.

---

# 70. Future Search

Future capabilities may include:

* global search;
* fuzzy matching;
* autocomplete;
* geographic branch finder;
* advanced multilingual search;
* dedicated search infrastructure;
* semantic search;
* AI-assisted discovery.

AI search must never bypass authorization.

---

# 71. AI Search Rule

If AI-powered search is introduced:

```text
User
 ↓
Authorization
 ↓
Authorized retrieval
 ↓
AI ranking/summarization
```

Never:

```text
User
 ↓
AI accesses entire database
 ↓
AI decides what user may see
```

Authorization must happen before AI receives the data.

---

# 72. Architecture Rules

The following are mandatory:

1. Search is a read capability, not a security boundary.
2. Search must enforce authorization.
3. RLS remains a defense layer.
4. Organization scope must be enforced.
5. Branch scope must be enforced.
6. Customer access must remain narrowly scoped.
7. Cleaner search must remain job-scoped.
8. Public search exposes only published public data.
9. Search input must be validated.
10. SQL must never be constructed from raw search input.
11. Sort/filter fields must be allowlisted.
12. Large results must be paginated.
13. Search responses must minimize returned data.
14. Search must not bypass domain ownership.
15. Search must not replace reporting.
16. Search must not expose hidden records through zero-result behavior.
17. Search performance must be monitored.
18. Dedicated search infrastructure should be introduced only when justified.
19. AI retrieval must occur only after authorization.
20. Search behavior must remain compatible with the multi-branch architecture.

---

# 73. Definition of Done

A search feature is complete when:

* [ ] Search purpose is defined.
* [ ] Search scope is defined.
* [ ] Authentication requirement is defined.
* [ ] Authorization requirement is defined.
* [ ] Organization scope is enforced.
* [ ] Branch scope is enforced.
* [ ] RLS is verified.
* [ ] Input is validated.
* [ ] Filters are allowlisted.
* [ ] Sorting is allowlisted.
* [ ] Pagination exists.
* [ ] Result fields are minimized.
* [ ] Sensitive data is protected.
* [ ] Performance is acceptable.
* [ ] Security tests exist.
* [ ] Zero-result behavior is safe.
* [ ] Observability exists.
* [ ] Documentation is synchronized.
* [ ] OpenSpec acceptance criteria pass.

---

# 74. Golden Search Rule

> **Search must help authorized users find the information they are allowed to access, while making it impossible for search itself to become a shortcut around CLENQO's authorization, branch isolation, privacy, or domain boundaries.**
