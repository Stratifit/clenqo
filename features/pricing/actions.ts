"use server";

/**
 * Server Actions for the Pricing Engine (Change 4A, task 4.5; API_STANDARDS
 * §4: authenticate → authorize → validate → domain service → typed result;
 * no business logic here — everything is delegated to features/pricing/*).
 *
 * P19: no UI ships in this change — actions exist so the domain is reachable
 * through the established Server-Action surface only. Authorization is
 * enforced inside the domain service (P20, existing pricing.* permissions).
 */
import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
import {
  archiveVersion,
  createProfile,
  createRule,
  createVersion,
  listProfiles,
  listRules,
  listVersions,
  publishVersion,
  updateProfile,
  type PricingProfile,
  type PricingRule,
  type PricingVersion,
} from "./service";
import { calculateQuote, type QuoteResult } from "./quote";
import { seedPricingDefaults, type PricingSeedResult } from "./seed";

async function currentContext(): Promise<AuthContext> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  ctx.requestId = randomUUID();
  return ctx;
}

function run<T>(fn: (ctx: AuthContext) => Promise<T>): Promise<Result<T>> {
  return (async () => {
    try {
      const ctx = await currentContext();
      return ok(await fn(ctx), ctx.requestId);
    } catch (err) {
      const appErr = toAppError(err);
      return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
    }
  })();
}

// -- Configuration ---------------------------------------------------------

export async function listPricingProfilesAction(branchId: string): Promise<Result<PricingProfile[]>> {
  return run((ctx) => listProfiles(ctx, branchId));
}

export async function createPricingProfileAction(input: unknown): Promise<Result<PricingProfile>> {
  return run((ctx) => createProfile(ctx, input as Parameters<typeof createProfile>[1]));
}

export async function updatePricingProfileAction(
  profileId: string,
  input: unknown,
): Promise<Result<PricingProfile>> {
  return run((ctx) => updateProfile(ctx, profileId, input as Parameters<typeof updateProfile>[2]));
}

export async function listPricingVersionsAction(profileId: string): Promise<Result<PricingVersion[]>> {
  return run((ctx) => listVersions(ctx, profileId));
}

export async function createPricingVersionAction(input: unknown): Promise<Result<PricingVersion>> {
  return run((ctx) => createVersion(ctx, input as Parameters<typeof createVersion>[1]));
}

export async function publishPricingVersionAction(input: unknown): Promise<Result<PricingVersion>> {
  return run((ctx) => {
    const { version_id, ...rest } = input as { version_id: string } & Record<string, unknown>;
    return publishVersion(ctx, version_id, rest as Parameters<typeof publishVersion>[2]);
  });
}

export async function archivePricingVersionAction(input: {
  version_id: string;
}): Promise<Result<PricingVersion>> {
  return run((ctx) => archiveVersion(ctx, input.version_id));
}

export async function listPricingRulesAction(versionId: string): Promise<Result<PricingRule[]>> {
  return run((ctx) => listRules(ctx, versionId));
}

export async function createPricingRuleAction(input: unknown): Promise<Result<PricingRule>> {
  return run((ctx) => createRule(ctx, input as Parameters<typeof createRule>[1]));
}

// -- Quote engine (stateless; P13) ----------------------------------------

export async function calculateQuoteAction(input: unknown): Promise<Result<QuoteResult>> {
  return run((ctx) => {
    void ctx;
    return calculateQuote(input as Parameters<typeof calculateQuote>[0]);
  });
}

// -- Seed (P18; structure-only) --------------------------------------------

export async function seedPricingDefaultsAction(branchId?: string): Promise<Result<PricingSeedResult>> {
  return run((ctx) => {
    void ctx;
    return seedPricingDefaults(branchId);
  });
}
