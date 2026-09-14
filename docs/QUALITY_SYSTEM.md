# CLENQO Quality and Reviews

## 1. Purpose

The CLENQO Quality and Reviews system manages customer feedback, service quality, complaints, incidents, inspections, and quality improvement.

It connects:

```text
Completed Job
      ↓
Customer Review
      ↓
Quality Analysis
      ↓
Issue Detection
      ↓
Resolution
      ↓
Operational Improvement
```

It also supports internal quality checks:

```text
Job
 ↓
Quality Checklist
 ↓
Inspection
 ↓
Issue
 ↓
Resolution
```

---

# 2. Core Quality Principle

> **CLENQO should measure service quality from both customer feedback and operational evidence, then use that information to continuously improve the service.**

Quality data must be actionable, not simply stored as ratings.

---

# 3. Quality Sources

Quality information may come from:

```text
customer reviews
customer complaints
cleaner reports
manager inspections
job checklists
before/after photos
incidents
support interactions
```

---

# 4. Customer Reviews

Customers may submit a review after a completed booking.

A review may contain:

```text
rating
comment
booking
customer
created_at
```

---

# 5. Rating Scale

Initial rating scale:

```text
1 ★
2 ★
3 ★
4 ★
5 ★
```

The system should use a consistent scale.

---

# 6. Review Eligibility

A customer should generally be allowed to review only a completed service.

The review flow must verify:

```text
customer owns booking
booking completed
review not already submitted
```

---

# 7. Duplicate Review Protection

A customer must not be able to create unlimited reviews for the same completed service.

The system should enforce an appropriate uniqueness rule.

---

# 8. Review Timing

Review requests should normally occur after service completion.

The notification system handles delivery.

Example:

```text
Job Completed
 ↓
Review Request
 ↓
Customer
 ↓
Review
```

---

# 9. Review Content

A review may contain:

```text
rating
comment
```

Future structured questions may include:

```text
cleanliness
professionalism
punctuality
communication
```

---

# 10. Customer Comment Moderation

Customer-generated review content must be treated as untrusted input.

The system must protect against:

* XSS
* malicious HTML
* inappropriate content
* personal information exposure

---

# 11. Public Reviews

Reviews may eventually appear on the public website.

Only reviews that meet publication/moderation rules should become public.

A customer review must not automatically become public content.

---

# 12. Review Status

Possible review states:

```text
pending
published
hidden
flagged
removed
```

The exact lifecycle may evolve.

---

# 13. Review Moderation

Authorized staff may:

* approve
* hide
* flag
* respond
* remove from public display

Moderation actions must be audited.

---

# 14. Review Editing

Customer review editing should be restricted according to business policy.

If editing is allowed, the system should preserve appropriate history.

---

# 15. Review Response

Authorized CLENQO staff may respond to reviews.

Responses should be stored separately from the original customer comment.

---

# 16. Public Review Display

The public website may display:

```text
rating
customer first name/approved display name
comment
service context where appropriate
```

Do not expose unnecessary personal information.

---

# 17. Review Privacy

Customer identity must be minimized on public pages.

Avoid exposing:

```text
full address
phone
email
private booking information
```

---

# 18. Average Rating

The system may calculate:

```text
average rating
review count
rating distribution
```

These values should be derived from eligible reviews.

---

# 19. Rating Integrity

Hidden or invalid reviews must not accidentally remain in public rating calculations if the business rules exclude them.

The calculation rules must be deterministic.

---

# 20. Branch Ratings

Ratings should be available at branch level.

Conceptually:

```text
Organization
├── Branch A → 4.8 ★
├── Branch B → 4.6 ★
└── Branch C → 4.9 ★
```

HQ may see aggregate organization-wide metrics.

---

# 21. Service Ratings

The system may calculate quality metrics by service.

Examples:

```text
Home Cleaning
Deep Cleaning
Move-Out
Commercial
```

---

# 22. Cleaner-Related Ratings

Where appropriate, quality metrics may be associated with a cleaner/job.

This must be handled carefully.

A single customer rating should not automatically become a definitive employee performance judgment.

---

# 23. Quality Metrics

Useful quality metrics include:

```text
average rating
review response rate
complaint rate
repeat complaint rate
on-time rate
rework rate
incident rate
```

---

# 24. Quality Target

An initial business target may be:

```text
Average customer rating: 4.7★
```

This is a business KPI, not an application constant.

---

# 25. Complaints

Customers should have a way to report service problems.

Examples:

```text
service quality
late arrival
missing task
damage
cleaner behavior
billing issue
other
```

---

# 26. Complaint Record

A complaint should contain:

```text
booking
customer
branch
category
description
status
created_at
```

---

# 27. Complaint Status

Initial states:

```text
open
investigating
awaiting_customer
resolved
closed
```

