/**
 * Admin foundation domain services (Change 8, design §6/§7/§11):
 * one-time HQ bootstrap (BD-A1), staff invitation, deactivation.
 *
 * SECURITY: server-only. Service-role credentials never reach the client.
 * Every path is fail-closed and audited through the existing audit
 * infrastructure (design §13); no second audit architecture.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "@/lib/db/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { hasBranchScope, requirePermission, type AuthContext } from "@/lib/authorization/server";

/** Canonical roles invitable through the admin foundation (BD-A3: no new roles). */
const INVITABLE_ROLES = new Set(["hq_admin", "hq_staff", "branch_manager"]);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Supabase service configuration missing.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** True when Supabase Auth admin API is reachable (hosted). In pglite tests
 *  it is not; the existing-user path still works against local auth.users. */
function hasServiceConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Constant-time token comparison; never logs the token. */
function verifySetupToken(presented: string | null | undefined): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The bootstrap invariant: zero active HQ Admin memberships. */
export async function hasActiveHqAdmin(): Promise<boolean> {
  const res = await query<{ exists: boolean }>(
    `select exists(
       select 1 from public.memberships
       where role = 'hq_admin' and status = 'active'
     ) as exists`,
  );
  return res.rows[0]?.exists === true;
}

export interface SetupResult {
  organizationId: string;
  userId: string;
}

/** Stable wording of the permanent bootstrap lock (BD-A1). */
const SETUP_DISABLED_MESSAGE = "Setup is permanently disabled after bootstrap.";

/** Fixed advisory-lock key: serializes one-time bootstrap (single-flight). */
const SETUP_LOCK_KEY = 918273645;

/**
 * Audit a setup rejection against COMMITTED state, after the aborted
 * attempt transaction has rolled back — the rejection record must survive
 * the rollback of the failed attempt itself. Best-effort: never masks the
 * primary stable error. Pre-bootstrap there is no organization to
 * attribute the rejection to.
 */
async function auditSetupRejection(actorUserId: string, reason: string): Promise<void> {
  try {
    const orgId = (
      await query<{ id: string }>(`select id from public.organizations order by created_at asc limit 1`)
    ).rows[0]?.id;
    if (!orgId) return;
    await writeAuditEvent({
      action: "admin.setup_rejected",
      organizationId: orgId,
      actorUserId,
      resourceType: "organization",
      result: "failure",
      metadata: { reason },
    });
  } catch {
    // The stable error is authoritative; audit is best-effort on rejections.
  }
}

/**
 * One-time HQ bootstrap (BD-A1, design §6). Permanently fail-closed once
 * an active HQ Admin exists: the invariant is enforced against committed
 * state up front and re-checked at the serialization point, and the
 * membership insert is guarded (`where not exists`), so concurrent
 * attempts can never create a second active HQ Admin even when the
 * advisory lock cannot serialize the executor (single-session test DBs).
 * Rejection audits are written after rollback so they persist.
 */
