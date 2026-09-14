# CLENQO Reporting and Analytics

## 1. Purpose

The CLENQO Reporting and Analytics system provides centralized visibility into business, operational, financial, workforce, customer, website, booking, and quality performance.

It must support:

* branch-level reporting
* HQ cross-branch reporting
* operational dashboards
* financial reporting
* workforce metrics
* customer metrics
* quality metrics
* website and booking conversion
* trend analysis
* exports
* future AI-assisted insights

Reporting is a read-oriented analytical layer.

It must not become the authoritative source for operational business data.

---

# 2. Core Principle

> **Operational domains own the facts. Reporting aggregates and explains those facts.**

For example:

```text
Booking Domain
      ↓
booking facts
      ↓
Reporting
      ↓
booking metrics
```

Reporting must not redefine booking state, pricing, payment state, or employee state.

---

# 3. Source of Truth

Authoritative data remains in the corresponding domain.

Examples:

```text
Bookings
→ Booking Domain

Prices
→ Pricing Domain

Payments
→ Finance Domain

Jobs
→ Workforce/Jobs Domain

Reviews
→ Quality Domain

Website content
→ CMS Domain
```

Analytics reads from these sources.

---

# 4. Reporting Architecture

Conceptually:

```text
Operational Data
      │
      ├── Bookings
      ├── Jobs
      ├── Payments
      ├── Employees
      ├── Customers
      ├── Reviews
      └── Website Events
             ↓
       Reporting Layer
             ↓
      Metrics / Aggregates
             ↓
      Dashboard / Reports
```

---

# 5. Reporting Scope

Every report must have an explicit scope.

Possible scopes:

```text
platform
organization
branch
service
employee
customer
booking
time period
```

---

# 6. HQ Reporting

HQ users with appropriate permissions may view organization-wide metrics.

Examples:

```text
all branches
branch comparison
total revenue
total bookings
total jobs
customer growth
quality
workforce utilization
```

---

# 7. Branch Reporting

Branch managers should see metrics for their authorized branches.

Typical branch dashboard:

```text
Bookings
Revenue
Jobs
Customers
Employees
Quality
Conversion
```

---

# 8. Authorization

Reporting must respect the same authorization model as operational data.

A Branch Manager must not be able to retrieve another branch's private data simply by changing:

```text
branch_id
URL
query parameter
filter
API request
```

---

# 9. Aggregate Access

HQ may access aggregated cross-branch metrics where authorized.

Examples:

```text
Total Revenue
Average Rating
Bookings by Branch
Jobs by Branch
```

Cross-branch access must still follow permissions and privacy rules.

---

# 10. Reporting Time

Reports must define their time basis explicitly.

Examples:

```text
today
yesterday
this week
last week
this month
last month
quarter
year
custom range
```

---

# 11. Timezone

Reporting must respect branch and organization timezone configuration.

A day boundary must not be assumed to be UTC for customer-facing or branch-local operational reporting.

---

# 12. Date Storage

Operational timestamps remain stored consistently in UTC.

Reporting converts timestamps to the appropriate reporting timezone.

---

# 13. DST

Reports must correctly handle daylight-saving changes.

This is especially important for branches operating in countries with DST.

---

# 14. Currency

Financial reporting must identify currency.

For example:

```text
EUR
XAF
USD
```

A multi-country HQ report must not silently combine different currencies.

---

# 15. Currency Conversion

If cross-currency reporting is introduced, conversion must use an explicit:

* exchange-rate source
* rate timestamp
* conversion policy

Historical financial reports should remain reproducible.

---

# 16. Revenue Definition

Revenue metrics must distinguish between financial concepts.

Possible metrics:

```text
gross booking value
discounts
tax
net service value
payments received
refunds
outstanding amount
```

The dashboard must not label one metric simply as "Revenue" when its exact definition differs.

---

# 17. Booking Metrics

Core booking metrics include:

```text
total bookings
confirmed bookings
completed bookings
cancelled bookings
no-shows
pending bookings
```

---

# 18. Booking Conversion

Website booking conversion may be calculated as:

```text
completed booking actions
÷
eligible booking starts
```

