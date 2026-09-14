# CLENQO

> **Clean Spaces. Better Living.**

CLENQO is a technology-powered cleaning company and multi-branch operations platform designed to deliver professional cleaning services through a consistent, scalable, and highly automated operating system.

The platform is designed from day one to support multiple CLENQO branches while maintaining a single centralized technology platform, shared brand system, secure branch isolation, and centralized HQ administration.

---

## 1. Project Overview

CLENQO combines a professional cleaning service business with custom operational software.

The platform will support:

* CLENQO HQ
* Multiple geographic branches
* Branch managers
* Cleaning employees
* Customers
* Online booking
* Dynamic pricing
* Scheduling
* Worker assignment
* Job management
* Payments
* Invoicing
* Notifications
* Reviews
* Reporting
* Branch-specific websites
* Customer booking management
* Cleaner mobile/PWA experience
* Centralized administration

The system must be capable of growing from a single operating branch to a large multi-branch network without requiring a fundamental architectural rewrite.

---

## 2. Core Principle

CLENQO is **multi-branch by design from day one**.

A branch is not a separate application or separate codebase.

Instead:

```text
                         CLENQO
                           │
                    Central Platform
                           │
             ┌─────────────┼─────────────┐
             │             │             │
          Branch A      Branch B      Branch C
             │             │             │
          Website       Website       Website
          Dashboard     Dashboard     Dashboard
          Customers     Customers     Customers
          Employees     Employees     Employees
          Bookings      Bookings      Bookings
```

All branches use the same CLENQO platform and codebase while maintaining isolated branch-specific data and configuration.

---

## 3. Product Structure

CLENQO consists of several interconnected products.

### 3.1 Public Website

The public-facing CLENQO website provides:

* Homepage
* Services
* Pricing
* About
* FAQ
* Contact
* Reviews
* Local branch information
* Booking experience

Each branch receives its own localized website experience from the central CLENQO website system.

---

### 3.2 Booking System

Customers can book cleaning services without creating a traditional account.

The booking system will support:

* Service selection
* Property information
* Add-ons
* Date and time selection
* Availability
* Dynamic pricing
* Customer information
* Booking confirmation
* Payment options
* Magic-link booking management
* Cancellation and rescheduling

---

### 3.3 Customer Experience

Customers can:

* Create bookings
* View upcoming bookings
* Manage bookings through secure magic links
* Reschedule where permitted
* Cancel where permitted
* View booking details
* View invoices/receipts
* Rebook services
* Leave reviews

Customer accounts are not required for the initial booking experience.

---

### 3.4 Cleaner Experience

Employees will have a mobile-first Progressive Web App (PWA).

The cleaner system will support:

* Today's jobs
* Upcoming jobs
* Job details
* Customer information
* Cleaning checklist
* Check-in
* Check-out
* Job notes
* Before/after photos
* Incident reporting
* Job completion

---

### 3.5 Branch Administration

Each branch receives its own operational workspace.

Branch managers can manage:

* Branch bookings
* Customers
* Employees
* Schedules
* Services
* Local pricing
* Service areas
* Reviews
* Operational information
* Branch performance

Branch managers only have access to information they are authorized to access.

---

### 3.6 HQ Administration

CLENQO HQ has centralized control over the entire network.

HQ administrators can:

* Create branches
* Activate/deactivate branches
* Configure branches
* Assign branch managers
* Manage the global CLENQO brand
* Manage global services
* Define default pricing
* Manage users and permissions
* View all bookings
* View all branches
* View network performance
* Manage system configuration
* Manage platform-wide content
* Monitor operations

---

## 4. Automatic Branch Provisioning

Creating a branch should automatically provision its initial digital environment.

The intended workflow is:

```text
HQ Admin
   │
   ▼
Create Branch
   │
   ▼
Branch Configuration
   │
   ├── Branch identity
   ├── Location
   ├── Contact information
   ├── Service area
   ├── Opening hours
   ├── Services
   ├── Pricing configuration
   └── Manager
   │
   ▼
Automatic Provisioning
   │
   ├── Branch website configuration
   ├── Website pages
   ├── Branch dashboard
   ├── Booking configuration
   ├── Default services
   └── Default settings
   │
   ▼
Branch Ready
```

Branches should not require duplicated frontend code.

---

## 5. Technology Stack

### Frontend

* Next.js 16
* React 19
* TypeScript
* Tailwind CSS
* shadcn/ui
* GSAP where appropriate

### Backend / Platform

* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Storage
* Row Level Security (RLS)

### Application Libraries

* Zod
* React Hook Form

### Infrastructure

* Vercel
* Supabase
* GitHub

### Email

* Amazon SES
* CLENQO transactional email system

### Messaging

Email will be implemented first.

WhatsApp integration may be introduced later where operationally and financially justified.

---

## 6. Architecture Principles