---

# 28. Complaint Priority

Complaints may have:

```text
low
medium
high
critical
```

Priority determines operational response.

---

# 29. Complaint Ownership

A complaint should have an assigned responsible user/team where necessary.

Example:

```text
Complaint
 ↓
Branch Manager
```

---

# 30. Complaint Workflow

Typical flow:

```text
Customer Reports Issue
 ↓
Complaint Created
 ↓
Manager Reviews
 ↓
Investigation
 ↓
Resolution
 ↓
Customer Communication
 ↓
Closed
```

---

# 31. Complaint Resolution

Possible resolutions include:

```text
explanation
re-clean
partial refund
full refund
credit
discount
apology
no action
```

Financial outcomes must be processed through the finance domain.

---

# 32. Re-Clean

If service quality is insufficient, CLENQO may create a follow-up operational job.

Conceptually:

```text
Complaint
 ↓
Re-clean Required
 ↓
New Job
```

The new job should remain traceable to the original booking/complaint.

---

# 33. Damage Complaints

Damage reports should be linked to the appropriate job/incident.

Supporting evidence may include:

```text
photos
notes
timestamps
```

---

# 34. Quality Issues

An internal quality issue represents a problem discovered through:

* customer feedback
* inspection
* cleaner report
* incident
* operational monitoring

---

# 35. Quality Issue Record

Conceptually:

```text
job
category
severity
description
status
assigned_to
created_at
resolved_at
```

---

# 36. Quality Categories

Initial categories may include:

```text
cleaning_quality
punctuality
communication
missing_task
damage
safety
billing
customer_experience
```

---

# 37. Internal Quality Checks

Managers may perform inspections.

A quality check may contain:

```text
job
inspector
score
checklist
notes
photos
created_at
```

---

# 38. Quality Checklist

Quality checklists may be service-specific.

Example:

```text
Kitchen
Bathroom
Floors
Dusting
Waste
Overall condition
```

---

# 39. Quality Score

A quality check may produce:

```text
score
percentage
pass/fail
```

The scoring method must be explicitly defined.

---

# 40. Quality Threshold

A branch may define a minimum quality threshold.

Example:

```text
minimum_quality_score = configured value
```

A failed inspection may create a quality issue.

---

# 41. Rework

Quality failures may create rework.

Conceptually:

```text
Inspection Failed
 ↓
Quality Issue
 ↓
Rework Required
 ↓
Follow-Up Job
```

---

# 42. Quality and Cleaner Feedback

Where operationally appropriate, cleaners should receive constructive feedback.

The system should distinguish:

```text
operational feedback
```

from:

```text
formal employee action
```

The application should not automatically make employment decisions from review scores.

---

# 43. Quality Trends

The dashboard should eventually show trends:

```text
rating over time
complaints over time
rework rate
quality failures
```

---

# 44. Branch Quality Dashboard

Branch managers should see:

```text
Average Rating
Reviews
Complaints
Open Issues
Rework
Quality Checks
```

---

# 45. HQ Quality Dashboard

HQ may see:

```text
organization rating
branch comparison
service comparison
complaint trends
quality trends
```

Cross-branch visibility requires HQ authorization.

---

# 46. At-Risk Quality Detection

Future automation may identify:

```text
repeated complaints
falling rating
high rework
specific service problems
specific operational patterns
```

The system should surface these for human review.

---

# 47. Review-to-Operations Loop

Quality should feed back into operations.

Example:

```text
Low Rating
 ↓
Quality Issue
 ↓
Root Cause
 ↓
Operational Improvement
 ↓
Better Service
```

---

# 48. Root Cause

Future quality tooling may classify issues by root cause.

Examples:

```text
insufficient time
training gap
equipment problem
unclear checklist
customer expectation
scheduling issue
communication failure
```

---

# 49. Quality Improvement Actions

The system may eventually track actions such as:

```text
update checklist
train cleaner
change duration rule
change equipment
change service description
adjust scheduling buffer
```

---

# 50. Quality and Pricing

Quality findings may reveal that service duration is consistently underestimated.

Example:

```text
Estimated = 120 min
Actual average = 165 min
```

This information may inform future pricing/scheduling changes.

The quality system must not directly modify pricing.

---

# 51. Quality and Scheduling

Repeated lateness may indicate:

```text
insufficient travel buffer
unrealistic service duration
overloaded schedule
```

Scheduling administrators can use these insights.

---

# 52. Quality and Workforce

Repeated operational problems may indicate:

```text
training requirement
skill mismatch
assignment problem
equipment issue
```

The workforce system remains responsible for employee records and assignments.

---

# 53. Quality and Customer Retention

Quality data may eventually contribute to:

```text
repeat booking analysis
customer churn risk
service recovery
loyalty programs
```

Such automation should remain separate from the core review record.