The exact denominator must be explicitly defined.

---

# 19. Booking Funnel

Future analytics may track:

```text
Website Visit
 ↓
Booking Start
 ↓
Service Selected
 ↓
Date Selected
 ↓
Price Shown
 ↓
Customer Details
 ↓
Booking Submitted
 ↓
Booking Confirmed
```

This helps identify conversion friction.

---

# 20. Cancellation Rate

Cancellation rate may be defined as:

```text
cancelled bookings
÷
bookings eligible for cancellation measurement
```

The reporting definition must remain consistent.

---

# 21. Completion Rate

Operational completion may be measured as:

```text
completed jobs
÷
scheduled jobs
```

The reporting layer must document exclusions such as cancelled jobs.

---

# 22. On-Time Performance

The system should eventually measure:

```text
on-time arrivals
÷
eligible scheduled jobs
```

The acceptable on-time threshold must be configurable.

---

# 23. Job Metrics

Core job metrics:

```text
scheduled jobs
assigned jobs
unassigned jobs
in-progress jobs
completed jobs
cancelled jobs
no-shows
```

---

# 24. Assignment Metrics

Possible metrics:

```text
assignment rate
time to assignment
declined assignments
reassignment rate
unassigned jobs
```

---

# 25. Cleaner Performance

Reporting may provide operational metrics such as:

```text
jobs completed
hours worked
average job duration
on-time rate
customer rating
rework rate
```

These metrics must be interpreted carefully.

---

# 26. Employee Privacy

Employee analytics must not become an unrestricted surveillance mechanism.

Access to employee-specific data must be permission-controlled.

Sensitive employment information should not appear in general operational dashboards.

---

# 27. Employee Utilization

A future metric may compare:

```text
productive job time
÷
available working time
```

The denominator and exclusions must be clearly defined.

---

# 28. Customer Metrics

Customer reporting may include:

```text
new customers
returning customers
active customers
completed bookings
average booking value
repeat booking rate
```

---

# 29. Customer Retention

A future retention metric may measure customers who return within a defined period.

Example:

```text
customers with another completed booking
within 90 days
```

The period must be configurable.

---

# 30. Recurring Customers

Recurring booking performance should distinguish:

```text
one-time customers
recurring customers
recurring plans
active recurring plans
cancelled recurring plans
```

---

# 31. Average Order Value

Average booking value may be calculated as:

```text
eligible booking value
÷
eligible bookings
```

The financial definition must specify whether tax, discounts, refunds, and tips are included.

---

# 32. Service Performance

Reports may compare services by:

```text
bookings
revenue
average value
completion rate
cancellation rate
rating
duration
```

---

# 33. Add-On Performance

Add-ons may be analyzed by:

```text
selection count
revenue
attachment rate
```

This can inform service optimization.

---

# 34. Pricing Analytics

The reporting layer may analyze:

```text
average quoted price
average final price
discount usage
manual overrides
quote-required bookings
surcharges
```

Pricing authority remains in the Pricing Engine.

---

# 35. Price Variance

The system may eventually compare:

```text
estimated price
vs
final price
```

to identify frequent pricing corrections.

---

# 36. Manual Overrides

Manual pricing overrides should be measurable.

Possible metrics:

```text
override count
override percentage
average adjustment
override reasons
```

High override rates may indicate pricing-rule problems.

---

# 37. Quality Metrics

Core quality metrics:

```text
average rating
review count
complaint count
quality issues
rework count
rework rate
```

---

# 38. Rating

Customer rating should use the review system's authoritative values.

Example:

```text
Average Rating = Sum of Eligible Ratings / Eligible Reviews
```

The report must identify the review population.

---

# 39. Complaint Metrics

Reports may include:

```text
open complaints
resolved complaints
resolution time
complaints by category
complaints by branch
```

---

# 40. Rework

Rework should be measurable independently from complaints.

Possible metric:

```text
rework jobs
÷
eligible completed jobs
```

---

# 41. Website Analytics

The public website may generate privacy-conscious analytics events.

Examples:

```text
page_view
service_view
booking_start
booking_step_completed
booking_submitted
```

---

# 42. Analytics Privacy

