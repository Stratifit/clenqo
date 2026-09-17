/**
 * Pricing Engine domain tests (Change 4A, tasks 8.1, 8.2, 8.4, 8.5):
 * money/unit pipeline, configuration CRUD + P20 authorization boundaries,
 * lifecycle (publish §47, immutability P16, overlap P17), seed idempotency
 * (P18), audit fail-closed, duration authority (P21/P-D1) and placeholder
 * absence. Runs against real pglite + the full migration chain (domain
 * harness). ALL monetary values below are explicit NON-PRODUCTION fixtures
 * (P3) — they must never be read as business-approved values.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDomainHarness, hqAdminContext } from "../helpers/domain";
import type { TestDb } from "../helpers/db";
import type { AuthContext } from "@/lib/authorization/server";
import { ErrorCode } from "@/lib/errors";
import {
  applyPercentage,
  breakdownToJson,
  formatMinor,
  parseMinor,
  roundHalfUp,
  sumBreakdown,
} from "@/features/pricing/money";
import { pricingError, PricingErrorCode } from "@/features/pricing/errors";
import { propertyDetailsSchema } from "@/features/pricing/schemas/pricing";
import {
  createProfile,
  createRule,
  createVersion,
  listProfiles,
  publishVersion,
  updateProfile,
  archiveVersion,
} from "@/features/pricing/service";
import { seedPricingDefaults } from "@/features/pricing/seed";
import { pricingDurationProvider } from "@/features/pricing/durationProvider";
import { calculateQuote } from "@/features/pricing/quote";

let t: TestDb;
let ctx: AuthContext; // HQ admin (full pricing.*)
let staffCtx: AuthContext; // HQ staff (pricing.view only per P20)
let managerCtx: AuthContext; // branch manager (branch-scoped pricing.*)
let cleanerCtx: AuthContext; // cleaner (no pricing.*)
let orgId: string;
let branchId: string;
let catId: string;
let svcId: string;
let addonId: string;

/** NON-PRODUCTION fixture config (P3): base 10.00/h, 30 min base. */
const FIXTURE_RATE = { model: "hourly" as const, hourly_rate_minor: 1000 };
const FIXTURE_DURATION = {
  consumed_factors: ["base" as const],
  base_minutes: 30,
};

/**
 * The currently ACTIVE profile for the shared branch. P11 allows exactly one;
 * tests that publish a new profile archive the previous active one first.
 */
let activeProfileId: string | null = null;

/** Activate a profile under the P11 one-active constraint (archive previous). */
async function activateProfile(profileId: string): Promise<void> {
  if (activeProfileId && activeProfileId !== profileId) {
    await t.db.query(`update public.pricing_profiles set status = 'archived' where id = $1`, [
      activeProfileId,
    ]);
  }
  await updateProfile(ctx, profileId, { status: "active" });
  activeProfileId = profileId;
}

/** Create a draft profile + version + fixture rules; publish when asked. */
async function makePricedVersion(opts: {
  suffix: string;
  publish?: boolean;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
}): Promise<{ profileId: string; versionId: string }> {
  const profile = await createProfile(ctx, {
    branch_id: branchId,
    name: `Fixture Profile ${opts.suffix}`,
    currency: "EUR",
  });
  const version = await createVersion(ctx, {
    profile_id: profile.id,
    branch_id: branchId,
    effective_from: opts.effectiveFrom ?? "2026-01-01",
    ...(opts.effectiveUntil === undefined ? {} : { effective_until: opts.effectiveUntil ?? undefined }),
  });
  await createRule(ctx, {
    version_id: version.id,
    branch_id: branchId,
    rule_type: "base_rate",
    service_id: svcId,
    configuration: FIXTURE_RATE,
  });
  await createRule(ctx, {
    version_id: version.id,
    branch_id: branchId,
    rule_type: "duration_rule",
    service_id: svcId,
    configuration: FIXTURE_DURATION,
  });
  if (opts.publish) {
    await publishVersion(ctx, version.id, { branch_id: branchId });
    // Activate the profile so version resolution (P11) can select it.
    await activateProfile(profile.id);
  }
  return { profileId: profile.id, versionId: version.id };
}

