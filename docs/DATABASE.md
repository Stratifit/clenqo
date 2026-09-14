# CLENQO Database Architecture

## 1. Purpose

This document defines the database architecture and data model for the CLENQO platform.

The database is built on:

* PostgreSQL
* Supabase
* Supabase Auth
* Supabase Storage
* PostgreSQL Row Level Security (RLS)

The database must support:

* Multiple organizations where required by the platform model
* Multiple branches per organization
* HQ and branch operations
* Branch-localized websites
* Customers
* Services and pricing
* Bookings
* Employees and cleaners
* Scheduling and job execution
* Payments and invoices
* Notifications
* Reviews and quality management
* Auditability
* Future expansion to many branches and countries

The database must remain practical and understandable. CLENQO should use a **modular relational model**, not an unnecessarily fragmented or microservice-oriented schema.

---

# 2. Core Database Principles

## 2.1 PostgreSQL is the source of truth

Business-critical data must ultimately be stored in PostgreSQL.

The application must not rely on browser state, local storage, or third-party services as the authoritative source for:

* bookings
* customers
* branches
* employees
* pricing
* payments
* invoices
* assignments
* job status
* permissions

---

## 2.2 Multi-branch from day one

Branch ownership must be represented explicitly.

The platform must never assume that there is only one branch.

Most operational records should be traceable to a branch through a direct or controlled relationship.

Examples:

```text
Organization
    └── Branch
          ├── Website
          ├── Services
          ├── Pricing
          ├── Customers
          ├── Bookings
          ├── Employees
          └── Jobs
```

---

## 2.3 Organization is the top-level business boundary

The primary business hierarchy is:

```text
Organization
    └── Branches
```

An organization represents the CLENQO business entity operating the branches.

A branch represents an operational location/business unit.

This allows the platform to support:

* one organization with one branch
* one organization with many branches
* future country expansion
* future franchise or partner structures

---

## 2.4 Branch data isolation

Branch-scoped records must contain a `branch_id` directly whenever practical.

For example:

```text
bookings.branch_id
employees.branch_id
services.branch_id
pricing_profiles.branch_id
reviews.branch_id
invoices.branch_id
```

This makes:

* RLS easier
* reporting easier
* queries clearer
* accidental cross-branch access less likely

When a record belongs to a branch indirectly, the relationship must still be deterministic.

---

# 3. ID Strategy

All primary keys should use UUIDs.

Recommended PostgreSQL type:

```sql
uuid
```

IDs should be generated server-side.

Preferred generation:

```sql
gen_random_uuid()
```

The application must not generate sequential business IDs for primary keys.

Business-facing identifiers may exist separately.

Example:

```text
id:
550e8400-e29b-41d4-a716-446655440000

booking_number:
CLN-2026-000123
```

Primary keys are internal identifiers.

Business numbers are human-readable identifiers.

---

# 4. Timestamp Strategy

All database timestamps should use:

```sql
timestamptz
```

Core tables should normally contain:

```text
created_at
updated_at
```

Operational records may additionally contain:

```text
started_at
completed_at
cancelled_at
published_at
archived_at
```

All timestamps are stored in UTC.

The application converts timestamps to the relevant branch/customer timezone for display.

---

# 5. Core Identity Model

## 5.1 Supabase Auth

Supabase Auth owns authentication credentials.

The application database must not duplicate passwords.

Supabase Auth provides the authenticated identity.

The application database stores business identity and authorization information.

Conceptually:

```text
auth.users
    │
    ▼
profiles
    │
    ▼
memberships
    │
    ▼
organization / branch
```

---

# 6. `profiles`

Represents a platform user's application profile.

Suggested fields:

```text
id
first_name
last_name
display_name
phone
avatar_path
locale
timezone
status
created_at
updated_at
```

`id` corresponds to the Supabase Auth user ID.

A profile should exist for every authenticated internal platform user.

Customers do not need traditional accounts in the initial customer experience.

---

# 7. `memberships`

Represents a user's relationship with an organization.

Suggested fields:

```text
id
organization_id
user_id
role
status
created_at
updated_at
```

A user may have more than one membership where explicitly supported.

Examples:

```text
HQ Admin
HQ Staff
Branch Manager
Cleaner
```

---

# 8. Role Model

Initial roles:

```text
hq_admin
hq_staff
branch_manager
cleaner
```

Customers are not represented as internal organization members.

Roles define broad capabilities.

