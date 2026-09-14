# CLENQO Pricing Engine

## 1. Purpose

The CLENQO Pricing Engine is the authoritative system for calculating cleaning prices.

It converts structured booking inputs into a deterministic price.

```text
Booking Inputs
      ↓
Pricing Profile
      ↓
Pricing Rules
      ↓
Duration Calculation
      ↓
Difficulty
      ↓
Add-ons
      ↓
Surcharges
      ↓
Discounts
      ↓
Taxes
      ↓
Final Price
```

The pricing engine must be:

* deterministic
* server-side
* versioned
* branch-aware
* auditable
* reproducible
* configurable
* testable
* extensible

---

# 2. Core Pricing Principle

> **The frontend may display a price, but only the server-side pricing engine can determine the authoritative price.**

No business-critical pricing calculation may live exclusively in:

* React components
* client-side JavaScript
* CMS content
* URL parameters
* browser state

---

# 3. Pricing Inputs

Pricing may depend on:

```text
branch
service
service_variant
property_type
property_size
rooms
bathrooms
floors
occupancy
condition
difficulty
duration
add_ons
date
time
day_of_week
holiday
emergency
customer_type
booking_type
discounts
tax_configuration
```

Not every service uses every input.

---

# 4. Branch Scope

Pricing configuration belongs to a branch or an explicitly shared organization-level pricing configuration.

A branch must never accidentally use another branch's pricing.

Conceptually:

```text
Organization
   ↓
Branch
   ↓
Pricing Profile
   ↓
Pricing Rules
```

---

# 5. Pricing Profiles

A pricing profile represents a coherent set of pricing rules.

Examples:

```text
Standard Residential
Commercial
Deep Cleaning
Move-Out
Contract Customer
Recurring Customer
```

A branch may have multiple profiles.

The booking determines which profile applies.

---

# 6. Pricing Profile Versioning

Pricing profiles must be versioned.

Conceptually:

```text
Standard Residential
├── Version 1
├── Version 2
└── Version 3
```

A published booking must retain the pricing version used for its calculation.

Future pricing changes must not silently change historical bookings.

---

# 7. Effective Dates

Pricing versions may have:

```text
effective_from
effective_until
```

This allows future pricing to be prepared before activation.

Example:

```text
Current Version
effective_until = 2026-12-31

New Version
effective_from = 2027-01-01
```

---

# 8. Pricing Status

Pricing versions may use:

```text
draft
published
archived
```

Only published versions may be used for normal customer bookings.

---

# 9. Base Pricing Model

The initial conceptual pricing model is:

```text
Base Price =
Duration × Hourly Rate × Difficulty Multiplier
```

Then:

```text
Final Price =
Base Price
+ Add-ons
+ Surcharges
- Discounts
+ Tax
```

This is a conceptual model.

The implementation must support more sophisticated rules without breaking the basic model.

---

# 10. Hourly Rates

Initial business planning ranges include:

```text
Standard Cleaning:      €25–€30/hour
Deep Cleaning:          €35–€45/hour
Move-Out Cleaning:      €40–€55/hour
Commercial Cleaning:    €30–€40/hour
```

These are not application constants.

They must be configurable through pricing profiles.

---

# 11. Difficulty

Initial difficulty levels:

```text
Light
Medium
Heavy
```

Conceptual multipliers:

```text
Light:   ×1.0
Medium:  ×1.2
Heavy:   ×1.5–2.0
```

The actual multiplier must come from configuration.

---

# 12. Difficulty Assessment

Difficulty may be derived from factors such as:

```text
property condition
occupancy
pet presence
long period since cleaning
excessive dirt
special cleaning requirements
```

The engine should support both:

```text
explicit difficulty
```

and:

```text
calculated difficulty
```

when the business model requires it.

---

# 13. Duration Calculation

Duration should be derived from service-specific rules.

Possible inputs:

```text
property size
rooms
bathrooms
property type
condition
service variant
add-ons
difficulty
```

Example:

```text
Base Duration
+ Additional Room Time
+ Additional Bathroom Time
+ Condition Adjustment
+ Add-on Duration
```

---

