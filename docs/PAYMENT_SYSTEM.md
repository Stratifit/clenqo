# CLENQO Payments and Finance

## 1. Purpose

The CLENQO Payments and Finance domain manages the financial lifecycle associated with bookings and completed cleaning services.

It connects:

```text
Booking
   ↓
Final Price
   ↓
Payment Policy
   ↓
Payment / Invoice
   ↓
Payment Provider
   ↓
Settlement
   ↓
Refund / Adjustment
   ↓
Financial Records
```

The system must support:

* multiple payment methods
* multiple payment timings
* online payments
* invoices
* refunds
* cancellation fees
* tips
* payment webhooks
* financial auditability
* branch/country-specific configuration

---

# 2. Core Finance Principle

> **The booking/pricing system determines what the customer owes; the payment system determines whether and how that amount is paid.**

Payment providers must never become the source of truth for CLENQO pricing.

---

# 3. Financial Domain Boundaries

The finance domain owns:

```text
payments
refunds
invoices
financial transactions
payment methods
payment status
payment-provider integration
tips
financial adjustments
```

It does not own:

```text
service pricing rules
booking lifecycle
employee scheduling
CMS content
authentication
```

---

# 4. Payment Timing

A branch may configure different payment timings.

Supported concepts:

```text
after_completion
at_booking
deposit
invoice
manual
```

The initial residential default may be:

```text
payment after completion
```

This is configuration, not a global hardcoded rule.

---

# 5. Payment Methods

The architecture should support:

```text
credit_card
debit_card
paypal
sepa_direct_debit
apple_pay
google_pay
bank_transfer
cash
```

Availability depends on branch, country, provider, customer type, and business policy.

---

# 6. Payment Provider Abstraction

The application should not tightly couple the business domain to one provider.

Conceptually:

```text
Payment Domain
      ↓
Provider Adapter
 ├── Provider A
 ├── Provider B
 └── Provider C
```

The exact provider selection is an implementation/business decision.

---

# 7. Provider Responsibilities

A payment provider handles things such as:

* payment authorization
* payment capture
* payment method processing
* provider-side customer/payment information
* refunds
* provider webhooks

CLENQO stores the necessary business references and financial state.

---

# 8. No Card Storage

CLENQO must not store raw:

```text
card number
CVV
full magnetic stripe data
```

Payment-sensitive information should remain with the payment provider.

---

# 9. Payment Record

A payment record should contain concepts such as:

```text
id
booking_id
branch_id
amount
currency
status
payment_method
provider
provider_reference
created_at
updated_at
```

Additional metadata may be stored where necessary.

---

# 10. Payment Status

Initial payment states may include:

```text
pending
authorized
paid
failed
cancelled
partially_refunded
refunded
```

The exact state machine must be defined during implementation.

---

# 11. Payment State Machine

Typical flow:

```text
pending
   ↓
authorized
   ↓
paid
```

Failure:

```text
pending
   ↓
failed
```

Refund:

```text
paid
   ↓
partially_refunded
   ↓
refunded
```

---

# 12. Payment Amount

The payment amount must originate from the authoritative booking amount.

Conceptually:

```text
Pricing Engine
 ↓
Booking Price Snapshot
 ↓
Payment Amount
```

The frontend must not be able to arbitrarily modify the payment amount.

---

# 13. Currency

Every payment must specify its currency.

Example:

```text
EUR
```

The system must not globally assume EUR.

Future branches may use other supported currencies.

---

# 14. Currency Matching

Payment currency must be compatible with the booking's authoritative currency.

Unexpected currency mismatches must be rejected.

---

# 15. Payment After Completion

For payment-after-completion:

```text
Booking
 ↓
Cleaning
 ↓
Job Completed
 ↓
Payment Request
 ↓
Customer Pays
```

The customer should receive a secure payment request where online payment is supported.

---

# 16. Payment at Booking

For upfront payment:

```text
Booking Request
 ↓
Price Calculation
 ↓
Payment
 ↓
Booking Confirmation
```

The exact booking state while payment is pending must be explicitly defined.

---

# 17. Deposit Payments

The system should eventually support deposits.

Example:

```text
Booking Total = €300
Deposit = €100
Remaining = €200
```

The booking remains financially open until the remaining amount is settled.

---

# 18. Invoice Payments

Commercial customers may use invoices.

Flow:

```text
Booking / Contract
 ↓
Invoice
 ↓
Bank Transfer
 ↓
Payment Reconciliation
 ↓
Invoice Paid
```

