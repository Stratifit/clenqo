"use server";

/**
 * Server Actions for branch administration (API_STANDARDS.md §4: thin —
 * authenticate → authorize → validate → domain service → typed result).
 * No business logic lives here; all logic is in the domain service.
 */
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, hasBranchScope, type AuthContext } from "@/lib/authorization/server";
import { ErrorCode, fail, ok, toAppError, type Result } from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import { getBranchById, listBranches, retryProvisioning, createAndProvision, type BranchRecord } from "./service";
import { checkActivationReadiness, activateBranch, type ActivationCheckResult } from "./activation";
import { randomUUID } from "node:crypto";

/** Build the auth context for the current request with a correlation ID. */
async function currentContext(): Promise<AuthContext> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  ctx.requestId = randomUUID();
  return ctx;
}

/** Wrap a domain operation into the typed Result envelope. */
async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    const appErr = toAppError(err);
    if (appErr.code === "INTERNAL_ERROR") {
      logger.error("unhandled_domain_error", { error: String(err) });
    }
    return fail(appErr.code, appErr.message, {
      fieldErrors: appErr.fieldErrors,
    });
  }
}

export async function createBranchAction(
  input: unknown,
): Promise<Result<CreateBranchResult>> {
  try {
    const ctx = await currentContext();
    const result = await createAndProvision(ctx, input);
    return ok(result, ctx.requestId);
  } catch (err) {
    const appErr = toAppError(err);
    if (appErr.code === "INTERNAL_ERROR") {
      logger.error("create_branch_failed", { error: String(err) });
    }
    return fail(appErr.code, appErr.message, {
      fieldErrors: appErr.fieldErrors,
    });
  }
}

export type CreateBranchResult = Awaited<ReturnType<typeof createAndProvision>>;

export async function retryProvisioningAction(
  branchId: string,
): Promise<Result<BranchRecord>> {
  return run(async () => {
    const ctx = await currentContext();
    const branch = await retryProvisioning(ctx, branchId);
    return branch;
  });
}

export async function getBranchAction(
  branchId: string,
): Promise<Result<BranchRecord>> {
  try {
    const ctx = await currentContext();
    if (!(await hasBranchScope(ctx, branchId))) {
      return fail(ErrorCode.FORBIDDEN, "Branch scope required.");
    }
    const branch = await getBranchById(branchId);
    if (!branch || branch.organization_id !== ctx.actor.organizationId) {
      return fail(ErrorCode.NOT_FOUND, "Branch not found.");
    }
    return ok(branch);
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message);
  }
}

export async function listBranchesAction(): Promise<Result<BranchRecord[]>> {
  return run(async () => {
    const ctx = await currentContext();
    if (ctx.actor.role === "hq_admin" || ctx.actor.role === "hq_staff") {
      return listBranches({ organizationId: ctx.actor.organizationId });
    }
    // Branch-scoped roles: only assigned branches (BRANCH_SYSTEM §12).
    const { query } = await import("@/lib/db/server");
    const res = await query<{ branch_id: string }>(
      `select branch_id from public.membership_branches where membership_id = $1`,
      [ctx.actor.membershipId],
    );
    return listBranches({
      organizationId: ctx.actor.organizationId,
      branchIds: res.rows.map((r) => r.branch_id),
    });
  });
}

export async function checkActivationReadinessAction(
  branchId: string,
): Promise<Result<ActivationCheckResult>> {
  return run(async () => {
    const ctx = await currentContext();
    return checkActivationReadiness(ctx, branchId);
  });
}

export async function activateBranchAction(
  branchId: string,
  overrideReason?: string,
): Promise<Result<BranchRecord>> {
  return run(async () => {
    const ctx = await currentContext();
    return activateBranch(ctx, branchId, overrideReason ? { overrideReason } : undefined);
  });
}