---

# 54. Service Recovery

When a serious service issue occurs, authorized staff may provide:

```text
refund
credit
discount
re-clean
priority support
```

Financial actions must go through the finance domain.

---

# 55. Review Moderation Permissions

Suggested permissions:

```text
reviews.view
reviews.moderate
reviews.publish
reviews.respond
reviews.hide
```

---

# 56. Quality Permissions

Suggested permissions:

```text
quality.view
quality.create_check
quality.manage_issue
quality.resolve_issue
quality.report
```

Exact permissions remain configurable.

---

# 57. Branch Isolation

Branch managers must only access:

```text
reviews
complaints
quality checks
issues
```

for authorized branches.

HQ access follows organization-level permissions.

---

# 58. Customer Access

Customers should only access their own:

```text
reviews
complaints
booking-related quality communications
```

through secure customer access.

---

# 59. Auditability

Quality actions should be auditable.

Examples:

```text
review hidden
complaint reassigned
quality issue resolved
inspection changed
service recovery approved
```

---

# 60. Review Security

Customer review submissions must protect against:

* unauthorized booking access
* spam
* duplicate submissions
* malicious content
* automated abuse

Rate limiting should be applied where appropriate.

---

# 61. Complaint Security

Complaint data may contain sensitive information.

Access must be restricted using:

* authentication
* authorization
* RLS
* branch scope
* customer ownership

---

# 62. Quality Evidence Storage

Photos and documents should use controlled Supabase Storage access.

Do not make operational evidence publicly accessible by default.

---

# 63. Quality Notifications

Quality events may trigger notifications:

```text
new complaint
critical issue
inspection failure
resolution
review request
```

The notification domain handles delivery.

---

# 64. Notification Separation

The quality domain should emit events such as:

```text
review_created
complaint_created
complaint_resolved
quality_issue_created
quality_issue_resolved
```

It should not directly call SES, WhatsApp, or SMS APIs.

---

# 65. Analytics

The system should support quality analytics by:

```text
branch
service
booking type
time period
employee/job where appropriate
```

---

# 66. Quality Data Interpretation

Metrics must be interpreted with sufficient context.

For example:

```text
10 reviews with 5.0★
```

is not necessarily equivalent to:

```text
1,000 reviews with 4.8★
```

Dashboards should expose sample size.

---

# 67. Review Aggregation

The system may calculate:

```text
average
median where useful
count
distribution
trend
```

Avoid misleading metrics.

---

# 68. Quality Reporting

Future reports may include:

```text
weekly quality report
monthly branch report
service quality report
complaint report
rework report
```

---

# 69. Quality Alerts

Future automated alerts may trigger when:

```text
rating falls below threshold
complaints exceed threshold
critical issue occurs
rework exceeds threshold
```

Alerts should be configurable and human-reviewable.

---

# 70. Quality and AI

Future AI functionality may assist with:

* complaint classification
* review sentiment analysis
* root-cause suggestions
* quality trend detection
* operational recommendations

AI outputs must remain advisory unless an explicit business process authorizes automation.

---

# 71. AI Safety

AI must not independently:

* punish employees
* deny refunds
* hide reviews
* make employment decisions
* alter pricing
* alter scheduling

without an explicit authorized workflow.

---

# 72. Data Retention

Reviews, complaints, quality checks, and evidence should follow documented retention policies.

Historical quality records should not disappear simply because a customer or employee is deactivated.

---

# 73. Testing Strategy

Automated tests should cover:

```text
review eligibility
duplicate review prevention
rating calculation
moderation
complaints
issue lifecycle
quality checks
permissions
branch isolation
customer ownership
photo access
service recovery
notifications
```

---

# 74. MVP Quality Scope

Initial implementation should include:

```text
customer reviews
1–5 rating
review comments
review request trigger
basic moderation
branch rating aggregation
complaint creation
complaint status
quality issue foundation
manager visibility
basic audit trail
```

---

# 75. Future Quality Capabilities

Future versions may add:

* structured review questions
* manager inspections
* advanced quality scoring
* rework workflows
* quality trend analytics
* automated quality alerts
* service recovery workflows
* customer satisfaction analytics
* AI-assisted quality analysis

---

# 76. Architectural Summary

The quality architecture is:

```text
Completed Job
      ├── Customer Review
      │       ↓
      │   Rating / Feedback
      │
      ├── Quality Check
      │       ↓
      │   Quality Issue
      │
      └── Incident
              ↓
          Investigation
              ↓
          Resolution
              ↓
       Operational Improvement
```

---

# 77. Golden Quality Rule

> **CLENQO must treat every completed service as an opportunity to measure and improve quality, combining customer feedback with operational evidence while keeping reviews, complaints, employee decisions, financial actions, and operational changes under their appropriate authorized domains.**