Branch scope determines where those capabilities apply.

For example:

```text
Branch Manager
    → branch A only
```

while:

```text
HQ Admin
    → all branches
```

Authorization must never rely only on frontend role checks.

---

# 9. `membership_branches`

Where a membership can operate on one or more specific branches, branch scope should be represented explicitly.

Suggested fields:

```text
id
membership_id
branch_id
created_at
```

This supports:

* manager assigned to one branch
* manager assigned to multiple branches
* staff assigned to selected branches
* future regional management

HQ roles may have global organization scope and therefore may not require branch rows.

---

# 10. Organization Model

## 10.1 `organizations`

Suggested fields:

```text
id
name
legal_name
slug
status
default_locale
default_timezone
country_code
created_at
updated_at
```

Possible status values:

```text
active
inactive
suspended
archived
```

The organization slug should be unique.

---

# 11. Branch Model

## 11.1 `branches`

Suggested fields:

```text
id
organization_id
name
slug
status
country_code
timezone
currency
locale
address_line_1
address_line_2
postal_code
city
state_region
phone
email
website_status
service_area
created_at
updated_at
activated_at
archived_at
```

A branch belongs to exactly one organization.

Branch slug must be unique within the organization.

Example:

```text
organization:
CLENQO

branch:
Berlin

slug:
berlin
```

Public route:

```text
clenqo.com/berlin
```

The actual domain should be configurable and must not be hardcoded.

---

# 12. Branch Provisioning

Branch creation is an important transactional workflow.

Creating a branch should create its required foundational records.

Conceptually:

```text
Create Branch
     │
     ├── Branch record
     ├── Website configuration
     ├── Website localization records
     ├── Default website navigation
     ├── Default website sections
     ├── Default service configuration
     ├── Default pricing configuration
     └── Audit event
```

Provisioning must be:

* transactional
* deterministic
* idempotent
* auditable

If provisioning fails, the transaction should roll back unless a specific workflow intentionally supports partial provisioning.

The provisioning system must never silently create duplicate configuration records.

---

# 13. Website Database Model

## 13.1 `branch_websites`

Represents the website configuration for a branch.

Suggested fields:

```text
id
branch_id
template_key
status
default_locale
seo_title
seo_description
logo_path
favicon_path
created_at
updated_at
```

One active primary website configuration should exist for each operational branch.

---

## 13.2 `website_locales`

Represents enabled languages for a branch website.

Suggested fields:

```text
id
website_id
locale
is_default
is_enabled
created_at
updated_at
```

Initial supported locales:

```text
de
en
fr
es
```

The schema must not assume these are the only possible languages.

---

## 13.3 `website_pages`

Suggested fields:

```text
id
website_id
slug
page_type
status
sort_order
created_at
updated_at
published_at
```

---

## 13.4 `website_page_translations`

Suggested fields:

```text
id
page_id
locale
title
meta_title
meta_description
content
created_at
updated_at
```

Unique constraint:

```text
(page_id, locale)
```

---

## 13.5 `website_sections`

Represents structured website sections.

Suggested fields:

```text
id
page_id
section_type
section_key
sort_order
is_enabled
content
created_at
updated_at
```

`content` may use PostgreSQL `jsonb` for flexible section-specific configuration.

The JSON structure must still be validated by application-level Zod schemas.

The database should not become an unstructured JSON-only content system.

---

# 14. Media Model

Media metadata may be stored in PostgreSQL while actual files are stored in Supabase Storage.

## 14.1 `media_assets`

Suggested fields:

```text
id
organization_id
branch_id
storage_bucket
storage_path
file_name
mime_type
file_size
width
height
alt_text
status
created_at
updated_at
```

Actual binary files belong in Supabase Storage.

Database records provide:

* ownership
* metadata
* references
* lifecycle
* permissions

---

# 15. Services Model

## 15.1 `services`

Represents services available on the platform.

Scope model (clarified per audit MEDIUM-3): for the MVP, services are
per-branch rows (`services.branch_id` is the branch the service belongs to,
nullable only for organization-wide platform defaults). A global catalog
with a separate branch-availability join table is a future evolution and
must not be assumed by initial migrations.

Suggested fields:

```text
id
organization_id
branch_id
name
slug
service_type
description
status
sort_order
created_at
updated_at
```

A service may be:

```text
home_cleaning
commercial_cleaning
deep_cleaning
move_in_out
```

The model must allow future service types.

---

## 15.2 `service_translations`