Website analytics should avoid collecting unnecessary personal information.

Do not use analytics as a justification for storing sensitive customer data.

---

# 43. Consent

Where legally required, analytics tracking must respect applicable consent requirements.

Non-essential tracking should not silently bypass the consent system.

---

# 44. Marketing Analytics

Future reporting may include:

```text
traffic source
campaign
landing page
booking conversion
customer acquisition
```

Marketing attribution must be designed with privacy requirements in mind.

---

# 45. Customer Acquisition Cost

If marketing cost data becomes available:

```text
CAC =
eligible acquisition spend
÷
new customers attributed to that spend
```

Attribution rules must be explicit.

---

# 46. Branch Performance

HQ may compare branches across:

```text
bookings
revenue
conversion
completion
on-time performance
rating
complaints
rework
customer retention
```

---

# 47. Branch Ranking

Branch rankings should be used carefully.

A ranking should account for sample size and context where appropriate.

For example, a branch with five reviews should not automatically be treated as equivalent to one with 5,000 reviews.

---

# 48. Minimum Sample Sizes

Some metrics may require a minimum number of observations before being displayed as statistically meaningful.

The threshold should be metric-specific.

---

# 49. Trend Reporting

Reports should support comparisons such as:

```text
current period
vs
previous period
```

and:

```text
current month
vs
same month last year
```

where sufficient historical data exists.

---

# 50. Metric Definitions

Every important KPI should have a documented definition.

A metric should identify:

```text
name
definition
formula
source
filters
time basis
scope
currency if applicable
```

---

# 51. Metric Consistency

The same KPI must not produce different values across different dashboard screens without an explicit reason.

Central metric definitions are preferred.

---

# 52. Reporting Data Model

The initial implementation may use direct aggregate queries over normalized operational tables.

As scale increases, reporting may introduce:

```text
aggregate tables
materialized views
reporting views
precomputed metrics
event-based analytical data
```

The architecture must allow this evolution.

---

# 53. No Premature Data Warehouse

The initial CLENQO system does not require a separate enterprise data warehouse.

Start with PostgreSQL-based reporting.

Introduce additional analytical infrastructure only when justified by scale or requirements.

---

# 54. Materialized Reporting

Frequently used expensive metrics may eventually be precomputed.

Examples:

```text
daily branch revenue
daily bookings
monthly customer retention
branch quality summaries
```

---

# 55. Refresh Strategy

Each aggregate should define its freshness expectation.

Examples:

```text
real-time
near-real-time
hourly
daily
```

---

# 56. Operational vs Analytical Data

Operational screens may require current transactional state.

Analytics may tolerate delayed aggregation.

Example:

```text
Job Assignment
→ real-time

Monthly Branch Trend
→ aggregate refresh acceptable
```

---

# 57. Dashboard Cards

Dashboard KPI cards should show:

```text
metric
value
period
comparison
trend
```

Example:

```text
Bookings
1,248

+12.4%
vs previous month
```

---

# 58. Charts

Charts should support meaningful business interpretation.

Potential charts:

```text
bookings over time
revenue over time
branch comparison
service distribution
booking funnel
rating trend
job status
```

---

# 59. Tables

Reports should support sortable/filterable tables where appropriate.

Examples:

```text
branch performance
service performance
employee operations
booking performance
quality issues
```

---

# 60. Filters

Common filters:

```text
date range
branch
service
booking type
customer type
employee
status
locale
```

Filters must remain authorization-aware.

---

# 61. Saved Reports

Future functionality may allow users to save report configurations.

Example:

```text
Berlin Monthly Operations
```

Saved reports must preserve authorization rules.

---

# 62. Scheduled Reports

Future functionality may allow authorized users to schedule reports.

Potential delivery:

```text
email
dashboard
download
```

Scheduled reports must use the recipient's current authorization scope.

---

# 63. Export

Authorized users may export reports to:

```text
CSV
XLSX
PDF
```

Exports should respect the same filters and permissions as the displayed report.

---

# 64. Export Security

Exports can contain sensitive information.

Therefore:

* authorization is required
* downloads should be protected
* unnecessary fields should be excluded
* audit logging should be considered