The system must follow these principles:

1. **Multi-branch from day one**
2. **Single codebase**
3. **Single centralized platform**
4. **Strong branch-level data isolation**
5. **Security by default**
6. **Server-side authorization**
7. **Database-level security with RLS**
8. **Business logic separated from presentation**
9. **Reusable components**
10. **Configuration over duplicated code**
11. **Version-controlled database migrations**
12. **Validated inputs**
13. **Test critical business logic**
14. **Document significant architectural decisions**
15. **OpenSpec-driven implementation for major changes**

---

## 7. Documentation

The `docs/` directory contains the detailed project documentation.

Core documents include:

```text
docs/
├── PROJECT_RULES.md
├── VISION.md
├── REQUIREMENTS.md
├── ARCHITECTURE.md
├── DATABASE.md
├── SECURITY.md
├── ROLES_PERMISSIONS.md
├── BRANCH_SYSTEM.md
├── WEBSITE_SYSTEM.md
├── BOOKING_SYSTEM.md
├── PRICING_ENGINE.md
├── WORKER_SYSTEM.md
├── PAYMENT_SYSTEM.md
├── NOTIFICATION_SYSTEM.md
├── ADMIN_SYSTEM.md
├── CUSTOMER_SYSTEM.md
├── DESIGN_SYSTEM.md
├── COMPONENT_STANDARDS.md
├── API_STANDARDS.md
├── TESTING_STRATEGY.md
├── DEPLOYMENT.md
├── OBSERVABILITY.md
└── ROADMAP.md
```

Documents will be created progressively as the corresponding systems are designed.

---

## 8. OpenSpec

OpenSpec is used to control significant changes to the CLENQO system.

The intended development workflow is:

```text
Business Requirement
        ↓
Documentation
        ↓
OpenSpec Change
        ↓
Specification
        ↓
Implementation
        ↓
Testing
        ↓
Verification
        ↓
Archive
```

OpenSpec should be used to prevent uncontrolled architectural changes and ensure implementation remains aligned with the project documentation.

---

## 9. Development Philosophy

CLENQO should be built as a real production system rather than a prototype that is later rewritten.

Development priorities are:

### Correctness

Business rules must be explicit and deterministic.

### Security

Users must only access information they are authorized to access.

### Scalability

The architecture must support additional branches without duplicating applications.

### Maintainability

Code should favor clear boundaries, reusable components, and documented decisions.

### User Experience

Customer booking, employee workflows, and administrative operations should remain simple and fast.

### Automation

Manual work should progressively be replaced with reliable automation after the underlying workflow has been validated.

---

## 10. Initial Development Strategy

The initial implementation will proceed in controlled stages.

```text
Phase 0
Documentation & Project Foundation

Phase 1
Core Platform & Multi-Branch Foundation

Phase 2
Branch Management & Provisioning

Phase 3
Website Template System

Phase 4
Services & Pricing Engine

Phase 5
Booking Engine

Phase 6
Customer Experience

Phase 7
Cleaner PWA

Phase 8
Admin Operations

Phase 9
Payments & Invoicing

Phase 10
Notifications & Automation

Phase 11
Analytics & Reporting

Phase 12
Production Launch & Expansion
```

The system should not move into a later phase until the foundational requirements of the previous phase have been verified.

---

## 11. Repository Structure

The repository will eventually follow a structure similar to:

```text
clenqo/
├── README.md
│
├── docs/
│   └── ...
│
├── openspec/
│   ├── config.yaml
│   ├── specs/
│   ├── changes/
│   └── archive/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/
│   ├── server/
│   └── ...
│
├── public/
│
├── supabase/
│   ├── migrations/
│   ├── seeds/
│   └── ...
│
├── tests/
│
├── package.json
├── tsconfig.json
├── next.config.ts
└── ...
```

The exact structure will be finalized in `ARCHITECTURE.md` before substantial application implementation begins.

---

## 12. Source of Truth

The following hierarchy should be respected:

```text
Business Decisions
        ↓
Project Documentation
        ↓
OpenSpec Specifications
        ↓
Implementation
        ↓
Tests
```

Code must not silently redefine established business rules.

When a significant requirement changes, the relevant documentation and OpenSpec specification must be updated accordingly.

---

## 13. Current Project Objective

The first major objective is to establish the CLENQO platform foundation.

The first functional milestone is:

> **An HQ administrator can create a branch, and CLENQO automatically provisions the branch's website configuration and operational dashboard within the same centralized platform.**

Everything else will build on this foundation.

---

## 14. Status

**Project:** CLENQO
**Type:** Multi-branch cleaning company + operations platform
**Architecture:** Multi-tenant / branch-aware
**Frontend:** Next.js 16
**Backend:** Supabase + PostgreSQL
**Status:** Architecture and documentation phase
**Current milestone:** Project documentation foundation