Suggested fields:

```text
id
service_id
locale
name
description
created_at
updated_at
```

Unique:

```text
(service_id, locale)
```

---

## 15.3 `service_variants`

Represents variations of a service.

Examples:

```text
Regular Cleaning
Deep Cleaning
Recurring Cleaning
Eco Cleaning
Office Cleaning
Move-Out Cleaning
```

Suggested fields:

```text
id
service_id
name
slug
description
status
sort_order
created_at
updated_at
```

---

## 15.4 `service_addons`

Represents optional extras.

Examples:

```text
Inside refrigerator
Inside oven
Window cleaning
Laundry
Extra bathroom
Pet hair treatment
```

Suggested fields:

```text
id
branch_id
name
slug
description
pricing_type
default_price
status
created_at
updated_at
```

Branch-level ownership allows different branches to enable different add-ons.

---

# 16. Pricing Model

Pricing is a business-critical domain.

Pricing logic must not be scattered across UI components.

## 16.1 `pricing_profiles`

Represents a pricing configuration.

Suggested fields:

```text
id
branch_id
name
status
currency
version
effective_from
effective_until
created_at
updated_at
```

A pricing profile represents a coherent version of pricing rules.

---

## 16.2 `pricing_rules`

Suggested fields:

```text
id
pricing_profile_id
rule_type
service_id
service_variant_id
property_type
min_value
max_value
multiplier
fixed_amount
configuration
created_at
updated_at
```

`configuration` may use `jsonb` for rule-specific parameters.

---

## 16.3 Pricing versioning

Pricing must be reproducible.

A booking must retain enough information to explain how its price was calculated at booking time.

The system must never recalculate an old booking using today's pricing rules.

Therefore booking pricing should store (audit fix CRITICAL-2 — canonical representation):

```text
pricing_profile_id
pricing_version_id
pricing_snapshot (jsonb)
```

`pricing_version_id` references the published pricing version that produced
the price (see PRICING_ENGINE versioning; a `pricing_versions` table backs
this reference).

`pricing_snapshot` is a single jsonb container that embeds the complete
calculation context so the booking remains explainable on its own:

```text
pricing_snapshot
├── pricing_profile_id
├── pricing_version_id
├── pricing_version_number   (human-readable, e.g. "4")
├── inputs                   (duration, difficulty, property factors, add-ons, date/time context)
├── rules_applied            (rates, multipliers, surcharge/discount/tax configuration used)
└── result                   (base, addons, surcharges, discounts, tax, subtotal, total, currency)
```

The snapshot must contain enough information to answer
"why did this booking cost this amount?" without joining live pricing tables.
PRICING_ENGINE's `pricing_inputs_snapshot` and `pricing_result_snapshot`
concepts are the `inputs` and `result` members of this single container —
they are not separate columns.

---

# 17. Customers

## 17.1 `customers`

Customers do not require traditional user accounts.

Suggested fields:

```text
id
organization_id
primary_branch_id
first_name
last_name
email
phone
status
notes
created_at
updated_at
```

A customer may interact with multiple branches in the future.

Therefore `primary_branch_id` must not be treated as permanent ownership.

---

## 17.2 `customer_addresses`

Suggested fields:

```text
id
customer_id
label
address_line_1
address_line_2
postal_code
city
state_region
country_code
latitude
longitude
created_at
updated_at
```

Location information should be used only where necessary for service operations.

---

# 18. Bookings

## 18.1 `bookings`

This is one of the most important operational tables.

Suggested fields:

```text
id
organization_id
branch_id
customer_id
booking_number
status
booking_type
scheduled_start
scheduled_end
timezone
service_address_id
subtotal
discount_total
surcharge_total
tax_total
total
currency
pricing_profile_id
pricing_version_id
pricing_snapshot
customer_notes
internal_notes
source
created_at
updated_at
confirmed_at
cancelled_at
completed_at
```

---

# 19. Booking Status

Initial lifecycle:

```text
draft
pending
confirmed
assigned
in_progress
completed
cancelled
no_show
```

The application should enforce valid transitions.

Example:

```text
pending
   ↓
confirmed
   ↓
assigned
   ↓
in_progress
   ↓
completed
```

Cancellation must follow defined business rules.

---

# 20. `booking_items`

Represents services and add-ons included in a booking.

Suggested fields:

```text
id
booking_id
item_type
service_id
service_variant_id
addon_id
description
quantity
unit_price
total_price
metadata
created_at
```