# 14. Duration Precision

Duration should use a consistent internal unit.

Recommended:

```text
minutes
```

Example:

```text
180 minutes = 3 hours
```

This avoids floating-point ambiguity during scheduling.

---

# 15. Rounding

The pricing engine must define explicit rounding rules.

For example:

```text
duration → minute precision
money → currency minor unit
```

Monetary calculations must never depend on unsafe floating-point arithmetic.

Use appropriate decimal/numeric handling.

---

# 16. Minimum Charge

A pricing profile may define a minimum charge.

Example:

```text
minimum_price = €75
```

If the calculated price is below the minimum:

```text
final_before_tax = minimum_price
```

The minimum must be recorded in the calculation breakdown.

---

# 17. Minimum Duration

A service may also define a minimum billable duration.

Example:

```text
minimum_duration = 120 minutes
```

The engine must distinguish:

```text
actual estimated duration
```

from:

```text
minimum billable duration
```

when both are relevant.

---

# 18. Add-On Pricing

Add-ons may be priced using different methods.

Supported concepts:

```text
fixed
per_unit
per_room
per_hour
percentage
duration_based
```

Example:

```text
Inside Oven
€25 fixed
```

or:

```text
Windows
€10 per window
```

---

# 19. Add-On Eligibility

Each add-on may specify:

```text
available services
available variants
available property types
branch availability
```

The server must reject invalid combinations.

---

# 20. Add-On Duration

Add-ons may affect both:

```text
price
duration
```

Example:

```text
Window Cleaning
+30 minutes
+€20
```

The booking system must use the resulting duration for availability.

---

# 21. Surcharges

Pricing must support configurable surcharges.

Initial examples:

```text
Night
Sunday
Holiday
Emergency
```

Possible models:

```text
percentage
fixed amount
```

---

# 22. Initial Surcharge Concepts

Initial planning values:

```text
Night:       +20%
Sunday:      +25%
Holiday:     +50%
Emergency:   +25%
```

These are configuration values, not hardcoded constants.

---

# 23. Surcharge Stacking

The pricing profile must explicitly define whether surcharges can stack.

Example:

```text
Sunday + Holiday
```

could mean:

```text
+25% +50%
```

or:

```text
highest applicable surcharge only
```

The engine must not make this decision implicitly.

---

# 24. Surcharge Order

Pricing rules must define calculation order.

A typical sequence is:

```text
Base
 ↓
Difficulty
 ↓
Add-ons
 ↓
Surcharges
 ↓
Discounts
 ↓
Tax
```

The exact order must be part of the pricing configuration/model.

---

# 25. Discounts

Discounts may be:

```text
percentage
fixed
promotion
customer-specific
recurring
contract
campaign
```

Discounts must be validated server-side.

---

# 26. Discount Limits

The engine should support:

```text
minimum_order_value
maximum_discount
valid_from
valid_until
usage_limit
customer_limit
service_limit
branch_limit
```

---

# 27. Discount Stacking

Multiple discounts must not automatically stack.

The pricing profile must define:

```text
stackable
non_stackable
priority
```

If multiple discounts compete, the engine must apply deterministic selection rules.

---

# 28. Promotion Codes

Future promotion codes should resolve through the pricing system.

Example:

```text
WELCOME10
```

The frontend sends the code.

The server determines:

```text
valid?
eligible?
discount?
```

---

# 29. Tax

Tax must be calculated explicitly.

The engine should preserve:

```text
tax_rate
tax_amount
tax jurisdiction/configuration
```

Tax configuration should be adaptable to branch/country requirements.

---

# 30. Currency

Each pricing profile has a currency.

Initial launch may use:

```text
EUR
```

but the platform must not hardcode EUR globally.

Future branches may use different currencies.

---

# 31. Currency Precision

Money must be represented using decimal-safe database types.

Avoid JavaScript binary floating-point arithmetic for authoritative money calculations.

---

# 32. Price Breakdown

Every calculation should produce a structured breakdown.

Conceptually:

```json
{
  "base": 100,
  "difficulty": 20,
  "addons": 30,
  "surcharges": 25,
  "discounts": 10,
  "tax": 31.35,
  "total": 196.35
}
```

