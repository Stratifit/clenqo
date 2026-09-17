/**
 * Canonical permission catalog — the single authoritative vocabulary from
 * docs/SECURITY.md §14 (post-audit consolidation, CRITICAL-1 resolution).
 * Do not invent new permissions here; new capabilities extend the catalog in
 * SECURITY.md first.
 *
 * Permission shape: resource.action (SECURITY.md §15).
 */

export const PERMISSIONS = [
  // website / pages / media / seo
  "website.view", "website.edit", "website.publish",
  "pages.view", "pages.create", "pages.edit", "pages.archive", "pages.publish",
  "media.view", "media.upload", "media.manage",
  "seo.view", "seo.edit",
  // bookings / customers
  "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel",
  "customers.view", "customers.edit",
  // workforce
  "employees.view", "employees.manage",
  "jobs.view", "jobs.assign", "jobs.manage",
  // pricing
  "pricing.view", "pricing.create", "pricing.edit", "pricing.publish",
  "pricing.archive", "pricing.override",
  // payments / invoices
  "payments.view", "payments.create", "payments.capture", "payments.refund",
  "payments.record_manual", "payments.reconcile", "payments.manage",
  "invoices.view", "invoices.manage",
  // quality
  "quality.view", "quality.create_check", "quality.manage_issue",
  "quality.resolve_issue", "quality.report", "quality.manage",
  // branches — the permissions this change exercises (HQ-only, org scope)
  "branches.view", "branches.create", "branches.edit", "branches.activate",
  "branches.suspend", "branches.archive",
  // users
  "users.view", "users.invite", "users.edit", "users.deactivate",
  // reports
  "reports.view", "reports.export", "reports.financial", "reports.workforce",
  "reports.customer", "reports.quality", "reports.cross_branch", "reports.manage",
  // audit
  "audit.view", "audit.view_branch", "audit.view_sensitive", "audit.export",
  // search / services / settings
  "search.use", "services.view", "services.edit", "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permission grants. HQ roles hold organization-wide scope;
 * branch-scoped roles receive their permission set at branch scope via
 * membership_branches (SECURITY.md §20, BRANCH_SYSTEM §52–54).
 *
 * This is an implementation map of the documented role capabilities; it
 * contains no permissions outside the canonical catalog above.
 */
export const ROLE_PERMISSIONS: Record<
  "hq_admin" | "hq_staff" | "branch_manager" | "cleaner",
  ReadonlySet<Permission>
> = {
  hq_admin: new Set<Permission>(PERMISSIONS),

  hq_staff: new Set<Permission>([
    "website.view", "website.edit",
    "pages.view", "pages.create", "pages.edit", "pages.archive", "pages.publish",
    "media.view", "media.upload", "media.manage",
    "seo.view", "seo.edit",
    "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel",
    "customers.view", "customers.edit",
    "employees.view", "employees.manage",
    "jobs.view", "jobs.assign", "jobs.manage",
    "pricing.view", // P20: HQ staff hold pricing.view ONLY
    "quality.view", "quality.report",
    "branches.view",
    "users.view",
    "reports.view", "reports.export",
    "audit.view", "audit.view_branch",
    "search.use",
    "services.view", "services.edit",
  ]),

  branch_manager: new Set<Permission>([
    "website.view", "website.edit",
    "pages.view", "pages.edit",
    "media.view", "media.upload",
    "seo.view", "seo.edit",
    "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel",
    "customers.view", "customers.edit",
    "employees.view", "employees.manage",
    "jobs.view", "jobs.assign", "jobs.manage",
    // P20: view/create/edit/publish/archive WITHIN branch scope (hasBranchScope
    // enforces membership_branches at the domain layer).
    "pricing.view", "pricing.create", "pricing.edit", "pricing.publish",
    "pricing.archive",
    "quality.view", "quality.create_check", "quality.manage_issue",
    "quality.resolve_issue", "quality.report", "quality.manage",
    "branches.view",
    "reports.view",
    "audit.view_branch",
    "search.use",
    "services.view", "services.edit",
  ]),

  cleaner: new Set<Permission>([
    "jobs.view",
    "search.use",
  ]),
};