A booking can therefore contain:

```text
Deep Cleaning
+ Oven Cleaning
+ Refrigerator Cleaning
```

---

# 21. Booking Events

## 21.1 `booking_events`

Provides a history of important booking state changes.

Suggested fields:

```text
id
booking_id
event_type
old_status
new_status
actor_user_id
metadata
created_at
```

Examples:

```text
booking_created
booking_confirmed
booking_assigned
booking_started
booking_completed
booking_cancelled
payment_received
```

This is different from the audit log.

Booking events represent business lifecycle events.

Audit logs represent security and administrative activity.

---

# 22. Recurring Bookings

Recurring services should not require copying the same booking manually.

A future recurring booking model may use:

```text
recurring_booking_plans
```

with:

```text
id
customer_id
branch_id
service_id
frequency
start_date
end_date
status
configuration
created_at
updated_at
```

Generated bookings remain normal records in `bookings`.

The recurring plan is the schedule definition.

The generated booking is the actual operational job.

---

# 23. Employees and Cleaners

## 23.1 `employees`

Represents people working for the organization.

Suggested fields:

```text
id
organization_id
branch_id
user_id
employee_number
employment_type
status
hire_date
termination_date
created_at
updated_at
```

Employment types may include:

```text
full_time
part_time
minijob
flexible
on_call
```

The schema must remain extensible.

---

# 24. Employee Skills

## 24.1 `employee_skills`

Suggested fields:

```text
id
employee_id
skill_key
level
created_at
```

Examples:

```text
deep_cleaning
commercial_cleaning
move_out_cleaning
window_cleaning
```

This can later support intelligent assignment.

---

# 25. Employee Availability

## 25.1 `employee_availability`

Suggested fields:

```text
id
employee_id
day_of_week
start_time
end_time
status
effective_from
effective_until
created_at
updated_at
```

---

## 25.2 Availability Exceptions

A separate exception model may be used for:

* holidays
* vacation
* sickness
* unavailable dates
* special working days

Example table:

```text
employee_availability_exceptions
```

The scheduling engine must consider both recurring availability and exceptions.

---

# 26. Jobs

A booking represents the customer's commercial transaction.

A job represents the operational work.

## 26.1 `jobs`

Suggested fields:

```text
id
booking_id
branch_id
status
scheduled_start
scheduled_end
actual_start
actual_end
instructions
checklist
completion_notes
created_at
updated_at
```

Initially, a booking may produce one job.

The model should still allow future bookings to generate multiple jobs.

---

# 27. Job Assignments

## 27.1 `job_assignments`

Suggested fields:

```text
id
job_id
employee_id
assignment_status
assigned_at
accepted_at
declined_at
created_at
updated_at
```

This allows:

* manual assignment
* automatic assignment
* reassignment
* multiple cleaners per job

---

# 28. Job Execution

Operational execution data may include:

```text
check_in_at
check_out_at
check_in_location
check_out_location
completion_notes
```

Photos and documents should be represented through media records rather than embedding binary data in PostgreSQL.

---

# 29. Job Incidents

## 29.1 `incidents`

Suggested fields:

```text
id
organization_id
branch_id
job_id
booking_id
reported_by
incident_type
severity
description
status
resolution
created_at
resolved_at
```

Examples:

```text
property_damage
access_problem
customer_issue
cleaner_issue
safety_issue
late_arrival
no_show
```

---

# 30. Payments

## 30.1 `payments`

Suggested fields:

```text
id
organization_id
branch_id
booking_id
customer_id
provider
provider_payment_id
status
amount
currency
payment_method
created_at
updated_at
paid_at
```

Payment provider information must be isolated behind application-level payment adapters.

The database should not depend on one payment provider forever.

---

# 31. Refunds

## 31.1 `refunds`

Suggested fields:

```text
id
payment_id
provider_refund_id
amount
reason
status
created_at
completed_at
```

Refunds must never overwrite the original payment amount.

---

# 32. Invoices

## 32.1 `invoices`

Suggested fields:

```text
id
organization_id
branch_id
customer_id
booking_id
invoice_number
status
issue_date
due_date
subtotal
tax_total
total
currency
pdf_path
created_at
updated_at
paid_at
```

Invoice numbers should be human-readable and unique within the appropriate organization/legal scope.

---

# 33. Notifications

Notifications should use an event-driven model.

## 33.1 `notification_events`

