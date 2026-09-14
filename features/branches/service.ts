/**
 * Branch domain service — Branch Creation with Automatic Provisioning
 * (openspec/changes/create-branch-provisioning; API_STANDARDS.md §14).
 *
 * Transaction model (design §4, design-review 2026-09-14):
 *
 *   Tx1 (commits)  → branches row (status=provisioning, provisioning_status=pending)
 *                    + branch.created audit                    [AUDIT_SYSTEM §50]
 *   Tx2 (commits)  → all provisioning content + provisioning_status=ready
 *                    + 4 provisioning audits + branch.ready (same tx)
 *   Tx2 failure    → Tx3 (commits): provisioning_status=failed, stage, error,
 *                    attempts+1 + provisioning.failed audit
 *   Retry          → guarded conditional transition failed→provisioning
 *                    (exactly one concurrent retry wins), then Tx2 re-run
 *
 * Idempotency is backed by natural-key UNIQUE constraints (DATABASE.md §42):
 * branch (organization_id, slug), website (branch_id), locale (website_id,
 * locale), page (website_id, slug), section (page_id, section_key).
 *
 * Telemetry is emitted OUTSIDE transactions and is diagnostic only
 * (OBSERVABILITY.md §10; design §7).
 */
import { normalizeSlug, createBranchInputSchema, type CreateBranchInput } from "./schemas/create-branch";
import { getMasterTemplatePages, MASTER_TEMPLATE_KEY } from "@/features/website/master-template";
import { requirePermission, requireOrganizationAccess, type AuthContext } from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { logger, metrics } from "@/lib/observability/logger";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";

export type ProvisioningStatus = "pending" | "provisioning" | "ready" | "failed";
export type BranchStatus = "draft" | "provisioning" | "ready" | "active" | "suspended" | "archived";

