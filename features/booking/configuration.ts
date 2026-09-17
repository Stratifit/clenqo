/**
 * Booking configuration domain (Change 5, tasks 5.1–5.3).
 *
 *   - Branch cancellation policies (BD-2): versioned, effective-dated,
 *     publish-immutable (P17 mechanics reused from 0010); the confirmed
 *     booking captures the published policy snapshot effective at the
 *     service date.
 *   - Branch service areas (BD-6): per-branch postal-code allowlist,
 *     managed through the existing `branches.edit` permission (no new
 *     permission names).
 *   - Booking numbers (BD-5): `CLN-<year>-<sequence>` from ONE monotonic
 *     per-organization counter; row-locked transactional allocation; the
 *     year comes from the branch-local service date and the counter never
 *     resets, so uniqueness holds deterministically across year
 *     boundaries (DB UNIQUE (organization_id, booking_number) is the
 *     last-line guard).
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { bookingError, BookingErrorCode } from "./errors";
import {
  createCancellationPolicySchema,
  publishCancellationPolicySchema,
  setServiceAreasSchema,
} from "./schemas/booking";

// ---------------------------------------------------------------------------
// Cancellation policy tiers (BD-2)
// ---------------------------------------------------------------------------

export interface CancellationTier {
  min_hours: number;
  max_hours: number | null;
  percent: number;
}

export interface CancellationPolicyRow {
  id: string;
  branch_id: string;
  organization_id: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  effective_from: string;
  effective_until: string | null;
  tiers: CancellationTier[];
}

/**
 * Resolve the published cancellation policy effective at the service date
 * (BD-2: branch-configurable, versioned, effective-dated). Overlap of
 * published windows is DB-rejected, so at most one candidate exists.
 */
export async function resolveCancellationPolicy(
  branchId: string,
  serviceDate: string,
  tx?: TransactionClient,
): Promise<CancellationPolicyRow> {
  const client = tx ?? { query };
  const res = await client.query<CancellationPolicyRow>(
    `select id, branch_id, organization_id, version_number, status,
            effective_from::text, effective_until::text, tiers
     from public.branch_cancellation_policies
     where branch_id = $1 and status = 'published'
       and effective_from <= $2::date
       and (effective_until is null or effective_until >= $2::date)
     order by effective_from desc limit 1`,
    [branchId, serviceDate],
  );
  const row = res.rows[0];
  if (!row) {
    throw bookingError(BookingErrorCode.POLICY_NOT_FOUND);
  }
  return row;
}

/**
 * Apply a tier set to a notice (hours remaining until scheduled_start).
 * Bands are [min_hours, max_hours): exactly 24h → 0%, exactly 12h → 25%,
 * exactly 2h → 50% (BD-2 boundary interpretation).
 */
export function tierForNotice(
  tiers: CancellationTier[],
  noticeHours: number,
): CancellationTier | null {
  for (const tier of tiers) {
    const upper = tier.max_hours ?? Number.POSITIVE_INFINITY;
    if (noticeHours >= tier.min_hours && noticeHours < upper) return tier;
  }
  return null;
}

// -- Policy CRUD ------------------------------------------------------------

async function requireBranchForConfig(
  ctx: AuthContext,
  branchId: string,
): Promise<{ id: string; organizationId: string }> {
  const res = await query<{ id: string; organization_id: string }>(
    `select id, organization_id from public.branches where id = $1`,
    [branchId],
  );
  const branch = res.rows[0];
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  requireOrganizationAccess(ctx, branch.organization_id);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return { id: branch.id, organizationId: branch.organization_id };
}

/** Create a draft cancellation policy version (branches.edit; BD-2). */
export async function createCancellationPolicy(
  ctx: AuthContext,
  raw: unknown,
): Promise<CancellationPolicyRow> {
  requirePermission(ctx, "branches.edit");
  const input = createCancellationPolicySchema.parse(raw);
  const branch = await requireBranchForConfig(ctx, input.branch_id);

  return withTransaction(async (tx) => {
    const next = await tx.query<{ n: string }>(
      `select coalesce(max(version_number), 0) + 1 as n
       from public.branch_cancellation_policies where branch_id = $1`,
      [branch.id],
    );
    const versionNumber = Number(next.rows[0].n);
    const res = await tx.query<CancellationPolicyRow>(
      `insert into public.branch_cancellation_policies
         (organization_id, branch_id, version_number, status, effective_from, effective_until, tiers)
       values ($1, $2, $3, 'draft', $4::date, $5::date, $6::jsonb)
       returning id, branch_id, organization_id, version_number, status,
                 effective_from::text, effective_until::text, tiers`,
      [
        branch.organizationId,
        branch.id,
        versionNumber,
        input.effective_from,
        input.effective_until ?? null,
        JSON.stringify(input.tiers),
      ],
    );
    await writeAuditEvent(
      {
        action: "cancellation_policy.created",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_cancellation_policies",
        resourceId: res.rows[0].id,
        requestId: ctx.requestId ?? null,
        metadata: { version_number: versionNumber, effective_from: input.effective_from },
      },
      tx,
    );
    return res.rows[0];
  });
}