Represents an event that may trigger one or more notifications.

Suggested fields:

```text
id
organization_id
branch_id
event_type
entity_type
entity_id
payload
status
created_at
processed_at
```

Examples:

```text
booking_created
booking_confirmed
booking_cancelled
job_assigned
job_reminder
invoice_created
payment_received
```

---

# 34. Notification Templates

## 34.1 `notification_templates`

Suggested fields:

```text
id
organization_id
branch_id
event_type
channel
locale
subject
content
status
version
created_at
updated_at
```

Channels initially include:

```text
email
```

Future channels:

```text
whatsapp
sms
push
```

---

# 35. Notification Deliveries

## 35.1 `notification_deliveries`

Represents an actual delivery attempt.

Suggested fields:

```text
id
notification_event_id
channel
recipient
status
provider
provider_message_id
attempt_count
last_error
sent_at
delivered_at
created_at
updated_at
```

This allows retryable notification processing.

---

# 36. Reviews

## 36.1 `reviews`

Suggested fields:

```text
id
organization_id
branch_id
booking_id
customer_id
rating
title
comment
status
created_at
updated_at
published_at
```

Rating should be constrained to an appropriate range, for example:

```text
1–5
```

---

# 37. Quality Management

Quality-related records should remain connected to the actual booking/job.

Possible future tables:

```text
quality_checks
quality_check_items
quality_issues
```

The initial system can keep quality data simple and expand it when operational requirements become clearer.

---

# 38. Audit Logs

## 38.1 `audit_logs`

Audit logs record significant administrative/security actions.

Suggested fields:

```text
id
organization_id
branch_id
actor_user_id
action
entity_type
entity_id
old_data
new_data
metadata
ip_address
user_agent
created_at
```

Examples:

```text
branch_created
branch_updated
employee_created
booking_cancelled
pricing_changed
user_role_changed
invoice_voided
```

Audit logs should be append-only.

Normal application users must not be able to modify historical audit records.

---

# 39. RLS Strategy

Row Level Security is mandatory for sensitive application data.

RLS must provide defense in depth.

The application should not assume that frontend routing is sufficient for branch isolation.

Conceptually:

```text
HQ Admin
    → organization-wide access

HQ Staff
    → permissions-defined access

Branch Manager
    → assigned branch access

Cleaner
    → assigned jobs / permitted operational records

Customer
    → only explicitly authorized customer resources
```

---

# 40. Branch Access Rules

For branch-scoped tables:

```text
organization_id
branch_id
```

should be used to determine access where possible.

RLS policies should use authenticated identity and membership relationships.

Do not rely on:

```text
?branch=berlin
```

or:

```text
localStorage.branchId
```

as security mechanisms.

Those are presentation/state mechanisms only.

---

# 41. Customer Magic Links

Customers do not need passwords in the initial booking experience.

Customer booking management should use secure tokens.

Tokens should:

* be cryptographically random
* have an expiration
* have limited scope
* be revocable where required
* never expose internal database IDs unnecessarily

Sensitive token values should not be stored in plaintext when avoidable.

The magic-link system must not allow access to another customer's bookings.

---

# 42. Constraints

Database constraints should enforce business invariants whenever practical.

Examples:

```text
organizations.slug UNIQUE
branches (organization_id, slug) UNIQUE
website_locales (website_id, locale) UNIQUE
service_translations (service_id, locale) UNIQUE
website_page_translations (page_id, locale) UNIQUE
booking_number UNIQUE within defined scope
invoice_number UNIQUE within defined scope
```

Foreign keys must be used for relational integrity.

Do not rely entirely on application code to prevent orphaned records.

---

# 43. Indexing Strategy

Indexes should support actual application queries.

Important initial indexes include:

```text
branches.organization_id
branches.status

memberships.user_id
memberships.organization_id

membership_branches.membership_id
membership_branches.branch_id

services.branch_id
services.status

pricing_profiles.branch_id
pricing_profiles.status

customers.organization_id
customers.primary_branch_id
customers.email

bookings.branch_id
bookings.customer_id
bookings.status
bookings.scheduled_start
bookings.booking_number

booking_items.booking_id

booking_events.booking_id
booking_events.created_at

employees.branch_id
employees.user_id
employees.status

jobs.branch_id
jobs.booking_id
jobs.status
jobs.scheduled_start

job_assignments.job_id
job_assignments.employee_id

payments.booking_id
payments.status

invoices.branch_id
invoices.customer_id
invoices.status

notification_events.status
notification_events.created_at

notification_deliveries.notification_event_id
notification_deliveries.status

reviews.branch_id
reviews.booking_id

audit_logs.organization_id
audit_logs.branch_id
audit_logs.actor_user_id
audit_logs.created_at
```