The exact structure is defined by the implementation contract.

---

# 33. Calculation Result

A pricing calculation should return at least:

```text
currency
duration_minutes
base_amount
addon_amount
surcharge_amount
discount_amount
tax_amount
subtotal
total
pricing_profile_id
pricing_version_id
```

It should also return a structured explanation/breakdown.

---

# 34. Determinism

Given identical:

```text
pricing version
inputs
date/time context
```

the engine must produce the same result.

Example:

```text
Input A
+
Pricing Version 7
=
Price X
```

Running the same calculation again must produce:

```text
Price X
```

---

# 35. Historical Reproducibility

A historical booking must remain explainable even after pricing rules change.

Therefore a confirmed booking stores (audit fix CRITICAL-2 — canonical
representation, see DATABASE §16.3):

```text
pricing_version_id
pricing_snapshot (jsonb)
```

`pricing_snapshot` is a single jsonb container embedding the version
identity, calculation inputs (`pricing_inputs_snapshot`), and calculation
result (`pricing_result_snapshot`) as structured members. The inputs and
result are members of the snapshot, not separate columns.

---

# 36. Price Snapshot

The snapshot should preserve enough information to answer:

> Why did this booking cost this amount?

It should include (as members of the single `pricing_snapshot` jsonb
container defined in §35):

```text
inputs
rules/version
duration
base rate
difficulty
add-ons
surcharges
discounts
tax
currency
total
```

---

# 37. Snapshot Immutability

Once a booking is confirmed, its authoritative price snapshot should not be silently overwritten.

If an authorized user changes the price later, the system must record:

```text
previous price
new price
reason
actor
timestamp
```

---

# 38. Manual Price Override

Authorized staff may require a manual price override.

Examples:

```text
special customer agreement
on-site assessment
commercial contract
exception
service recovery
```

Overrides must require:

```text
authorization
reason
audit record
```

---

# 39. Manual Quote / Assessment

Some jobs may not be safely priced automatically.

Examples:

```text
very large property
unknown condition
specialized cleaning
complex commercial site
```

The system should support an assessment/quote-required path.

Conceptually:

```text
Booking Request
 ↓
Assessment Required
 ↓
Staff Quote
 ↓
Customer Acceptance
 ↓
Confirmed Booking
```

---

# 40. On-Site Assessment

A branch may configure certain services to require an assessment.

The booking system must then avoid presenting an incorrectly authoritative instant price.

Instead it may present:

```text
Price requires assessment
```

or:

```text
Starting from €X
```

depending on configuration.

---

# 41. Call-Out Fee

An assessment may use a configurable call-out fee.

Initial planning value:

```text
€30
```

This must remain branch/configuration data.

---

# 42. Price Display Modes

Services may use:

```text
fixed_price
starting_from
calculated_price
quote_required
```

This allows the public website to represent different business models.

---

# 43. CMS Relationship

The CMS may control how pricing is presented.

For example:

```text
"Starting from €99"
```

But the CMS does not own the authoritative price.

The pricing engine remains the source of truth.

---

# 44. Pricing in the Dashboard

Authorized dashboard users should be able to manage:

* pricing profiles
* pricing versions
* hourly rates
* duration rules
* difficulty multipliers
* add-ons
* surcharges
* discounts
* minimum charges
* taxes
* currency
* effective dates

---

# 45. Pricing Permissions

Pricing configuration requires explicit authorization.

Examples:

```text
pricing.view
pricing.create
pricing.edit
pricing.publish
pricing.archive
pricing.override
```

Publishing should normally require stronger permission than viewing.

---

# 46. Draft Pricing

Administrators should be able to prepare pricing changes without affecting live bookings.

```text
Draft
 ↓
Review
 ↓
Publish
 ↓
Active
```

---

# 47. Publishing Rules

Before publishing, the system should validate:

* required fields
* valid numeric ranges
* overlapping effective periods
* currency
* applicable services
* surcharge rules
* discount rules
* tax configuration
* rule dependencies

Invalid pricing versions must not become active.

---