---

# 65. Financial Reports

Financial reporting may include:

```text
gross sales
net sales
payments
refunds
outstanding invoices
tax
tips
fees
```

Finance remains authoritative.

---

# 66. Invoice Reporting

Reports may include:

```text
issued
paid
overdue
cancelled
refunded
```

---

# 67. Payment Reporting

Payment analytics may include:

```text
successful payments
failed payments
refunds
payment method
provider
outstanding amounts
```

Sensitive payment credentials must never appear.

---

# 68. Notification Analytics

The communication system may report:

```text
sent
delivered
failed
bounced
complaints
```

by:

```text
channel
template
branch
event
```

---

# 69. Notification Performance

Useful operational metrics include:

```text
delivery rate
failure rate
average delivery latency
retry count
```

---

# 70. Website Content Analytics

CMS content may eventually be measured by:

```text
views
CTA interactions
booking starts
conversion
```

Analytics must remain separate from CMS authority.

---

# 71. Event Tracking

Analytics events should use controlled event names.

Example:

```text
booking_started
booking_service_selected
booking_date_selected
booking_submitted
```

Avoid arbitrary event schemas that become impossible to maintain.

---

# 72. Event Properties

Event properties should be:

* documented
* validated
* minimal
* privacy-conscious

---

# 73. Event Identity

Analytics events may use anonymous/session identifiers where appropriate.

Avoid unnecessarily tying behavioral analytics directly to personal identity.

---

# 74. Operational Events vs Analytics Events

These are distinct concepts.

```text
Operational Event
→ booking_confirmed

Analytics Event
→ booking_confirmation_viewed
```

Operational events drive business workflows.

Analytics events measure behavior.

---

# 75. Audit vs Analytics

Audit logs and analytics are also distinct.

```text
Audit
→ who changed pricing?

Analytics
→ how often is pricing overridden?
```

Audit records should not be treated as a general analytics event stream.

---

# 76. Data Retention

Analytics retention should be defined independently from operational retention.

Only retain detailed analytics data for as long as useful and appropriate.

---

# 77. Aggregation and Privacy

When reporting data across customers or employees, aggregate where individual-level visibility is unnecessary.

---

# 78. Personally Identifiable Information

Reports should minimize exposure of:

* personal addresses
* phone numbers
* email addresses
* private notes
* sensitive employee information

---

# 79. Customer-Level Reporting

Customer-level reporting requires explicit authorization.

Example:

```text
Customer Support
→ limited customer information

HQ Analytics
→ aggregate customer metrics
```

---

# 80. Employee-Level Reporting

Employee-level metrics should be limited to users who need them operationally.

---

# 81. Report Performance

Reporting queries must avoid unnecessarily scanning massive datasets.

Use:

* appropriate indexes
* bounded date ranges
* aggregation
* pagination
* materialized views where justified

---

# 82. Query Safety

All report filters must be validated.

Use typed schemas such as Zod for report parameters.

---

# 83. SQL Safety

Reporting queries must use parameterized queries or safe query builders.

User-provided filters must never become raw SQL.

---

# 84. Caching

Read-heavy reports may be cached.

Cache keys must include relevant:

```text
organization
branch scope
report
filters
period
```

Authorization must not be bypassed through caching.

---

# 85. Cache Invalidation

When near-real-time reporting is required, cache invalidation should be driven by relevant domain changes.

---

# 86. Reporting API

Reporting services should expose structured server-side interfaces.

Conceptually:

```text
getBranchPerformance()
getBookingMetrics()
getRevenueMetrics()
getQualityMetrics()
getWorkforceMetrics()
```

---

# 87. Domain Separation

Reporting services should not directly modify operational business data.

Reporting is read-oriented.

---

# 88. Error Handling

If a report cannot be calculated:

```text
show clear error
log technical details
do not expose sensitive internals
```

A partial metric must not silently appear as a complete result.

---

# 89. Missing Data

Reports should distinguish between:

```text
0
```

and:

```text
No data
```

These are not equivalent.

---

# 90. Historical Reproducibility

Important financial and operational reports should be reproducible.