Indexes should be added based on measured query patterns as the platform grows.

Do not index every column automatically.

---

# 44. Soft Deletion

Soft deletion should be used selectively.

Do not automatically add:

```text
deleted_at
```

to every table.

Use explicit status/archive fields where historical records must remain available.

Examples:

```text
branches.status = archived
services.status = archived
employees.status = terminated
```

Financial and operational history should generally remain immutable.

Bookings, payments, invoices, and audit records should not normally be physically deleted.

---

# 45. Data Lifecycle

Different data categories have different lifecycle requirements.

### Configuration

May be:

```text
created
updated
disabled
archived
```

### Operational records

Should generally remain for historical reporting.

### Financial records

Must remain traceable and should not be destructively deleted.

### Audit records

Append-only.

### Temporary records

May have explicit expiration and cleanup mechanisms.

Data retention requirements should be implemented deliberately rather than through uncontrolled deletion.

---

# 46. JSONB Usage

PostgreSQL `jsonb` is permitted for flexible configuration and snapshots.

Good use cases:

```text
website section configuration
pricing rule configuration
booking pricing snapshot
notification payload
integration metadata
```

Bad use cases:

```text
customer name
booking status
branch ID
payment amount
service ID
employee ID
```

Frequently queried relational data must remain structured columns.

JSONB should provide flexibility, not replace relational modeling.

---

# 47. Transactions

Business-critical operations should use database transactions.

Examples:

### Branch creation

```text
Create branch
+ create website
+ create locales
+ create default configuration
+ create audit record
```

must be atomic.

### Booking creation

```text
Create booking
+ create booking items
+ reserve/validate required resources
+ create booking event
```

must preserve consistency.

### Payment confirmation

```text
Validate provider event
+ update payment
+ update booking/payment state
+ create event
```

must be idempotent and transactional.

---

# 48. Idempotency

External requests and webhooks must support idempotency.

Important examples:

```text
payment webhooks
notification delivery
branch provisioning
booking confirmation
invoice generation
```

Provider event IDs should be stored where applicable.

Duplicate webhook delivery must not:

* charge the customer twice
* create duplicate invoices
* create duplicate bookings
* send uncontrolled duplicate notifications

---

# 49. Concurrency

The system must protect against concurrent operations.

Examples:

Two admins must not accidentally:

```text
assign the same exclusive worker slot
```

Two booking requests must not both consume the same unavailable resource where availability is constrained.

Payment webhooks must not race into inconsistent states.

Database transactions, unique constraints, locks, or other appropriate PostgreSQL mechanisms should be used where necessary.

---

# 50. Booking Pricing Snapshot

When a booking is confirmed, its commercial price must become reproducible.

The booking should preserve:

```text
service
variant
property factors
duration
difficulty
add-ons
discounts
surcharges
taxes
pricing profile
pricing version
final amount
currency
```

Historical bookings must remain understandable even after pricing rules change.

---

# 51. Branch Website Provisioning Representation

A newly created branch should result in a database state similar to:

```text
organizations
    │
    └── branches
          │
          ├── branch_websites
          │       │
          │       ├── website_locales
          │       ├── website_pages
          │       │       └── website_page_translations
          │       └── website_sections
          │
          ├── services
          ├── service_variants
          ├── service_addons
          └── pricing_profiles
```

The branch website does not receive a separate database.

It uses the centralized database with branch-scoped configuration.

---

# 52. Database and Public Website Routing

A public request such as:

```text
clenqo.com/berlin
```

should resolve approximately as:

```text
URL
 ↓
branch slug
 ↓
branches
 ↓
branch website
 ↓
localized content
 ↓
services/pricing
 ↓
rendered website
```

The route itself is not the tenant boundary.

The database relationship is.

---

# 53. Storage Architecture

Supabase Storage should contain files such as:

```text
branch logos
website images
service images
customer booking attachments
job photos
invoice PDFs
employee documents
```

Storage paths should be organized by ownership.

Conceptual structure:

```text
organization/{organization_id}/
    branches/{branch_id}/
        website/
        services/
        jobs/
        invoices/
```

Storage policies must align with database authorization.