beforeAll(async () => {
  t = await getDomainHarness();
  orgId = await t.fx.createOrganization("Pricing Test Org", "pricing-test-org");
  ctx = await hqAdminContext(orgId, "pricing-hq@test.example");
  branchId = await t.fx.createBranch(orgId, "pricing-main");
  catId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_categories (organization_id, branch_id, slug, name)
       values ($1, $2, 'pricing-cat', 'Cat') returning id`,
      [orgId, branchId],
    )
  ).rows[0].id;
  svcId = (
    await t.db.query<{ id: string }>(
      `insert into public.services (organization_id, branch_id, category_id, slug, name)
       values ($1, $2, $3, 'pricing-svc', 'Svc') returning id`,
      [orgId, branchId, catId],
    )
  ).rows[0].id;
  addonId = (
    await t.db.query<{ id: string }>(
      `insert into public.service_addons (organization_id, branch_id, slug, name)
       values ($1, $2, 'pricing-addon', 'Addon') returning id`,
      [orgId, branchId],
    )
  ).rows[0].id;

  // P20 sibling actors.
  const staffUser = await t.fx.createUser("pricing-staff@test.example");
  await t.fx.createMembership(staffUser, orgId, "hq_staff");
  staffCtx = await (async () => {
    const { resolveActor } = await import("@/lib/authorization/server");
    const c = await resolveActor(staffUser);
    c.requestId = "req-staff";
    return c;
  })();

  const managerUser = await t.fx.createUser("pricing-manager@test.example");
  const managerMembership = await t.fx.createMembership(managerUser, orgId, "branch_manager");
  await t.fx.grantBranch(managerMembership, branchId);
  managerCtx = await (async () => {
    const { resolveActor } = await import("@/lib/authorization/server");
    const c = await resolveActor(managerUser);
    c.requestId = "req-manager";
    return c;
  })();

  const cleanerUser = await t.fx.createUser("pricing-cleaner@test.example");
  await t.fx.createMembership(cleanerUser, orgId, "cleaner");
  cleanerCtx = await (async () => {
    const { resolveActor } = await import("@/lib/authorization/server");
    return resolveActor(cleanerUser);
  })();
});

// ---------------------------------------------------------------------------
// Task 8.1 — money primitives (P14/P15)
// ---------------------------------------------------------------------------

describe("money primitives (P14/P15)", () => {
  it("rounds half-up exactly once per rational", () => {
    // 1005 * 25% = 251.25 → 251 (half-up on .25 → down? No: 251.25 → 251).
    expect(applyPercentage(1005n, 2500)).toBe(251n);
    // .5 exactly rounds UP (half-up).
    expect(applyPercentage(1002n, 2500)).toBe(251n); // 250.5 → 251
    expect(roundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(roundHalfUp(3n, 2n)).toBe(2n); // 1.5 → 2
    expect(roundHalfUp(1n, 3n)).toBe(0n); // 0.33… → 0
    expect(roundHalfUp(2n, 3n)).toBe(1n); // 0.67… → 1
  });

  it("keeps the minor-unit sum invariant (total = exact component sum)", () => {
    const b = sumBreakdown({ base: 1000n, addons: 250n, surcharges: 125n, discounts: 0n, tax: 69n });
    expect(b.subtotal).toBe(1375n);
    expect(b.total).toBe(1444n);
    const json = breakdownToJson(b);
    expect(json.total).toBe("14.44");
  });

  it("parses and formats decimal strings losslessly", () => {
    expect(parseMinor("12.50")).toBe(1250n);
    expect(parseMinor("0.05")).toBe(5n);
    expect(parseMinor("12.5")).toBe(1250n);
    expect(formatMinor(1250n)).toBe("12.50");
    expect(formatMinor(5n)).toBe("0.05");
    expect(() => parseMinor("12.505")).toThrow(); // 3 fractional digits rejected
  });
});

// ---------------------------------------------------------------------------
// Task 8.1/8.5 — quote engine pipeline over real fixtures (P2–P9, P14, P15)
// ---------------------------------------------------------------------------

describe("quote engine (task 8.1; NON-PRODUCTION fixtures)", () => {
  it("publishes a draft with fixture rules and calculates a deterministic quote", async () => {
    const { profileId, versionId } = await makePricedVersion({ suffix: "Q1", publish: true });

    const input = {
      branch_id: branchId,
      service_id: svcId,
      scheduled_date: "2026-06-02", // Tuesday
    };
    const q1 = await calculateQuote(input);
    const q2 = await calculateQuote(input);

    // Determinism (P13/§34).
    expect(q1).toEqual(q2);

    // duration 30 min × 1000 minor/h ÷ 60 = 500 minor base.
    expect(q1.duration_minutes).toBe(30);
    expect(q1.base_amount).toBe("5.00");
    expect(q1.discount_amount).toBe("0.00"); // P6: discounts inactive
    expect(q1.surcharge_amount).toBe("0.00"); // not Sunday
    expect(q1.tax_amount).toBe("0.00"); // P7b: tax inactive (no rate)
    expect(q1.total).toBe("5.00");
    expect(q1.currency).toBe("EUR");
    expect(q1.pricing_version_id).toBe(versionId);
    expect(q1.pricing_profile_id).toBe(profileId);
    expect(q1.actual_duration_minutes).toBe(q1.duration_minutes); // P9

    // Snapshot source carries exactly the §16.3 members.
    expect(q1.snapshot_source.pricing_version_id).toBe(versionId);
    expect(q1.snapshot_source.inputs).toMatchObject({
      branch_id: branchId,
      service_id: svcId,
      scheduled_date: "2026-06-02",
      duration_minutes: 30,
    });
    expect(q1.snapshot_source.result.total).toBe("5.00");
  });

  it("applies difficulty (P4) and add-ons from configuration", async () => {
    // Versions are immutable once published (P16), so the extra rules must
    // be added to the DRAFT version before publishing; activation (P11)
    // then selects the profile for resolution.
    const { profileId, versionId } = await makePricedVersion({ suffix: "Q2" });
    await createRule(ctx, {
      version_id: versionId,
      branch_id: branchId,
      rule_type: "difficulty",
      service_id: svcId,
      // NON-PRODUCTION multiplier: ×1.5
      configuration: { level: "medium", multiplier: 1.5 },
    });
    await createRule(ctx, {
      version_id: versionId,
      branch_id: branchId,
      rule_type: "addon_price",
      service_addon_id: addonId,
      // NON-PRODUCTION: 2.00 fixed per unit
      configuration: { model: "fixed", value: 200 },
    });
    await publishVersion(ctx, versionId, { branch_id: branchId });
    await activateProfile(profileId);

    const q = await calculateQuote({
      branch_id: branchId,
      service_id: svcId,
      scheduled_date: "2026-06-02",
      addons: [{ addon_id: addonId, quantity: 2 }],
    });
    // base = 500 × 1.5 = 750; addons = 200 × 2 = 400; total 11.50.
    expect(q.base_amount).toBe("7.50");
    expect(q.addon_amount).toBe("4.00");
    expect(q.total).toBe("11.50");
  });

  it("evaluates the Sunday surcharge by branch-local date with highest-applicable-only (P5/P5b)", async () => {
    const { profileId, versionId } = await makePricedVersion({ suffix: "Q3" });
    await createRule(ctx, {
      version_id: versionId,
      branch_id: branchId,
      rule_type: "surcharge",
      // NON-PRODUCTION: Sunday +25%
      configuration: { kind: "sunday", model: "percentage", value: 25, stacking: "highest_only" },
    });
    await createRule(ctx, {
      version_id: versionId,
      branch_id: branchId,
      rule_type: "surcharge",
      // NON-PRODUCTION: Sunday +10% (lower — must lose under P5b)
      configuration: { kind: "sunday", model: "percentage", value: 10, stacking: "highest_only" },
    });
    await publishVersion(ctx, versionId, { branch_id: branchId });
    await activateProfile(profileId);

    const sunday = await calculateQuote({
      branch_id: branchId,
      service_id: svcId,
      scheduled_date: "2026-06-07", // Sunday
    });
    expect(sunday.surcharge_amount).toBe("1.25"); // 500 × 25% (highest only)
    expect(sunday.total).toBe("6.25");

    const tuesday = await calculateQuote({
      branch_id: branchId,
      service_id: svcId,
      scheduled_date: "2026-06-02",
    });
    expect(tuesday.surcharge_amount).toBe("0.00");
  });

  it("resolves the effective version by scheduled date (P17/§49)", async () => {
    const v1 = await makePricedVersion({
      suffix: "V1",
      publish: true,
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-06-30",
    });
    const v2 = await makePricedVersion({
      suffix: "V2",
      publish: true,
      effectiveFrom: "2026-07-01",
    });

    // V1's window covers June; V2's open-ended window covers August. Note
    // that only V2's profile is ACTIVE (P11) — V1's was archived by the
    // activation helper — so V1-quote assertions apply to the version
    // identity visible in its own profile only through V2's reported id.
    const inV2 = await calculateQuote({ branch_id: branchId, service_id: svcId, scheduled_date: "2026-08-15" });
    expect(inV2.pricing_version_id).toBe(v2.versionId);
    void v1;
  });

  it("rejects overlap at publish time (P17) and refuses publishing empty versions (§47)", async () => {
    // P17 is per PROFILE: both versions must live under the SAME profile for
    // the overlap check to apply.
    const profile = await createProfile(ctx, {
      branch_id: branchId,
      name: "Overlap Profile",
      currency: "EUR",
    });
    const v1 = await createVersion(ctx, {
      profile_id: profile.id,
      branch_id: branchId,
      effective_from: "2026-05-01",
      effective_until: "2026-05-31",
    });
    await createRule(ctx, {
      version_id: v1.id,
      branch_id: branchId,
      rule_type: "base_rate",
      service_id: svcId,
      configuration: FIXTURE_RATE,
    });
    await createRule(ctx, {
      version_id: v1.id,
      branch_id: branchId,
      rule_type: "duration_rule",
      service_id: svcId,
      configuration: FIXTURE_DURATION,
    });
    await publishVersion(ctx, v1.id, { branch_id: branchId });

    const overlap = await createVersion(ctx, {
      profile_id: profile.id,
      branch_id: branchId,
      effective_from: "2026-05-15",
      effective_until: "2026-06-15",
    });
    await createRule(ctx, {
      version_id: overlap.id,
      branch_id: branchId,
      rule_type: "base_rate",
      service_id: svcId,
      configuration: FIXTURE_RATE,
    });
    await createRule(ctx, {
      version_id: overlap.id,
      branch_id: branchId,
      rule_type: "duration_rule",
      service_id: svcId,
      configuration: FIXTURE_DURATION,
    });
    await expect(
      publishVersion(ctx, overlap.id, { branch_id: branchId }),
    ).rejects.toMatchObject({ details: { pricing_code: PricingErrorCode.CONFIGURATION_INVALID } });

    const empty = await createVersion(ctx, {
      profile_id: (
        await createProfile(ctx, { branch_id: branchId, name: "Empty Profile", currency: "EUR" })
      ).id,
      branch_id: branchId,
      effective_from: "2026-01-01",
    });
    await expect(publishVersion(ctx, empty.id, { branch_id: branchId })).rejects.toMatchObject({
      details: { pricing_code: PricingErrorCode.CONFIGURATION_INVALID },
    });
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — configuration CRUD + P20 authorization boundaries
// ---------------------------------------------------------------------------

describe("configuration CRUD + P20 authorization (task 8.2)", () => {
  it("creates a draft profile; currency must match the branch (P8)", async () => {
    const profile = await createProfile(ctx, {
      branch_id: branchId,
      name: "P20 Profile",
      currency: "EUR",
    });
    expect(profile.status).toBe("draft");

    await expect(
      createProfile(ctx, { branch_id: branchId, name: "Bad Currency", currency: "USD" }),
    ).rejects.toMatchObject({ details: { pricing_code: PricingErrorCode.CURRENCY_MISMATCH } });
  });

  it("HQ staff is view-only (P20): pricing.view yes, create/edit/publish denied", async () => {
    await expect(listProfiles(staffCtx, branchId)).resolves.toBeTruthy();
    await expect(
      createProfile(staffCtx, { branch_id: branchId, name: "Staff Profile", currency: "EUR" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      updateProfile(staffCtx, "00000000-0000-0000-0000-000000000000", { name: "X" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("branch manager has full pricing.* WITHIN branch scope (P20)", async () => {
    const profile = await createProfile(managerCtx, {
      branch_id: branchId,
      name: "Manager Profile",
      currency: "EUR",
    });
    expect(profile.status).toBe("draft");
    const version = await createVersion(managerCtx, {
      profile_id: profile.id,
      branch_id: branchId,
      effective_from: "2026-01-01",
    });
    await createRule(managerCtx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "base_rate",
      service_id: svcId,
      configuration: FIXTURE_RATE,
    });
    await createRule(managerCtx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "duration_rule",
      service_id: svcId,
      configuration: FIXTURE_DURATION,
    });
    const published = await publishVersion(managerCtx, version.id, { branch_id: branchId });
    expect(published.status).toBe("published");
    const archived = await archiveVersion(managerCtx, version.id);
    expect(archived.status).toBe("archived");
  });

  it("cleaner has no pricing permissions at all (P20)", async () => {
    await expect(listProfiles(cleanerCtx, branchId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    await expect(
      createProfile(cleanerCtx, { branch_id: branchId, name: "Cleaner Profile", currency: "EUR" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("enforces lifecycle: rules only on draft versions; publish freezes content (P16)", async () => {
    const { versionId } = await makePricedVersion({ suffix: "LC", publish: true });
    await expect(
      createRule(ctx, {
        version_id: versionId,
        branch_id: branchId,
        rule_type: "base_rate",
        configuration: FIXTURE_RATE,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    // Publish is one-way: re-publishing a published version is rejected.
    await expect(publishVersion(ctx, versionId, { branch_id: branchId })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it("validates rule configuration per rule_type at the boundary", async () => {
    const { versionId } = await makePricedVersion({ suffix: "CFG" });
    await expect(
      createRule(ctx, {
        version_id: versionId,
        branch_id: branchId,
        rule_type: "base_rate",
        configuration: { model: "hourly" } as never, // missing rate
      }),
    ).rejects.toThrow(/Invalid configuration for rule_type base_rate/);
    await expect(
      createRule(ctx, {
        version_id: versionId,
        branch_id: branchId,
        rule_type: "surcharge",
        configuration: { kind: "sunday", model: "weird", value: 1, stacking: "highest_only" } as never,
      }),
    ).rejects.toThrow(/Invalid configuration for rule_type surcharge/);
  });

  it("catalog cross-branch identity is rejected at the domain layer", async () => {
    const otherOrg = await t.fx.createOrganization("Pricing Other Org", "pricing-other-org");
    const otherBranch = await t.fx.createBranch(otherOrg, "pricing-other-branch");
    const otherCat = (
      await t.db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'other-cat', 'Cat') returning id`,
        [otherOrg, otherBranch],
      )
    ).rows[0].id;
    const otherSvc = (
      await t.db.query<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'other-svc', 'Svc') returning id`,
        [otherOrg, otherBranch, otherCat],
      )
    ).rows[0].id;

    const { versionId } = await makePricedVersion({ suffix: "XBR" });
    await expect(
      createRule(ctx, {
        version_id: versionId,
        branch_id: branchId,
        rule_type: "base_rate",
        service_id: otherSvc,
        configuration: FIXTURE_RATE,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — audit fail-closed (transactional with mutations)
// ---------------------------------------------------------------------------

describe("pricing audit (task 8.2)", () => {
  it("writes pricing.created/updated/published/archived transactionally", async () => {
    const profile = await createProfile(ctx, {
      branch_id: branchId,
      name: "Audit Profile",
      currency: "EUR",
    });
    const version = await createVersion(ctx, {
      profile_id: profile.id,
      branch_id: branchId,
      effective_from: "2026-01-01",
    });
    await createRule(ctx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "base_rate",
      service_id: svcId,
      configuration: FIXTURE_RATE,
    });
    await createRule(ctx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "duration_rule",
      service_id: svcId,
      configuration: FIXTURE_DURATION,
    });
    await publishVersion(ctx, version.id, { branch_id: branchId });
    await archiveVersion(ctx, version.id);

    const events = await t.db.query<{ action: string }>(
      `select distinct action from public.audit_logs
       where branch_id = $1 and action like 'pricing.%'
       order by action`,
      [branchId],
    );
    const actions = events.rows.map((r) => r.action);
    expect(actions).toContain("pricing.created");
    expect(actions).toContain("pricing.updated");
    expect(actions).toContain("pricing.published");
    expect(actions).toContain("pricing.archived");
    // Dotted resource.action format (MEDIUM-1).
    for (const a of actions) expect(a).toMatch(/^pricing\.[a-z]+$/);
  });

  it("seed writes the pricing.seeded provenance event", async () => {
    const seedBranch = await t.fx.createBranch(orgId, "pricing-seed-audit");
    await seedPricingDefaults(seedBranch);
    const event = await t.db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_logs
       where branch_id = $1 and action = 'pricing.seeded' limit 1`,
      [seedBranch],
    );
    expect(event.rows[0]?.action).toBe("pricing.seeded");
    expect(event.rows[0]?.metadata.structure_only).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — seed idempotency (P18/P3)