Changes to pricing, currency conversion, metric definitions, or source data must not silently rewrite historical meaning.

---

# 91. Metric Versioning

If a KPI formula changes materially, the system should be able to identify which definition/version produced historical values.

---

# 92. Branch Launch Reporting

New branches may have insufficient data.

Dashboards should avoid misleading comparisons where sample sizes are too small.

---

# 93. Multi-Country Reporting

Future international reporting must support:

```text
country
currency
timezone
tax regime
locale
```

without hardcoding Germany.

---

# 94. Reporting Permissions

Example permission families:

```text
reports.view
reports.export
reports.financial
reports.workforce
reports.customer
reports.quality
reports.cross_branch
reports.manage
```

---

# 95. Financial Reporting Protection

Financial reports should require explicit financial-reporting permission.

General operational dashboard access should not automatically grant financial reporting access.

---

# 96. Report Audit

Sensitive report access and exports may be audited.

Especially:

```text
financial exports
customer-level exports
employee-level reports
cross-branch exports
```

---

# 97. Alerts

Future analytics may trigger operational alerts.

Examples:

```text
booking conversion falls significantly
unassigned jobs exceed threshold
quality rating falls
payment failures increase
```

Alerts should use documented thresholds.

---

# 98. Automation Integration

Analytics may eventually feed automation.

Example:

```text
Metric
 ↓
Threshold
 ↓
Business Rule
 ↓
Notification / Task
```

Analytics itself should not execute arbitrary business actions.

---

# 99. AI Analytics

Future AI functionality may summarize:

```text
what changed
why it may have changed
what requires attention
possible actions
```

AI output is advisory.

It must not silently alter financial, staffing, pricing, or customer decisions.

---

# 100. AI Data Access

AI analytics must receive only data authorized for the requesting user.

A Branch Manager's AI assistant must not gain HQ-wide data merely because it is an AI feature.

---

# 101. Reporting Testing

Tests should cover:

* metric formulas
* date boundaries
* timezone
* DST
* branch isolation
* organization isolation
* currency
* permissions
* empty datasets
* large datasets
* cancelled records
* refunds
* partial periods
* historical reproducibility

---

# 102. Reporting Verification

Important metrics should be verified against known datasets.

Example:

```text
Known bookings = 100
Completed = 80
Cancelled = 15
Pending = 5
```

The dashboard should produce the expected values.

---

# 103. Observability

Reporting should expose:

* query latency
* failed queries
* expensive reports
* aggregation failures
* stale data
* export failures

---

# 104. MVP Reporting

Initial reporting should include:

```text
HQ overview
branch overview
booking count
booking status
job count
revenue/payment summary
customer count
average rating
cancellation rate
completion rate
basic trends
date filtering
branch filtering
permission-aware reporting
```

---

# 105. Initial Reporting Architecture

Start with:

```text
PostgreSQL
   ↓
Server-side reporting services
   ↓
Validated queries
   ↓
Dashboard
```

Avoid introducing a separate analytics platform prematurely.

---

# 106. Future Reporting Architecture

As CLENQO grows:

```text
PostgreSQL
      ↓
Domain Events
      ↓
Aggregation
      ↓
Reporting Store / Warehouse
      ↓
Advanced Analytics
      ↓
AI Insights
```

The transition must preserve operational source-of-truth boundaries.

---

# 107. Reporting Roadmap

### Phase 1

* basic HQ dashboard
* branch dashboard
* bookings
* jobs
* payments
* customers
* quality
* basic filters

### Phase 2

* trends
* branch comparison
* service analytics
* workforce metrics
* conversion funnel
* exports

### Phase 3

* advanced retention
* marketing attribution
* scheduled reports
* alerts
* precomputed aggregates

### Phase 4

* analytical warehouse if justified
* advanced forecasting
* AI insights
* anomaly detection
* predictive operations

---

# 108. Golden Reporting Rule

> **CLENQO reporting must measure the business without becoming the business. Operational domains remain authoritative, every metric has a clear definition and scope, branch isolation and permissions are enforced, financial and personal data are protected, and the reporting architecture can evolve from PostgreSQL queries to aggregated analytics without requiring a redesign of the core platform.**