# 48. Effective Pricing Resolution

For a booking request:

```text
Branch
 ↓
Service
 ↓
Booking Context
 ↓
Find Applicable Pricing Profile
 ↓
Find Active Pricing Version
 ↓
Calculate
```

Resolution must be deterministic.

---

# 49. Booking Date vs Current Date

Pricing should generally be evaluated against the scheduled service date where business rules depend on:

* weekday
* holiday
* effective pricing version
* seasonal pricing

The system must not accidentally use the current date.

---

# 50. Time-Based Pricing

Time may affect pricing.

Examples:

```text
day
night
weekend
holiday
```

The pricing engine must use the branch timezone.

---

# 51. Service-Specific Rules

Different services may use different formulas.

Example:

```text
Home Cleaning
→ duration × hourly rate

Commercial
→ area × rate

Move-Out
→ property factors + difficulty
```

The engine should support multiple rule strategies while maintaining a consistent pricing contract.

---

# 52. Rule Evaluation

Rules must have deterministic precedence.

Possible structure:

```text
Global Defaults
 ↓
Organization Configuration
 ↓
Branch Configuration
 ↓
Service Rules
 ↓
Variant Rules
 ↓
Booking-Specific Rules
```

The exact inheritance model must be explicit.

---

# 53. No Hidden Pricing Rules

Pricing logic must not be hidden in arbitrary application code.

Every business pricing rule should be discoverable through:

* configuration
* documented rule code
* version
* audit trail

---

# 54. Configuration vs Code

Use configuration for values that business administrators may reasonably change.

Examples:

```text
hourly rate
surcharge percentage
minimum price
discount percentage
effective date
```

Use code for stable computational behavior.

Examples:

```text
money arithmetic
rule evaluation
validation
pricing pipeline
```

---

# 55. Pricing Engine API

Conceptually:

```text
calculatePrice(input)
```

Input:

```text
branch
service
variant
property details
add-ons
scheduled date/time
customer context
promotion
```

Output:

```text
pricing result
breakdown
duration
version
```

The exact TypeScript contract should be defined during implementation.

---

# 56. Zod Validation

Pricing inputs crossing application boundaries must be validated with Zod.

Validation should occur before calculation.

Invalid input must produce a controlled domain error.

---

# 57. Server-Only Authority

The authoritative pricing function must execute server-side.

Client-side code may use:

```text
display estimates
```

but cannot be trusted.

---

# 58. Pricing Errors

Possible errors include:

```text
pricing_profile_not_found
pricing_version_not_found
service_not_priced
invalid_addon
invalid_input
quote_required
pricing_configuration_invalid
currency_mismatch
```

Customer-facing messages should remain understandable.

---

# 59. Availability Integration

Duration produced by the pricing engine may be required by availability.

```text
Pricing Engine
 ↓
Duration
 ↓
Availability Engine
```

However, availability must not become responsible for calculating price.

---

# 60. Booking Integration

The booking system requests a pricing calculation.

```text
Booking
 ↓
Pricing Engine
 ↓
Price Result
 ↓
Booking Price Snapshot
```

The booking stores the result.

It does not copy the entire pricing engine.

---

# 61. Recurring Bookings

Recurring bookings may use:

```text
current pricing
locked pricing
contract pricing
```

The recurring policy must specify which model applies.

Each generated booking should preserve its actual pricing version.

---

# 62. Commercial Contracts

Commercial customers may have negotiated rates.

The pricing engine should eventually support:

```text
customer pricing profile
contract pricing
volume pricing
fixed contract price
```

These should be extensions of the pricing domain rather than hardcoded exceptions.

---

# 63. Customer Type

Pricing may vary by:

```text
residential
commercial
contract
recurring
```

Customer classification must be authoritative and permission-controlled.

---

# 64. Payment Does Not Determine Price

Payment providers must never calculate the authoritative service price.

The architecture is:

```text
Pricing Engine
 ↓
Final Amount
 ↓
Payment System
```

not:

```text
Payment Provider
 ↓
Price
```

---

# 65. Price Changes After Booking

If booking inputs change:

```text
service
property
date
time
add-ons
```