export interface BranchRecord {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: BranchStatus;
  provisioning_status: ProvisioningStatus;
  provisioning_error: string | null;
  provisioning_stage: string | null;
  provisioning_attempts: number;
  provisioned_at: Date | null;
  activated_at: Date | null;
  timezone: string;
  currency: string;
  locale: string;
  service_area: Record<string, unknown> | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------
// Idempotency: duplicate creation with the same logical request returns
// the existing branch (API_STANDARDS.md §19 — slug is the natural key).
// ---------------------------------------------------------------------

async function findBranchBySlug(
  organizationId: string,
  slug: string,
): Promise<BranchRecord | null> {
  const res = await query<BranchRecord>(
    `select * from public.branches where organization_id = $1 and slug = $2`,
    [organizationId, slug],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------
// Tx2 — provisioning content (all-or-nothing)
// ---------------------------------------------------------------------

export class ProvisioningFailure extends Error {
  constructor(
    readonly stage: string,
    readonly reason: string,
  ) {
    super(`Provisioning failed at stage "${stage}": ${reason}`);
    this.name = "ProvisioningFailure";
  }
}

// ---------------------------------------------------------------------
// Test-only failure-injection seam (task 7.3: verify Tx2 rollback leaves no
// orphaned content). Never active in production — guarded by NODE_ENV.
// ---------------------------------------------------------------------
type FailureHook = (stage: string) => boolean;
let failureHook: FailureHook | null = null;

export function setProvisioningFailureHookForTests(hook: FailureHook | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("failure hook must never run in production");
  }
  failureHook = hook;
}

function injectFailureIfHooked(stage: string): void {
  if (failureHook?.(stage)) {
    throw new ProvisioningFailure(stage, "injected test failure");
  }
}

async function provisionWebsiteFoundation(
  tx: TransactionClient,
  branch: BranchRecord,
  input: CreateBranchInput,
  actor: AuthContext,
): Promise<void> {
  type Stage = "website" | "locales" | "pages" | "translations" | "sections" | "seo";
  let stage: Stage = "website";

  try {
    // -- Stage: website ----------------------------------------------
    stage = "website";
    injectFailureIfHooked(stage);
    const websiteRes = await tx.query<{ id: string }>(
      `insert into public.branch_websites (branch_id, template_key, status, default_locale, seo_title, seo_description)
       values ($1, $2, 'draft', $3, $4, $5)
       on conflict (branch_id) do update set updated_at = now()
       returning id`,
      [
        branch.id,
        MASTER_TEMPLATE_KEY,
        input.default_locale,
        `${input.name} – CLENQO`,
        getMasterTemplatePages(input.default_locale)[0]?.seo_description ?? null,
      ],
    );
    const websiteId = websiteRes.rows[0].id;

    // -- Stage: locales ----------------------------------------------
    stage = "locales";
    injectFailureIfHooked(stage);
    for (const locale of input.enabled_locales) {
      await tx.query(
        `insert into public.website_locales (website_id, locale, is_default, is_enabled)
         values ($1, $2, $3, true)
         on conflict (website_id, locale) do update
           set is_default = excluded.is_default, is_enabled = true, updated_at = now()`,
        [websiteId, locale, locale === input.default_locale],
      );
    }

    // -- Stage: pages -------------------------------------------------
    stage = "pages";
    injectFailureIfHooked(stage);
    const pages = getMasterTemplatePages(input.default_locale);
    const pageIds = new Map<string, string>();
    for (const page of pages) {
      const res = await tx.query<{ id: string }>(
        `insert into public.website_pages (website_id, slug, page_type, status, sort_order)
         values ($1, $2, $3, 'draft', $4)
         on conflict (website_id, slug) do update set updated_at = now()
         returning id`,
        [websiteId, page.slug, page.page_type, page.sort_order],
      );
      pageIds.set(page.page_type, res.rows[0].id);
    }

    // -- Stage: translations (default locale only at provisioning) ----
    stage = "translations";
    injectFailureIfHooked(stage);
    for (const page of pages) {
      const pageId = pageIds.get(page.page_type)!;
      await tx.query(
        `insert into public.website_page_translations (page_id, locale, title, meta_title, meta_description)
         values ($1, $2, $3, $4, $5)
         on conflict (page_id, locale) do update
           set title = excluded.title, meta_title = excluded.meta_title,
               meta_description = excluded.meta_description, updated_at = now()`,
        [pageId, input.default_locale, page.title, page.seo_title, page.seo_description],
      );
    }

    // -- Stage: sections ----------------------------------------------
    stage = "sections";
    injectFailureIfHooked(stage);
    for (const page of pages) {
      const pageId = pageIds.get(page.page_type)!;
      for (const s of page.sections) {
        await tx.query(
          `insert into public.website_sections (page_id, section_type, section_key, sort_order, is_enabled, content)
           values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (page_id, section_key) do update
             set section_type = excluded.section_type, sort_order = excluded.sort_order,
                 is_enabled = excluded.is_enabled, content = excluded.content, updated_at = now()`,
          [pageId, s.section_type, s.section_key, s.sort_order, s.is_enabled, JSON.stringify(s.content)],
        );
      }
    }

    // -- Stage: seo defaults ------------------------------------------
    stage = "seo";
    await tx.query(
      `update public.branch_websites
          set seo_title = $2, seo_description = $3, updated_at = now()
        where id = $1`,
      [websiteId, `${input.name} – CLENQO`, getMasterTemplatePages(input.default_locale)[0]?.seo_description ?? null],
    );

    // -- Transactional provisioning audit events (AUDIT_SYSTEM §50) ---
    await writeAuditEvent(
      {
        action: "website.provisioned", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: actor.actor.userId, resourceType: "branch_website",
        resourceId: websiteId, requestId: actor.requestId ?? null,
        metadata: { template_key: MASTER_TEMPLATE_KEY },
      },
      tx,
    );
    await writeAuditEvent(
      {
        action: "locales.provisioned", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: actor.actor.userId, resourceType: "website_locale",
        resourceId: websiteId, requestId: actor.requestId ?? null,
        metadata: { locales: input.enabled_locales, default_locale: input.default_locale },
      },
      tx,
    );
    await writeAuditEvent(
      {
        action: "pages.provisioned", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: actor.actor.userId, resourceType: "website_page",
        resourceId: websiteId, requestId: actor.requestId ?? null,
        metadata: { page_count: pages.length },
      },
      tx,
    );
    await writeAuditEvent(
      {
        action: "configuration.provisioned", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: actor.actor.userId, resourceType: "branch_website",
        resourceId: websiteId, requestId: actor.requestId ?? null,
        metadata: { includes: ["navigation", "footer", "seo_defaults"] },
      },
      tx,
    );

    // -- Mark provisioning ready (same transaction, AUDIT_SYSTEM §50) -
    // Branch lifecycle transitions provisioning → ready (BRANCH_SYSTEM §18–19);
    // activation remains a separate authorized operation.
    await tx.query(
      `update public.branches
          set provisioning_status = 'ready', status = 'ready', provisioned_at = now(),
              updated_at = now(), provisioning_error = null, provisioning_stage = null
        where id = $1`,
      [branch.id],
    );
    await writeAuditEvent(
      {
        action: "branch.ready", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: actor.actor.userId, resourceType: "branch",
        resourceId: branch.id, requestId: actor.requestId ?? null,
        metadata: { provisioning_attempts: branch.provisioning_attempts + 1 },
      },
      tx,
    );
  } catch (err) {
    // Wrap unexpected failures with stage context for the failure record.
    if (err instanceof ProvisioningFailure) throw err;
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new ProvisioningFailure(stage, reason);
  }
}

// ---------------------------------------------------------------------
// Tx3 — failure marking (small committed transaction; survives rollback)
// ---------------------------------------------------------------------

async function markProvisioningFailed(
  branch: BranchRecord,
  failure: ProvisioningFailure,
  ctx: AuthContext,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `update public.branches
          set provisioning_status = 'failed',
              provisioning_error = $2,
              provisioning_stage = $3,
              provisioning_attempts = provisioning_attempts + 1,
              updated_at = now()
        where id = $1`,
      [branch.id, failure.reason.slice(0, 500), failure.stage],
    );
    await writeAuditEvent(
      {
        action: "provisioning.failed", organizationId: branch.organization_id,
        branchId: branch.id, actorUserId: ctx.actor.userId, resourceType: "branch",
        resourceId: branch.id, result: "failure", requestId: ctx.requestId ?? null,
        metadata: { stage: failure.stage, error_code: ErrorCode.PROVISIONING_FAILED },
      },
      tx,
    );
  });

  // Telemetry outside the transaction (diagnostic only).
  metrics.increment("provisioning_failed");
  logger.error("provisioning_failed", {
    operation: "provision_branch",
    organizationId: branch.organization_id,
    branchId: branch.id,
    stage: failure.stage,
    requestId: ctx.requestId ?? null,
  });
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export interface CreateBranchResult {
  branch: BranchRecord;
  created: boolean;
}