A user must not gain access to a private file simply because they know its path.

---

# 54. Migrations

All schema changes must be version-controlled.

Migrations should be:

* sequential
* deterministic
* reviewable
* reproducible
* safe to run against clean environments

Example:

```text
supabase/
    migrations/
        001_initial_schema.sql
        002_identity.sql
        003_organizations_branches.sql
        004_website.sql
        005_services_pricing.sql
```

Actual migration grouping may evolve as implementation progresses.

Never manually modify production schema without a corresponding migration.

---

# 55. Seeds

Seed data should be separated from production business data.

Seeds may create:

* initial organization
* development branches
* default roles
* default website templates
* supported locales
* development service catalog
* test pricing profiles

Production seeds must not contain fake customer/payment data unless intentionally created for testing.

---

# 56. Database Functions and RPC

Supabase/PostgreSQL functions may be used for operations where database-level atomicity is valuable.

Good candidates include:

```text
branch provisioning
secure authorization helpers
atomic booking state transitions
sequence/business-number generation
```

Business logic should not automatically be moved into SQL.

Use database functions when they provide a clear benefit in:

* atomicity
* consistency
* security
* performance

Complex domain workflows should remain understandable from the application layer.

---

# 57. Authorization Helper Functions

Reusable PostgreSQL helper functions may be created for checks such as:

```text
is_hq_admin(user_id)
has_branch_access(user_id, branch_id)
has_organization_access(user_id, organization_id)
```

These helpers can simplify RLS policies.

They must be carefully designed to avoid:

* recursive RLS problems
* privilege escalation
* accidental unrestricted access

---

# 58. Business Number Generation

Human-readable numbers should be generated independently of UUIDs.

Examples:

```text
Booking:
CLN-000001

Invoice:
INV-000001

Employee:
EMP-000001
```

The final numbering format may depend on legal/accounting requirements.

Numbers must be unique within their defined scope.

Concurrency-safe generation is required.

---

# 59. Internationalization

Locale should never be used as a hardcoded database assumption.

Initial locales:

```text
de
en
fr
es
```

Future examples:

```text
it
nl
pt
```

Localized content should be represented through translation records or structured localized content.

Branch-level defaults should determine the initial language.

---

# 60. Currency and Country

Currency must be stored explicitly for financial records.

Never infer historical currency from the current branch configuration.

For example:

```text
bookings.currency
payments.currency
invoices.currency
pricing_profiles.currency
```

Historical financial records must retain their original currency.

Country should use standardized country codes where possible.

Example:

```text
DE
CM
```

---

# 61. Tax Data

Tax information should be stored explicitly when applicable.

Financial records should not depend on a future tax configuration to reconstruct historical totals.

At minimum, financial calculations should preserve:

```text
subtotal
tax amount
total
currency
```

Detailed tax modeling can be expanded when the legal/accounting requirements are finalized.

---

# 62. Referential Integrity

Foreign keys should be used throughout the relational model.

Examples:

```text
branches.organization_id
services.branch_id
bookings.customer_id
bookings.branch_id
booking_items.booking_id
jobs.booking_id
job_assignments.job_id
payments.booking_id
invoices.booking_id
```

Delete behavior must be chosen deliberately.

For historical records, prefer:

```text
RESTRICT
```

or controlled archival over destructive cascading deletion.

---

# 63. Domain Boundaries

The database is organized conceptually into domains:

```text
Identity
Organization
Branch
Website
Media
Services
Pricing
Customers
Bookings
Scheduling
Jobs
Payments
Invoices
Notifications
Quality
Audit
```

These are logical domains within one PostgreSQL database.

They are not separate databases or microservices.

---

# 64. Initial Table Set

The initial production schema is expected to evolve, but the foundation should cover approximately:

### Identity

```text
profiles
memberships
membership_branches
```

### Organization

```text
organizations
branches
```

### Website

```text
branch_websites
website_locales
website_pages
website_page_translations
website_sections
media_assets
```

### Services

```text
services
service_translations
service_variants
service_addons
```

### Pricing

```text
pricing_profiles
pricing_versions
pricing_rules
```

### Customers

```text
customers
customer_addresses
```

### Bookings

```text
bookings
booking_items
booking_events
recurring_booking_plans
```

### Workforce

```text
employees
employee_skills
employee_availability
employee_availability_exceptions
jobs
job_assignments
incidents
```

### Financial

```text
payments
refunds
invoices
```

### Communication