the pricing engine must recalculate.

If the booking is already confirmed, change rules must determine whether:

```text
customer approval
```

is required.

---

# 66. Price Increase After Confirmation

A price increase should never be silently applied to a customer.

The system should require the appropriate business flow:

```text
recalculation
 ↓
change explanation
 ↓
customer acceptance
```

or:

```text
authorized staff override
```

depending on policy.

---

# 67. Price Decrease After Confirmation

Price reductions should similarly be recorded.

The system must preserve the original calculation and the new amount.

---

# 68. Auditability

Pricing configuration changes should record:

```text
actor
timestamp
branch
pricing profile
version
changed fields
reason where required
```

---

# 69. Pricing Security

Pricing administration must be protected against:

* unauthorized changes
* branch cross-access
* manipulated requests
* negative prices
* invalid discounts
* unauthorized overrides

---

# 70. Data Integrity

Database constraints should protect:

* valid currencies
* non-negative amounts
* valid percentages
* unique versions
* valid effective periods where possible
* branch ownership

Business validation remains necessary in application/domain logic.

---

# 71. Testing Strategy

Pricing must have extensive automated tests.

Minimum test categories:

```text
base pricing
duration
difficulty
add-ons
surcharges
discounts
tax
rounding
minimum charge
currency
effective dates
pricing versions
manual overrides
invalid inputs
```

---

# 72. Golden Test Cases

Business-approved scenarios should become deterministic fixtures.

Example:

```text
Scenario:
3-bedroom home
2 bathrooms
Medium difficulty
Standard cleaning
Sunday
1 oven add-on

Expected:
duration = X
subtotal = Y
surcharge = Z
total = W
```

Actual values come from the active business configuration.

---

# 73. Regression Protection

Every pricing bug that reaches production should result in a regression test when appropriate.

Pricing changes must not unintentionally alter unrelated services.

---

# 74. Performance

Pricing calculations should be fast enough for interactive booking.

The engine should avoid unnecessary database queries.

Relevant pricing configuration may be cached, but cache invalidation must never allow stale pricing to become authoritative.

---

# 75. Cache Principle

Cached pricing configuration is an optimization.

The database/versioned pricing state remains authoritative.

---

# 76. Observability

Pricing failures should be observable.

Useful metrics include:

```text
calculation_count
calculation_failures
calculation_duration
quote_required_count
override_count
```

Do not log unnecessary customer-sensitive information.

---

# 77. Pricing Analytics

The system should eventually support:

```text
average booking value
average hourly revenue
revenue by service
revenue by branch
discount impact
surcharge revenue
pricing override frequency
```

Analytics should consume authoritative pricing/booking records.

---

# 78. Initial Pricing Configuration

The first implementation should support at minimum:

```text
branch
service
service variant
pricing profile
pricing version
hourly rate
duration rules
difficulty multiplier
add-ons
surcharges
discounts
tax
currency
minimum price
effective dates
```

---

# 79. MVP Pricing Flow

The initial implementation should be:

```text
Customer selects service
 ↓
Customer enters property details
 ↓
Server validates inputs
 ↓
Resolve branch pricing profile
 ↓
Resolve active pricing version
 ↓
Calculate duration
 ↓
Apply rate
 ↓
Apply difficulty
 ↓
Apply add-ons
 ↓
Apply applicable surcharges
 ↓
Apply discounts
 ↓
Calculate tax
 ↓
Return breakdown
 ↓
Customer reviews
 ↓
Booking stores snapshot
```

---

# 80. Future Pricing Capabilities

The architecture should allow future support for:

* dynamic demand pricing
* zone/travel pricing
* subscription pricing
* contract pricing
* customer-specific rates
* seasonal campaigns
* minimum booking windows
* capacity-based pricing
* AI-assisted price recommendations

These must not compromise deterministic pricing for confirmed bookings.

---

# 81. Golden Pricing Rule

> **Every CLENQO price must be calculated by an authoritative server-side pricing engine using an identifiable pricing version, explicit inputs, deterministic rules, and a preserved snapshot that explains exactly how the final amount was produced.**