/**
 * Create a branch and run deterministic provisioning.
 * Errors surface as AppError with stable codes; the caller maps to Result.
 */
export async function createAndProvision(
  ctx: AuthContext,
  rawInput: unknown,
): Promise<CreateBranchResult> {
  // -- Authorization (first boundary; RLS is second) -------------------
  requirePermission(ctx, "branches.create");
  // Organization is resolved from the authenticated membership, never the body.
  // (rawInput.organization_id is rejected by the strict schema.)

  // -- Validation (API_STANDARDS.md §12) --------------------------------
  const parsed = createBranchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_root";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new AppError(ErrorCode.INVALID_INPUT, "Invalid branch input.", fieldErrors);
  }
  const input = parsed.data;
  requireOrganizationAccess(ctx, ctx.actor.organizationId);

  // Idempotency: same slug → return the existing branch (no second run).
  const slug = normalizeSlug(input.slug);
  const existing = await findBranchBySlug(ctx.actor.organizationId, slug);
  if (existing) {
    metrics.increment("provisioning_duplicate_request");
    return { branch: existing, created: false };
  }

  // -- Telemetry: run start (outside transactions) ----------------------
  metrics.increment("provisioning_started");
  const startedAt = Date.now();

  // -- Tx1: branch record + branch.created audit ------------------------
  let branch: BranchRecord;
  try {
    branch = await withTransaction(async (tx) => {
      const res = await tx.query<BranchRecord>(
        `insert into public.branches (
           organization_id, name, slug, status, provisioning_status,
           country_code, timezone, currency, locale, enabled_locales,
           phone, email, service_area
         ) values ($1, $2, $3, 'provisioning', 'pending', $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)
         returning *`,
        [
          ctx.actor.organizationId, input.name, slug,
          input.country_code, input.timezone, input.currency,
          input.default_locale, JSON.stringify(input.enabled_locales),
          input.contact?.phone ?? null, input.contact?.email ?? null,
          input.service_area ? JSON.stringify(input.service_area) : null,
        ],
      );
      const created = res.rows[0];
      await writeAuditEvent(
        {
          action: "branch.created", organizationId: ctx.actor.organizationId,
          branchId: created.id, actorUserId: ctx.actor.userId, resourceType: "branch",
          resourceId: created.id, requestId: ctx.requestId ?? null,
          metadata: { name: input.name, slug, default_locale: input.default_locale },
        },
        tx,
      );
      return created;
    });
  } catch (err) {
    // Unique violation on (organization_id, slug): concurrent duplicate.
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      const dup = await findBranchBySlug(ctx.actor.organizationId, slug);
      if (dup) {
        metrics.increment("provisioning_duplicate_request");
        return { branch: dup, created: false };
      }
    }
    throw err;
  }

  // Telemetry after Tx1 commit.
  logger.info("provisioning_started", {
    operation: "provision_branch", organizationId: branch.organization_id,
    branchId: branch.id, requestId: ctx.requestId ?? null,
  });

  // -- Tx2: provisioning content (all-or-nothing) -----------------------
  try {
    await withTransaction((tx) => provisionWebsiteFoundation(tx, branch, input, ctx));
  } catch (err) {
    const failure =
      err instanceof ProvisioningFailure
        ? err
        : new ProvisioningFailure("provisioning", err instanceof Error ? err.message : "unknown");
    // Tx3 — committed failure marking (survives the Tx2 rollback).
    await markProvisioningFailed(branch, failure, ctx);
    throw new AppError(
      ErrorCode.PROVISIONING_FAILED,
      "Branch provisioning failed; the branch is in a recoverable state.",
      undefined,
      { stage: failure.stage, branchId: branch.id },
    );
  }

  // Telemetry after Tx2 commit.
  metrics.increment("provisioning_completed");
  metrics.observeDuration("provisioning_duration_ms", Date.now() - startedAt);
  logger.info("provisioning_completed", {
    operation: "provision_branch", organizationId: branch.organization_id,
    branchId: branch.id, durationMs: Date.now() - startedAt,
    requestId: ctx.requestId ?? null,
  });

  const fresh = await findBranchBySlug(ctx.actor.organizationId, slug);
  return { branch: fresh ?? branch, created: true };
}