Invoice terms may vary by customer or contract.

---

# 19. Bank Transfer

Bank transfer payments may require manual or automated reconciliation.

The system should distinguish:

```text
invoice issued
payment expected
payment received
payment reconciled
```

Receiving money and confirming reconciliation are not necessarily the same action.

---

# 20. Cash

Cash may be supported only for approved customers.

Initial business policy:

```text
cash = approved repeat customers only
```

This must remain configurable.

Cash transactions require explicit recording.

---

# 21. Cash Recording

A cash payment should record:

```text
amount
currency
received_by
received_at
booking/invoice
reference
```

Appropriate audit controls should apply.

---

# 22. PayPal

PayPal may be supported through a provider integration.

The finance domain should store provider references rather than provider-specific business logic throughout the application.

---

# 23. Card Payments

Debit and credit card payments should use a compliant payment provider.

CLENQO should use provider-hosted or provider-controlled payment collection wherever possible.

---

# 24. Apple Pay and Google Pay

Digital wallets should be treated as payment methods exposed through a supported payment provider.

The booking system should only need the resulting payment state.

---

# 25. SEPA Direct Debit

SEPA Direct Debit may be useful for recurring customers and commercial contracts.

The system must support appropriate authorization/mandate references without storing unnecessary banking credentials.

---

# 26. Payment Provider Webhooks

Provider webhooks are critical.

Examples:

```text
payment_succeeded
payment_failed
payment_refunded
payment_authorized
payment_cancelled
```

Webhooks must be authenticated and verified.

---

# 27. Webhook Signature Verification

Provider webhook signatures must be validated before processing.

Unverified webhook payloads must be rejected.

---

# 28. Webhook Idempotency

The same webhook may arrive multiple times.

Processing must therefore be idempotent.

Example:

```text
payment_succeeded
```

received twice must not create two payments.

---

# 29. Provider Event Storage

The system should preserve provider event identifiers where necessary to prevent duplicate processing and support troubleshooting.

---

# 30. Payment Reconciliation

The system should support reconciliation between:

```text
CLENQO financial records
+
provider records
```

Future finance tooling may identify:

```text
missing payment
duplicate payment
unexpected amount
unmatched transaction
```

---

# 31. Refunds

Refunds must be separate financial records.

A refund should contain:

```text
payment_id
amount
currency
reason
status
provider_reference
created_at
```

---

# 32. Full Refund

A full refund returns the entire eligible payment amount.

The system must validate that the refund does not exceed the refundable amount.

---

# 33. Partial Refund

Partial refunds are supported.

Example:

```text
Original payment: €200
Refund: €50
Remaining paid: €150
```

---

# 34. Refund Authorization

Refunds require explicit permission.

Possible permission:

```text
payments.refund
```

Higher-value refunds may eventually require additional approval.

---

# 35. Cancellation Fees

Cancellation fees are determined by booking policy.

The cancellation calculation belongs to the booking/business rules.

The payment domain executes the financial consequence.

```text
Booking Policy
 ↓
Cancellation Fee
 ↓
Payment / Refund
```

---

# 36. Cancellation Fee Example

Initial planning policy:

```text
24+ hours       → 0%
12–24 hours     → 25%
2–12 hours      → 50%
under 2 hours   → 100%
```

These values must remain configurable.

---

# 37. Cancellation Fee Snapshot

When a cancellation fee is applied, preserve:

```text
policy/version
time before service
original amount
fee percentage
fee amount
reason
```

This makes the financial outcome explainable.

---

# 38. Tips

CLENQO may support customer tips.

Example:

```text
Service = €120
Tip = €20
Customer pays = €140
```

Tips should be represented separately from the service price.

---

# 39. Cleaner Tip Allocation

Initial business policy:

```text
Cleaner receives 100% of tip.
```

The financial system must record the tip allocation explicitly.

---

# 40. Tip Refunds

If a payment containing a tip is refunded, the system must define whether:

```text
service
tip
```

are refunded together or separately.

This should be a documented business rule.

---

# 41. Invoices

Invoices should contain:

```text
invoice number
customer
branch
booking(s)
issue date
due date
currency
line items
subtotal
tax
total
status
```

---

# 42. Invoice Status

Initial states may include:

```text
draft
issued
partially_paid
paid
overdue
void
```

---

# 43. Invoice Number

Invoices require unique human-readable numbers.

Example:

```text
INV-2026-000123
```

Internal UUID remains the primary identifier.

---

# 44. Invoice Line Items

Line items should preserve what was billed.

Examples:

```text
Cleaning Service
Add-on
Surcharge
Discount
Tax
```

The invoice must remain historically reproducible.

---

# 45. Invoice Immutability

An issued invoice must not be silently rewritten.

Corrections should use:

* adjustment
* credit note
* replacement invoice
* void/reissue

according to the applicable financial process.

---

# 46. Invoice PDF

Future functionality should allow invoice generation as a PDF.

The generated document should reflect the stored invoice data rather than recalculating current pricing rules.

---

# 47. Payment Receipt

Successful payments may generate a receipt.

The receipt should contain:

```text
booking/invoice reference
amount
currency
payment method
payment date
transaction reference
```

---

# 48. Payment Failure

If payment fails:

```text
Payment → failed
```

The customer should receive a clear retry path where appropriate.

A failed payment must not automatically mean the booking is cancelled unless business rules require it.

---

# 49. Payment Retry

The system should support safe payment retries.

A retry must not accidentally create duplicate successful charges.

---

# 50. Payment Expiration

Payment sessions may expire.

The system must distinguish:

```text
payment session expired
```

from:

```text
payment failed
```

where the provider supports the distinction.

---

# 51. Booking and Payment State

Booking status and payment status are separate.

Example:

```text
Booking:
confirmed

Payment:
pending
```

This may be valid under payment-after-completion.

---

# 52. Financial State

The system should calculate financial state from authoritative financial records rather than storing redundant mutable totals wherever possible.

Useful derived concepts:

```text
amount_due
amount_paid
amount_refunded
balance
```

---

# 53. Financial Adjustments

Authorized staff may need to apply adjustments.

Examples:

```text
discount
credit
manual charge
service recovery
correction
```

Every adjustment requires an audit trail.

---

# 54. Manual Payment Recording

Authorized staff may record payments received outside the online provider.

Examples:

```text
cash
bank transfer
```

Manual payment recording must require:

* amount
* currency
* payment method
* actor
* timestamp
* reference/reason

---

# 55. Financial Permissions

Suggested permissions include:

```text
payments.view
payments.create
payments.capture
payments.refund
payments.record_manual
payments.reconcile

invoices.view
invoices.create
invoices.issue
invoices.void
```

Exact permissions remain configurable through the authorization system.

---

# 56. Branch Financial Scope

Branch users must only access financial records for authorized branches.

HQ users may have organization-wide access according to permission.

RLS must enforce branch isolation.

---

# 57. Customer Financial Access

Customers should only see their own:

```text
payments
invoices
receipts
refunds
balances
```

Customer access must use the secure customer session/magic-link model.

---

# 58. Financial Audit Trail

Financial changes must be auditable.

Examples:

```text
payment recorded
payment refunded
invoice issued
invoice voided
manual adjustment
cash payment recorded
```

Audit records should identify the actor and timestamp.

---

# 59. Money Calculations

All monetary calculations must use decimal-safe representations.

Avoid binary floating-point arithmetic for authoritative financial calculations.

---

# 60. Database Money Representation

PostgreSQL `numeric`/decimal-safe representation should be preferred for authoritative monetary values.

Do not store monetary values as arbitrary formatted strings.

---

# 61. Transaction Safety

Critical financial operations must be transactional where multiple internal records change together.

Examples:

```text
record payment
apply refund
issue invoice
apply adjustment
```

---

# 62. External Provider Transactions

External provider calls cannot be made truly atomic with PostgreSQL.

Therefore the system must use safe state transitions and reconciliation mechanisms.

Example:

```text
Internal Payment
      ↓
Provider Request
      ↓
Provider Result/Webhook
      ↓
Internal Final State
```

---

# 63. Financial Idempotency

Critical financial operations require idempotency.

Examples:

```text
charge
refund
manual payment
webhook processing
invoice issuance
```

---

# 64. No Duplicate Charges

A retry must never blindly issue another payment request.

The system should use:

```text
idempotency keys
provider references
internal payment state
```

where supported.

---

# 65. Payment Security

The finance domain must protect against:

* amount manipulation
* unauthorized refunds
* duplicate charges
* forged webhooks
* unauthorized payment recording
* branch data leakage
* replay attacks

---

# 66. Secrets

Provider secrets must remain server-side.

They must never be exposed to:

```text
browser
frontend bundle
customer
cleaner
```

---

# 67. Environment Configuration

Provider credentials should be managed through secure environment/secret management.

Development, staging, and production credentials must remain separate.

---

# 68. Notifications

Financial events may trigger:

```text
payment confirmation
payment failure
refund confirmation
invoice
invoice reminder
receipt
```

The notification system owns delivery.

---

# 69. Email First

The initial finance notification channel should be email.

Future channels may include:

```text
WhatsApp
SMS
push
```

---

# 70. Finance and CMS

The CMS may control the presentation of financial information on public pages.

It must not control:

```text
payment status
authoritative invoice totals
payment records
refund state
```

Those belong to the finance domain.

---

# 71. Finance and Booking

The relationship is:

```text
Booking
 ↓
Price Snapshot
 ↓
Financial Obligation
 ↓
Payment / Invoice
```

The finance system references the booking rather than duplicating pricing logic.

---

# 72. Finance and Completion

For payment-after-completion:

```text
Job Completed
 ↓
Booking Completed
 ↓
Payment Request
```

The completion event can trigger the financial workflow.

---

# 73. Financial Reporting

The platform should eventually provide:

```text
revenue
payments
refunds
outstanding balances
invoice aging
tips
cancellation fees
branch revenue
service revenue
```

Reporting must use authoritative financial records.

---

# 74. Revenue Recognition

The application should avoid making accounting assumptions beyond its defined business requirements.

Detailed accounting treatment may require country-specific/accounting integration.

---

# 75. Accounting Integration

Future integrations may connect CLENQO to external accounting systems.

The finance architecture should therefore support export/integration without making the external accounting system the operational booking database.

---

# 76. Tax and Country Expansion

Tax rules may differ between countries.

The finance architecture must not hardcode Germany-specific tax behavior into global application logic.

Country-specific configuration/integration should be isolated.

---

# 77. Multi-Country Readiness

Future branches may differ in:

* currency
* tax
* payment methods
* invoice rules
* payment timing
* legal requirements

These differences should be configuration/integration boundaries rather than scattered conditionals.

---

# 78. Financial Data Retention

Financial records may have longer retention requirements than ordinary operational records.

Deletion policies must therefore respect applicable legal/accounting requirements.

Do not automatically delete historical financial records when a customer or booking is archived.

---

# 79. Financial Privacy

Financial information must be treated as sensitive.

Use:

* least privilege
* branch isolation
* RLS
* server-side authorization
* secure provider integration
* audit logs

---

# 80. Testing Strategy

Automated tests must cover:

```text
payment creation
payment success
payment failure
refund
partial refund
duplicate webhook
duplicate payment request
currency
amount validation
invoice creation
invoice payment
manual payment
cancellation fee
tips
authorization
branch isolation
```

---

# 81. Provider Testing

Each provider integration should support a test/sandbox environment where available.

Production credentials must never be used for automated tests.

---

# 82. Webhook Testing

Webhook tests must cover:

```text
valid signature
invalid signature
duplicate event
unknown event
out-of-order event
provider timeout
```

---

# 83. Financial Reconciliation Tests

The system should test cases where:

```text
provider says paid
internal state says pending
```

and ensure reconciliation can safely resolve the discrepancy.

---

# 84. MVP Finance Scope

Initial implementation should support:

```text
payment model
payment status
payment-provider abstraction
one initial online payment integration
manual bank-transfer recording
invoice foundation
refund foundation
cancellation fees
payment-after-completion flow
financial audit trail
```

The exact first payment provider is a separate implementation decision.

---

# 85. Future Finance Capabilities

Future versions may add:

* multiple payment providers
* SEPA Direct Debit
* PayPal
* Apple Pay
* Google Pay
* commercial invoicing
* recurring payments
* subscriptions
* accounting integrations
* automated reconciliation
* advanced financial reporting
* payroll integration
* tax automation

---

# 86. Architectural Summary

The finance architecture is:

```text
Pricing Engine
      ↓
Booking Price Snapshot
      ↓
Financial Obligation
      ├── Payment
      │     ↓
      │  Provider
      │     ↓
      │  Webhook
      │
      └── Invoice
            ↓
         Payment
```

---

# 87. Golden Finance Rule

> **CLENQO must always know what was charged, why it was charged, how it was paid, whether it was refunded or adjusted, and who or what caused the financial change—without storing sensitive payment credentials or allowing external providers to become the source of truth for business pricing.**