export async function performSetup(input: {
  setupToken: string | null | undefined;
  userId: string;
  organizationName?: string;
}): Promise<SetupResult> {
  // Fast-path invariant against committed state — also makes setup
  // fail closed before any token work once bootstrapped.
  if (await hasActiveHqAdmin()) {
    await auditSetupRejection(input.userId, "already_bootstrapped");
    throw new AppError(ErrorCode.FORBIDDEN, SETUP_DISABLED_MESSAGE);
  }

  try {
    return await withTransaction(async (tx) => {
      // Serialize concurrent bootstrap attempts (single-flight; the lock
      // releases automatically at commit/rollback).
      await tx.query(`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);

      // 1. Token check (constant-time; the token is never logged).
      if (!verifySetupToken(input.setupToken)) {
        // Pre-bootstrap there is no organization to attribute the audit to;
        // the attempt is still observable via the thrown stable error.
        throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid setup token.");
      }

      // 2. Invariant re-check at the serialization point.
      if (await hasActiveHqAdmin()) {
        throw new AppError(ErrorCode.FORBIDDEN, SETUP_DISABLED_MESSAGE);
      }

    // 3. The auth user must already exist (created via the Supabase Auth
    //    admin surface before setup — BD-A1). Verify rather than assume.
    const userRes = await tx
      .query<{ id: string }>(`select id from auth.users where id = $1`, [input.userId])
      .catch(() => ({ rows: [] as { id: string }[] }));
    if (!userRes.rows[0]) {
      throw new AppError(ErrorCode.NOT_FOUND, "Setup user does not exist in Supabase Auth.");
    }

    // 4. Transactional creation: initial organization (if none) + HQ Admin membership.
    const orgRes = await tx.query<{ id: string }>(
      `select id from public.organizations order by created_at asc limit 1`,
    );
    let organizationId = orgRes.rows[0]?.id;
    if (!organizationId) {
      // organizations.slug is NOT NULL UNIQUE — derive a provisional unique
      // slug from the name (slugified, suffixed when needed). Renaming the
      // organization later is a normal admin operation; this is bootstrap only.
      const baseSlug =
        (input.organizationName?.trim() || "clenqo")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "clenqo";
      let slug = baseSlug;
      for (let attempt = 0; attempt < 50; attempt++) {
        const taken = await tx.query<{ id: string }>(
          `select id from public.organizations where slug = $1`,
          [slug],
        );
        if (!taken.rows[0]) break;
        slug = `${baseSlug}-${attempt + 2}`;
      }
      const created = await tx.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ($1, $2) returning id`,
        [input.organizationName?.trim() || "CLENQO", slug],
      );
      organizationId = created.rows[0].id;
    }

    // 5. Guarded HQ Admin insert (atomic state transition, DATABASE.md §56):
    //    inserts only while zero active HQ Admin memberships exist. On
    //    contention (another attempt committed first) the guard yields no
    //    row and this attempt is rejected — exactly one HQ Admin ever.
    const insertRes = await tx.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status)
       select $1, $2, 'hq_admin', 'active'
       where not exists (
         select 1 from public.memberships
         where role = 'hq_admin' and status = 'active'
       )
       returning id`,
      [organizationId, input.userId],
    );
    if (insertRes.rows.length === 0) {
      throw new AppError(ErrorCode.FORBIDDEN, SETUP_DISABLED_MESSAGE);
    }

    await writeAuditEvent(
      {
        action: "admin.setup_completed",
        organizationId,
        actorUserId: input.userId,
        resourceType: "organization",
        resourceId: organizationId,
        metadata: { bootstrap: true },
      },
      tx as never,
    );

    return { organizationId, userId: input.userId };
    });
  } catch (err) {
    // Rejection audits must survive the rollback of the failed attempt.
    if (err instanceof AppError && err.message === SETUP_DISABLED_MESSAGE) {
      await auditSetupRejection(input.userId, "already_bootstrapped");
    }
    throw err;
  }
}

export interface InviteResult {
  membershipId: string;
  invited: boolean;
}

/**
 * Staff invitation (design §11). Gated by the canonical `users.invite`
 * permission. New auth users go through Supabase `inviteUserByEmail`;
 * existing users receive membership/scope directly without a duplicate
 * invitation. Membership + scope + audit commit atomically.
 */
export async function inviteStaffMember(
  ctx: AuthContext,
  input: { email: string; role: string; branchIds?: string[] },
): Promise<InviteResult> {
  requirePermission(ctx, "users.invite");

  if (!INVITABLE_ROLES.has(input.role)) {
    throw new AppError(ErrorCode.INVALID_INPUT, "Unknown role.");
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AppError(ErrorCode.INVALID_INPUT, "Valid email required.");
  }
  const branchIds = input.branchIds ?? [];
  if (input.role === "branch_manager" && branchIds.length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, "Branch managers require at least one branch scope.");
  }
  for (const branchId of branchIds) {
    if (!(await hasBranchScope(ctx, branchId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
  }

  const supabase = hasServiceConfig() ? serviceClient() : null;
  let invited = false;
  let userId: string;

  const existing = await query<{ id: string }>(
    `select id from auth.users where lower(email) = $1 limit 1`,
    [email],
  ).catch(() => ({ rows: [] as { id: string }[] }));

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
  } else if (supabase) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Invitation failed.");
    }
    userId = data.user.id;
    invited = true;
  } else {
    // No hosted Auth available (local/pglite): fail closed — never create a
    // membership without an auth user.
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Invitation failed.");
  }

  return withTransaction(async (tx) => {
    // Duplicate protection: UNIQUE(organization_id, user_id) plus an explicit
    // pre-check so callers get a stable error instead of a constraint name.
    const dup = await tx.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2`,
      [ctx.actor.organizationId, userId],
    );
    if (dup.rows[0]) {
      throw new AppError(ErrorCode.CONFLICT, "User already has a membership in this organization.");
    }

    const membership = await tx.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status)
       values ($1, $2, $3, 'active') returning id`,
      [ctx.actor.organizationId, userId, input.role],
    );
    const membershipId = membership.rows[0].id;

    for (const branchId of branchIds) {
      await tx.query(
        `insert into public.membership_branches (membership_id, branch_id) values ($1, $2)`,
        [membershipId, branchId],
      );
    }

    await writeAuditEvent(
      {
        action: "admin.user_invited",
        organizationId: ctx.actor.organizationId,
        actorUserId: ctx.actor.userId,
        resourceType: "membership",
        resourceId: membershipId,
        metadata: { role: input.role, invited, branch_count: branchIds.length },
      },
      tx as never,
    );

    return { membershipId, invited };
  });
}

/**
 * Resend an invitation through the approved primitive (design §11). Never
 * creates a duplicate membership; membership must already exist.
 */
export async function resendInvitation(ctx: AuthContext, email: string): Promise<void> {
  requirePermission(ctx, "users.invite");
  const normalized = email.trim().toLowerCase();
  const membership = await query<{ id: string; user_id: string; status: string }>(
    `select m.id, m.user_id, m.status
     from public.memberships m
     join auth.users u on u.id = m.user_id
     where lower(u.email) = $1 and m.organization_id = $2`,
    [normalized, ctx.actor.organizationId],
  ).catch(() => ({ rows: [] as { id: string; user_id: string; status: string }[] }));
  if (!membership.rows[0]) {
    throw new AppError(ErrorCode.NOT_FOUND, "No membership for this email.");
  }
  if (!hasServiceConfig()) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Resend failed.");
  }
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.inviteUserByEmail(normalized);
  if (error) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Resend failed.");
  }
  await writeAuditEvent({
    action: "admin.invitation_resent",
    organizationId: ctx.actor.organizationId,
    actorUserId: ctx.actor.userId,
    resourceType: "membership",
    resourceId: membership.rows[0].id,
  });
}

/**
 * Deactivate a staff membership (design §11): status-only; the auth user is
 * never deleted. Audited.
 */
export async function deactivateStaffMember(ctx: AuthContext, membershipId: string): Promise<void> {
  requirePermission(ctx, "users.edit");
  const res = await query<{ organization_id: string; user_id: string }>(
    `update public.memberships set status = 'inactive', updated_at = now()
     where id = $1 and organization_id = $2
     returning organization_id, user_id`,
    [membershipId, ctx.actor.organizationId],
  );
  if (!res.rows[0]) {
    throw new AppError(ErrorCode.NOT_FOUND, "Membership not found.");
  }
  await writeAuditEvent({
    action: "admin.user_deactivated",
    organizationId: ctx.actor.organizationId,
    actorUserId: ctx.actor.userId,
    resourceType: "membership",
    resourceId: membershipId,
    metadata: { deactivated_user: res.rows[0].user_id },
  });
}