// ---------------------------------------------------------------------
// Retry — guarded conditional transition (design §4)
// ---------------------------------------------------------------------

export async function retryProvisioning(
  ctx: AuthContext,
  branchId: string,
): Promise<BranchRecord> {
  requirePermission(ctx, "branches.create");
  requireOrganizationAccess(ctx, ctx.actor.organizationId);

  const branch = await getBranchById(branchId);
  if (!branch || branch.organization_id !== ctx.actor.organizationId) {
    throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  }

  // No-op when already provisioned (spec: retry of a ready branch).
  if (branch.provisioning_status === "ready") {
    metrics.increment("provisioning_retry_noop");
    return branch;
  }

  // Guarded conditional transition failed/pending → provisioning: exactly one
  // concurrent retry wins; the loser re-reads current status (atomic
  // state-transition pattern, DATABASE.md §56). 'pending' is included to
  // recover a run that crashed between Tx1 and Tx2.
  const guard = await query(
    `update public.branches
        set provisioning_status = 'provisioning',
            provisioning_error = null,
            provisioning_stage = null,
            updated_at = now()
      where id = $1 and provisioning_status in ('failed', 'pending')
      returning *`,
    [branchId],
  );
  if (guard.rows.length === 0) {
    // Someone else won the transition (or status changed) — return current.
    metrics.increment("provisioning_retry_contended");
    const current = await getBranchById(branchId);
    return current ?? branch;
  }

  const current = guard.rows[0] as BranchRecord;

  // Audit: retry started — durable committed record of the attempt.
  await writeAuditEvent({
    action: "provisioning.retry_started", organizationId: current.organization_id,
    branchId: current.id, actorUserId: ctx.actor.userId, resourceType: "branch",
    resourceId: current.id, requestId: ctx.requestId ?? null,
    metadata: { attempt: current.provisioning_attempts + 1 },
  });

  metrics.increment("provisioning_retried");
  const startedAt = Date.now();

  // Re-run Tx2 using the SAME natural-key idempotent inserts.
  try {
    const input = branchInputFromRecord(current);
    await withTransaction((tx) =>
      provisionWebsiteFoundation(tx, current, input, ctx),
    );
  } catch (err) {
    const failure =
      err instanceof ProvisioningFailure
        ? err
        : new ProvisioningFailure("provisioning", err instanceof Error ? err.message : "unknown");
    await markProvisioningFailed(current, failure, ctx);
    throw new AppError(ErrorCode.PROVISIONING_FAILED, "Provisioning retry failed.", undefined, { stage: failure.stage });
  }

  metrics.observeDuration("provisioning_duration_ms", Date.now() - startedAt);
  logger.info("provisioning_retry_completed", {
    organizationId: current.organization_id, branchId: current.id,
    durationMs: Date.now() - startedAt, requestId: ctx.requestId ?? null,
  });

  const fresh = await getBranchById(branchId);
  return fresh ?? current;
}

