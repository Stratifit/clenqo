/**
 * Domain test harness — wires the real domain service to pglite via the
 * test executor injection, with real actor resolution from fixture data.
 */
import { getTestDb, type TestDb } from "./db";import { setExecutorForTests } from "@/lib/db/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import type { CreateBranchInput } from "@/features/branches/schemas/create-branch";

let wired: TestDb | null = null;

export async function getDomainHarness(): Promise<TestDb> {
  if (wired) return wired;
  const testDb = await getTestDb();
  setExecutorForTests(testDb.db); // privileged executor = pglite superuser
  wired = testDb;
  return testDb;
}

export async function hqAdminContext(orgId: string, email: string): Promise<AuthContext> {
  const testDb = await getDomainHarness();
  const userId = await testDb.fx.createUser(email);
  await testDb.fx.createMembership(userId, orgId, "hq_admin");
  const ctx = await resolveActor(userId);
  ctx.requestId = `req-test-${Math.random().toString(36).slice(2)}`;
  return ctx;
}

export const VALID_BRANCH_INPUT: CreateBranchInput = {
  name: "Berlin",
  slug: "berlin",
  country_code: "DE",
  timezone: "Europe/Berlin",
  currency: "EUR",
  default_locale: "de",
  enabled_locales: ["de", "en"],
};

/**
 * Failure-injection hook: when set, the provisionWebsiteFoundation step throws
 * at the requested stage. Implemented via a module-level seam in the service
 * (see features/branches/service.ts → setProvisioningFailureHookForTests).
 */
export interface FailureHook {
  stage: string;
  once?: boolean;
}

let activeFailure: FailureHook | null = null;

export function setFailureHook(hook: FailureHook | null): void {
  activeFailure = hook;
}

export function consumeFailureHook(stage: string): boolean {
  if (activeFailure && activeFailure.stage === stage) {
    if (activeFailure.once) activeFailure = null;
    return true;
  }
  return false;
}