```text
notification_events
notification_templates
notification_deliveries
```

### Quality

```text
reviews
quality_checks
quality_check_items
quality_issues
```

### Governance

```text
audit_logs
```

Not every table must be implemented in the first migration.

The schema should be introduced in logical increments.

---

# 65. MVP Database Priority

The first database implementation should prioritize:

```text
organizations
branches
profiles
memberships
membership_branches

branch_websites
website_locales
website_pages
website_page_translations
website_sections

services
service_variants
service_addons
pricing_profiles
pricing_rules

customers
customer_addresses

bookings
booking_items
booking_events

employees
jobs
job_assignments

audit_logs
```

Payments, invoices, notifications, reviews, advanced workforce scheduling, and advanced quality systems can follow after the operational foundation is stable.

---

# 66. Database Security Rules

The database must follow these principles:

1. RLS is enabled for sensitive application tables.
2. Service-role credentials never reach the browser.
3. Customers cannot access arbitrary records.
4. Branch users cannot automatically access other branches.
5. HQ permissions are explicitly defined.
6. Storage policies match database ownership.
7. Financial records are protected.
8. Audit logs are append-only.
9. Secrets are never stored in ordinary application tables unless explicitly required and securely handled.
10. Database functions must not accidentally bypass authorization.

---

# 67. Data Access Rules

Frontend components should not contain arbitrary database logic.

Preferred flow:

```text
UI
 ↓
Server Action / Route Handler
 ↓
Domain Service
 ↓
Data Access Layer
 ↓
Supabase/PostgreSQL
```

For reads where appropriate:

```text
UI
 ↓
Server Component / API
 ↓
Data Access Layer
 ↓
PostgreSQL
```

Business rules must remain outside presentation components.

---

# 68. Database Testing

Database tests should verify:

### Structure

* tables exist
* foreign keys exist
* unique constraints work
* required fields reject invalid data

### Authorization

* HQ users access permitted organization data
* branch managers access assigned branches
* cleaners access permitted jobs
* cross-branch access is denied

### Business integrity

* duplicate bookings are prevented where required
* invalid state transitions are rejected
* pricing snapshots are preserved
* payment webhooks are idempotent
* provisioning is idempotent

### Migration integrity

A clean database must be buildable from migrations alone.

---

# 69. Observability

Important database operations should produce enough information for troubleshooting.

Track:

```text
created_at
updated_at
status
actor
event
provider identifiers
failure reason
```

Do not store sensitive secrets merely for debugging.

Application logs should use safe identifiers and correlation IDs where useful.

---

# 70. Performance Principles

Initial priority:

```text
correctness
security
maintainability
```

Then optimize measured bottlenecks.

Avoid premature:

* sharding
* database replication complexity
* distributed transactions
* event-sourcing everything
* separate databases per branch
* microservices
* excessive caching

PostgreSQL should comfortably support the initial CLENQO platform.

The architecture should remain capable of scaling as branch count increases.

---

# 71. Future Scaling

If CLENQO grows from:

```text
1 branch
→ 5
→ 20
→ 100+
```

the database remains centralized initially.

Scaling strategies may later include:

* stronger indexing
* query optimization
* caching
* background workers
* read replicas
* partitioning for very large event/audit tables
* archival
* specialized analytics storage

These are future optimization decisions, not MVP requirements.

---

# 72. Source-of-Truth Rule

The database must not become disconnected from the documentation.

When the schema changes:

```text
Business decision
      ↓
Documentation
      ↓
OpenSpec change
      ↓
Migration
      ↓
Application implementation
      ↓
Tests
      ↓
Verification
```

Database schema changes must have a clear reason.

Do not add tables simply because a feature might exist someday.

---

# 73. Current Database Milestone

The first database milestone is complete when CLENQO can represent:

```text
Organization
      ↓
Branch
      ↓
Branch website
      ↓
Branch configuration
      ↓
Services
      ↓
Pricing
      ↓
Customer
      ↓
Booking
      ↓
Operational job
      ↓
Cleaner assignment
```

with:

* correct relationships
* branch isolation
* RLS foundations
* migrations
* auditability
* deterministic branch provisioning

This becomes the foundation for all subsequent CLENQO development.

---

# 74. Golden Database Rule

The CLENQO database must remain:

> **Relational where relationships matter, flexible where configuration changes, secure by default, branch-aware from day one, auditable for important operations, and simple enough for the team to understand and maintain.**