/** Reconstruct creation input from a persisted branch row (retry path). */
function branchInputFromRecord(b: BranchRecord): CreateBranchInput {
  return {
    name: b.name,
    slug: b.slug,
    country_code: b.country_code as string,
    timezone: b.timezone as string,
    currency: b.currency as CreateBranchInput["currency"],
    default_locale: b.locale as CreateBranchInput["default_locale"],
    enabled_locales: (b.enabled_locales as string[]) as CreateBranchInput["enabled_locales"],
  };
}

// ---------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------

export async function getBranchById(branchId: string): Promise<BranchRecord | null> {
  const res = await query<BranchRecord>(`select * from public.branches where id = $1`, [branchId]);
  return res.rows[0] ?? null;
}

export interface ListBranchesOptions {
  organizationId: string;
  /** Branch-scoped viewers only see assigned branches (BRANCH_SYSTEM §12). */
  branchIds?: string[] | null;
}

export async function listBranches(opts: ListBranchesOptions): Promise<BranchRecord[]> {
  if (opts.branchIds && opts.branchIds.length === 0) return [];
  const res = opts.branchIds
    ? await query<BranchRecord>(
        `select * from public.branches where organization_id = $1 and id = any($2::uuid[]) order by created_at desc`,
        [opts.organizationId, opts.branchIds],
      )
    : await query<BranchRecord>(
        `select * from public.branches where organization_id = $1 order by created_at desc`,
        [opts.organizationId],
      );
  return res.rows;
}