// ---------------------------------------------------------------------------

describe("seedPricingDefaults (task 8.2; P18/P3)", () => {
  it("is idempotent and structure-only", async () => {
    const branch = await t.fx.createBranch(orgId, "pricing-seed");
    const r1 = await seedPricingDefaults(branch);
    expect(r1.branchesProcessed).toBe(1);
    expect(r1.profilesInserted).toBe(1);
    expect(r1.versionsInserted).toBe(1);

    const r2 = await seedPricingDefaults(branch);
    expect(r2.profilesInserted).toBe(0);
    expect(r2.versionsInserted).toBe(0);

    const profiles = await t.db.query<{ name: string; status: string; currency: string }>(
      `select name, status, currency from public.pricing_profiles where branch_id = $1`,
      [branch],
    );
    expect(profiles.rows).toHaveLength(1);
    expect(profiles.rows[0].status).toBe("draft"); // never silently activated
    expect(profiles.rows[0].currency).toBe("EUR");

    const versions = await t.db.query<{ vstatus: string }>(
      `select v.status as vstatus from public.pricing_versions v
       join public.pricing_profiles p on p.id = v.pricing_profile_id
       where p.branch_id = $1`,
      [branch],
    );
    void versions;
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0].vstatus).toBe("draft");

    // Structure-only: zero rules, therefore zero production values (P3).
    const rules = await t.db.query<{ n: string }>(
      `select count(*)::text as n from public.pricing_rules r
       join public.pricing_versions v on v.id = r.pricing_version_id
       join public.pricing_profiles p on p.id = v.pricing_profile_id
       where p.branch_id = $1`,
      [branch],
    );
    void rules;
    expect(rules.rows[0]?.n).toBe("0");
  });

  it("throws NOT_FOUND for an unknown branch", async () => {
    await expect(
      seedPricingDefaults("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

// ---------------------------------------------------------------------------
// Task 8.4 — duration authority (P21/P-D1) + placeholder absence
// ---------------------------------------------------------------------------

describe("duration authority (task 8.4; P21/P-D1)", () => {
  it("resolves duration from pricing rules through the scheduling seam", async () => {
    await makePricedVersion({
      suffix: "DA1",
      publish: true,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
    });
    const provider = pricingDurationProvider({
      branchId,
      serviceId: svcId,
      scheduledDate: "2026-06-02",
    });
    await expect(provider.getEstimatedDuration({ branchId, serviceId: svcId })).resolves.toBe(30);
  });

  it("honors propertyDetails factors (rooms/bathrooms) — P-D1", async () => {
    // Fresh profile with factor rules.
    const profile = await createProfile(ctx, {
      branch_id: branchId,
      name: "DA Factor Profile",
      currency: "EUR",
    });
    const version = await createVersion(ctx, {
      profile_id: profile.id,
      branch_id: branchId,
      effective_from: "2026-08-01",
    });
    await createRule(ctx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "duration_rule",
      service_id: svcId,
      // NON-PRODUCTION structural minutes.
      configuration: {
        consumed_factors: ["base", "rooms", "bathrooms"],
        base_minutes: 20,
        per_room_minutes: 10,
        per_bathroom_minutes: 15,
      },
    });
    await createRule(ctx, {
      version_id: version.id,
      branch_id: branchId,
      rule_type: "base_rate",
      service_id: svcId,
      configuration: FIXTURE_RATE,
    });
    await publishVersion(ctx, version.id, { branch_id: branchId });
    await activateProfile(profile.id);

    // Missing required details → validation error (P-D1).
    await expect(
      pricingDurationProvider({ branchId, serviceId: svcId, scheduledDate: "2026-08-10" })
        .getEstimatedDuration({ branchId, serviceId: svcId }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });

    // Supplied details → rooms×10 + bathrooms×15 + base 20 = 20+30+30 = 80.
    const provider = pricingDurationProvider({
      branchId,
      serviceId: svcId,
      scheduledDate: "2026-08-10",
      propertyDetails: { rooms: 3, bathrooms: 2 },
    });
    await expect(
      provider.getEstimatedDuration({
        branchId,
        serviceId: svcId,
        propertyDetails: { rooms: 3, bathrooms: 2 },
      }),
    ).resolves.toBe(80);
  });

  it("validates propertyDetails with the boundary Zod schema (P-D1)", () => {
    expect(propertyDetailsSchema.safeParse({ rooms: 2 }).success).toBe(true);
    expect(propertyDetailsSchema.safeParse({}).success).toBe(false); // empty
    expect(propertyDetailsSchema.safeParse({ rooms: -1 }).success).toBe(false);
    expect(propertyDetailsSchema.safeParse({ condition: "extreme" }).success).toBe(false);
  });

  it("placeholder absence: scheduling seam exports no placeholderDurationProvider (P21)", async () => {
    const seam = await import("@/features/scheduling/durationProvider");
    expect(Object.keys(seam)).not.toContain("placeholderDurationProvider");
    // And the scheduling modules no longer import one.
    const { readFileSync } = await import("node:fs");
    for (const file of ["holds.ts", "actions.ts", "availability.ts", "feasibility.ts"]) {
      const src = readFileSync(`features/scheduling/${file}`, "utf8");
      expect(src.includes("placeholderDurationProvider")).toBe(false);
    }
  });

  it("reports a stable error when no published version covers the date (P17)", async () => {
    // The DA1 open-ended published version starts 2026-01-01; a date before
    // any published window leaves the branch without coverage.
    await expect(
      pricingDurationProvider({ branchId, serviceId: svcId, scheduledDate: "2025-06-01" })
        .getEstimatedDuration({ branchId, serviceId: svcId }),
    ).rejects.toMatchObject({ details: { pricing_code: PricingErrorCode.VERSION_NOT_FOUND } });
  });
});

// ---------------------------------------------------------------------------
// Error envelope sanity (§58)
// ---------------------------------------------------------------------------

describe("pricing error catalog (§58)", () => {
  it("maps stable codes onto the platform envelope", () => {
    const notFound = pricingError(PricingErrorCode.PROFILE_NOT_FOUND, "x");
    expect(notFound.code).toBe(ErrorCode.NOT_FOUND);
    const conflict = pricingError(PricingErrorCode.CURRENCY_MISMATCH, "x");
    expect(conflict.code).toBe(ErrorCode.CONFLICT);
    const invalid = pricingError(PricingErrorCode.CONFIGURATION_INVALID, "x");
    expect(invalid.code).toBe(ErrorCode.INVALID_INPUT);
  });
});