/** Publish a draft policy (branches.edit; P17 overlap guard mirrors 0010). */
export async function publishCancellationPolicy(
  ctx: AuthContext,
  policyId: string,
  raw: unknown,
): Promise<CancellationPolicyRow> {
  requirePermission(ctx, "branches.edit");
  const input = publishCancellationPolicySchema.parse(raw);

  return withTransaction(async (tx) => {
    const existing = await tx.query<CancellationPolicyRow & { status: string }>(
      `select id, branch_id, organization_id, version_number, status,
              effective_from::text, effective_until::text, tiers
       from public.branch_cancellation_policies where id = $1`,
      [policyId],
    );
    const policy = existing.rows[0];
    if (!policy) throw new AppError(ErrorCode.NOT_FOUND, "Cancellation policy not found.");
    requireOrganizationAccess(ctx, policy.organization_id);
    if (!(await hasBranchScope(ctx, policy.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    if (policy.status !== "draft") {
      throw new AppError(ErrorCode.CONFLICT, "Only draft policies can be published.");
    }

    const effectiveFrom = input.effective_from ?? policy.effective_from;
    const effectiveUntil =
      input.effective_until !== undefined ? input.effective_until : policy.effective_until;
    if (effectiveUntil !== null && effectiveUntil < effectiveFrom) {
      throw bookingError(BookingErrorCode.POLICY_NOT_FOUND, {
        reason: "effective_until precedes effective_from",
      });
    }
    const overlap = await tx.query<{ id: string }>(
      `select id from public.branch_cancellation_policies
       where branch_id = $1 and status = 'published' and id <> $2
         and daterange(effective_from, effective_until, '[]')
             && daterange($3::date, $4::date, '[]')`,
      [policy.branch_id, policyId, effectiveFrom, effectiveUntil],
    );
    if (overlap.rows[0]) {
      throw new AppError(ErrorCode.CONFLICT, "The effective window overlaps a published policy.");
    }

    const res = await tx.query<CancellationPolicyRow>(
      `update public.branch_cancellation_policies
       set status = 'published', effective_from = $2::date, effective_until = $3::date,
           published_at = now(), updated_at = now()
       where id = $1
       returning id, branch_id, organization_id, version_number, status,
                 effective_from::text, effective_until::text, tiers`,
      [policyId, effectiveFrom, effectiveUntil],
    );
    await writeAuditEvent(
      {
        action: "cancellation_policy.updated",
        organizationId: policy.organization_id,
        branchId: policy.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_cancellation_policies",
        resourceId: policyId,
        requestId: ctx.requestId ?? null,
        metadata: { kind: "published", version_number: policy.version_number },
      },
      tx,
    );
    return res.rows[0];
  });
}

/** Archive a published policy (branches.edit; content-identical transition). */
export async function archiveCancellationPolicy(
  ctx: AuthContext,
  policyId: string,
): Promise<CancellationPolicyRow> {
  requirePermission(ctx, "branches.edit");
  return withTransaction(async (tx) => {
    const existing = await tx.query<CancellationPolicyRow>(
      `select id, branch_id, organization_id, version_number, status,
              effective_from::text, effective_until::text, tiers
       from public.branch_cancellation_policies where id = $1`,
      [policyId],
    );
    const policy = existing.rows[0];
    if (!policy) throw new AppError(ErrorCode.NOT_FOUND, "Cancellation policy not found.");
    requireOrganizationAccess(ctx, policy.organization_id);
    if (!(await hasBranchScope(ctx, policy.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    if (policy.status !== "published") {
      throw new AppError(ErrorCode.CONFLICT, "Only published policies can be archived.");
    }
    const res = await tx.query<CancellationPolicyRow>(
      `update public.branch_cancellation_policies
       set status = 'archived', updated_at = now()
       where id = $1
       returning id, branch_id, organization_id, version_number, status,
                 effective_from::text, effective_until::text, tiers`,
      [policyId],
    );
    await writeAuditEvent(
      {
        action: "cancellation_policy.updated",
        organizationId: policy.organization_id,
        branchId: policy.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_cancellation_policies",
        resourceId: policyId,
        requestId: ctx.requestId ?? null,
        metadata: { kind: "archived", version_number: policy.version_number },
      },
      tx,
    );
    return res.rows[0];
  });
}

export async function listCancellationPolicies(
  ctx: AuthContext,
  branchId: string,
): Promise<CancellationPolicyRow[]> {
  requirePermission(ctx, "branches.view");
  const branch = await requireBranchForConfig(ctx, branchId);
  void branch;
  const res = await query<CancellationPolicyRow>(
    `select id, branch_id, organization_id, version_number, status,
            effective_from::text, effective_until::text, tiers
     from public.branch_cancellation_policies where branch_id = $1
     order by version_number desc`,
    [branchId],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Service areas (BD-6)
// ---------------------------------------------------------------------------

export async function listServiceAreas(
  ctx: AuthContext,
  branchId: string,
): Promise<string[]> {
  requirePermission(ctx, "branches.view");
  await requireBranchForConfig(ctx, branchId);
  const res = await query<{ postal_code: string }>(
    `select postal_code from public.branch_service_areas where branch_id = $1 order by postal_code`,
    [branchId],
  );
  return res.rows.map((r) => r.postal_code);
}

/** Replace the branch allowlist (branches.edit; BD-6). */
export async function setServiceAreas(
  ctx: AuthContext,
  raw: unknown,
): Promise<string[]> {
  requirePermission(ctx, "branches.edit");
  const input = setServiceAreasSchema.parse(raw);
  const branch = await requireBranchForConfig(ctx, input.branch_id);

  return withTransaction(async (tx) => {
    await tx.query(`delete from public.branch_service_areas where branch_id = $1`, [branch.id]);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const code of input.postal_codes) {
      const trimmed = code.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        unique.push(trimmed);
      }
    }
    for (const code of unique) {
      await tx.query(
        `insert into public.branch_service_areas (organization_id, branch_id, postal_code)
         values ($1, $2, $3)`,
        [branch.organizationId, branch.id, code],
      );
    }
    await writeAuditEvent(
      {
        action: "service_area.updated",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_service_areas",
        resourceId: branch.id,
        requestId: ctx.requestId ?? null,
        metadata: { count: unique.length },
      },
      tx,
    );
    return unique;
  });
}

/** BD-6 gate: is the postal code allowlisted for this branch? */
export async function isPostalCodeServed(
  branchId: string,
  postalCode: string,
  tx?: TransactionClient,
): Promise<boolean> {
  const client = tx ?? { query };
  const res = await client.query<{ exists: boolean }>(
    `select exists(
       select 1 from public.branch_service_areas
       where branch_id = $1 and postal_code = $2
     ) as exists`,
    [branchId, postalCode],
  );
  return res.rows[0]?.exists === true;
}

// ---------------------------------------------------------------------------
// Booking numbers (BD-5)
// ---------------------------------------------------------------------------

/** Render `CLN-<year>-<seq 6 digits>` (BD-5 normative format). */
export function formatBookingNumber(year: number, sequence: number): string {
  return `CLN-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next booking number for the organization (BD-5). Row-locks
 * the single monotonic counter row (insert-on-demand); the year comes from
 * the caller's branch-local service date. The counter never resets, so a
 * year boundary cannot produce a duplicate number. MUST run inside the
 * confirmation/reschedule transaction.
 */
export async function allocateBookingNumber(
  tx: TransactionClient,
  organizationId: string,
  year: number,
): Promise<string> {
  // Upsert with row lock: concurrent confirmations serialize here (BD-5
  // concurrent-confirmation scenario receives distinct sequential numbers).
  const res = await tx.query<{ last_sequence: string }>(
    `insert into public.booking_number_sequences (organization_id, last_sequence)
     values ($1, 1)
     on conflict (organization_id) do update
       set last_sequence = public.booking_number_sequences.last_sequence + 1,
           updated_at = now()
     returning last_sequence`,
    [organizationId],
  );
  const seq = Number(res.rows[0].last_sequence);
  return formatBookingNumber(year, seq);
}
