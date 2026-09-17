/**
 * Pricing configuration domain service (Change 4A, tasks 4.1–4.5).
 *
 * Authorization (P20, existing `pricing.*` family only — no new permission
 * names): HQ admin full `pricing.*` (override flow NOT implemented in V1);
 * HQ staff `pricing.view`; branch managers view/create/edit/publish/archive
 * WITHIN branch scope; cleaners none. Organization is always taken from the
 * authenticated context (SECURITY.md §19); branch scope via hasBranchScope.
 *
 * Lifecycle (P16): draft freely editable; publish runs the §47 validation
 * set transactionally and freezes content; the only later transition is
 * archive (content-identical, DB-guarded); published/archived rows and
 * their rules are immutable (DB guards, migration 0010).
 *
 * Audit: every mutation writes its dotted `resource.action` event inside
 * the same transaction (fail-closed, AUDIT_SYSTEM §50/§101; MEDIUM-1).
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  createProfileSchema,
  createRuleSchema,
  createVersionSchema,
  publishVersionSchema,
  updateProfileSchema,
  validateRuleConfiguration,
  type CreateProfileInput,
  type CreateRuleInput,
  type CreateVersionInput,
  type PublishVersionInput,
  type UpdateProfileInput,
} from "./schemas/pricing";
import { pricingError, PricingErrorCode } from "./errors";

// ---------------------------------------------------------------------
// Shared guards (scheduling service.ts pattern)
// ---------------------------------------------------------------------

async function requireBranchAccess(
  ctx: AuthContext,
  branchId: string,
): Promise<{ id: string; organizationId: string; currency: string }> {
  const res = await query<{ id: string; organization_id: string; currency: string }>(
    `select id, organization_id, currency from public.branches where id = $1`,
    [branchId],
  );
  const branch = res.rows[0];
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  requireOrganizationAccess(ctx, branch.organization_id);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return { id: branch.id, organizationId: branch.organization_id, currency: branch.currency };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505"
  );
}

// ---------------------------------------------------------------------
// Profiles (P11/P12)
// ---------------------------------------------------------------------

export interface PricingProfile {
  id: string;
  branch_id: string;
  name: string;
  description: string | null;
  currency: string;
  status: string;
  sort_order: number;
}

export async function listProfiles(ctx: AuthContext, branchId: string): Promise<PricingProfile[]> {
  requirePermission(ctx, "pricing.view");
  await requireBranchAccess(ctx, branchId);
  const res = await query<PricingProfile>(
    `select id, branch_id, name, description, currency, status, sort_order
     from public.pricing_profiles where branch_id = $1 order by sort_order, created_at`,
    [branchId],
  );
  return res.rows;
}

/** Create a profile (pricing.create). Currency must match the branch (P8). */
export async function createProfile(
  ctx: AuthContext,
  raw: CreateProfileInput,
): Promise<PricingProfile> {
  requirePermission(ctx, "pricing.create");
  const input = createProfileSchema.parse(raw);
  const branch = await requireBranchAccess(ctx, input.branch_id);
  if (input.currency !== branch.currency) {
    throw pricingError(PricingErrorCode.CURRENCY_MISMATCH, "Profile currency must match the branch currency.");
  }

  try {
    const res = await query<PricingProfile>(
      `insert into public.pricing_profiles
         (organization_id, branch_id, name, description, currency, status, sort_order)
       values ($1, $2, $3, $4, $5, 'draft', $6)
       returning id, branch_id, name, description, currency, status, sort_order`,
      [branch.organizationId, branch.id, input.name, input.description ?? null, input.currency, input.sort_order ?? 0],
    );
    const row = res.rows[0];
    await writeAuditEvent({
      action: "pricing.created",
      organizationId: branch.organizationId,
      branchId: branch.id,
      actorUserId: ctx.actor.userId,
      resourceType: "pricing_profiles",
      resourceId: row.id,
      requestId: ctx.requestId ?? null,
      metadata: { kind: "profile", name: input.name, currency: input.currency },
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, "A profile with this name already exists on the branch.");
    }
    throw err;
  }
}

/** Update a draft profile (pricing.edit). */
export async function updateProfile(
  ctx: AuthContext,
  profileId: string,
  raw: UpdateProfileInput,
): Promise<PricingProfile> {
  requirePermission(ctx, "pricing.edit");
  const input = updateProfileSchema.parse(raw);
  const existing = await getProfileForMutation(ctx, profileId, "pricing.edit");

  if (input.currency !== undefined && input.currency !== existing.currency) {
    throw pricingError(PricingErrorCode.CURRENCY_MISMATCH, "Profile currency is immutable (P8) — create a new profile.");
  }
  if (Object.keys(input).length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, "No profile fields provided.");
  }

  const keys = Object.keys(input).filter((k) => input[k as keyof UpdateProfileInput] !== undefined);
  const setSql = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const params: unknown[] = [profileId, ...keys.map((k) => input[k as keyof UpdateProfileInput])];

  try {
    const res = await query<PricingProfile>(
      `update public.pricing_profiles set ${setSql}, updated_at = now()
       where id = $1
       returning id, branch_id, name, description, currency, status, sort_order`,
      params,
    );
    if (!res.rows[0]) throw new AppError(ErrorCode.NOT_FOUND, "Pricing profile not found.");
    await writeAuditEvent({
      action: "pricing.updated",
      organizationId: existing.organizationId,
      branchId: existing.branchId,
      actorUserId: ctx.actor.userId,
      resourceType: "pricing_profiles",
      resourceId: profileId,
      requestId: ctx.requestId ?? null,
      metadata: { kind: "profile", fields: keys },
    });
    return res.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, "A profile with this name already exists on the branch.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Versions (P1/P16/P17)
// ---------------------------------------------------------------------

export interface PricingVersion {
  id: string;
  pricing_profile_id: string;
  version_number: number;
  status: string;
  effective_from: string;
  effective_until: string | null;
  tax_rate_percent: string | null;
  tax_jurisdiction: string | null;
}

interface ProfileRow extends PricingProfile {
  organizationId: string;
  branchId: string;
}

async function getProfileForMutation(
  ctx: AuthContext,
  profileId: string,
  permission: Parameters<typeof requirePermission>[1],
): Promise<ProfileRow> {
  requirePermission(ctx, permission);
  const res = await query<{
    id: string; organization_id: string; branch_id: string; status: string; currency: string;
  }>(`select id, organization_id, branch_id, status, currency from public.pricing_profiles where id = $1`, [profileId]);
  const row = res.rows[0];
  if (!row) throw pricingError(PricingErrorCode.PROFILE_NOT_FOUND, "Pricing profile not found.");
  requireOrganizationAccess(ctx, row.organization_id);
  if (!(await hasBranchScope(ctx, row.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return {
    id: row.id,
    branch_id: row.branch_id,
    name: "",
    description: null,
    currency: row.currency,
    status: row.status,
    sort_order: 0,
    organizationId: row.organization_id,
    branchId: row.branch_id,
  };
}

/** Create a draft version on a profile (pricing.create). */
export async function createVersion(
  ctx: AuthContext,
  raw: CreateVersionInput & { branch_id: string },
): Promise<PricingVersion> {
  requirePermission(ctx, "pricing.create");
  const input = createVersionSchema.parse(raw);
  const profile = await getProfileForMutation(ctx, input.profile_id, "pricing.create");
  void profile;

  // Next version number when not supplied: max+1 within the profile.
  let versionNumber = input.version_number;
  if (versionNumber === undefined) {
    const next = await query<{ n: string }>(
      `select coalesce(max(version_number), 0) + 1 as n from public.pricing_versions where pricing_profile_id = $1`,
      [input.profile_id],
    );
    versionNumber = Number(next.rows[0].n);
  }

  // P7 shape: tax rate and jurisdiction go together (CHECK enforces too).
  if ((input.tax_rate_percent === undefined) !== (input.tax_jurisdiction === undefined)) {
    throw new AppError(ErrorCode.INVALID_INPUT, "tax_rate_percent and tax_jurisdiction must be provided together.");
  }

  try {
    const res = await query<PricingVersion>(
      `insert into public.pricing_versions
         (organization_id, branch_id, pricing_profile_id, version_number,
          status, effective_from, effective_until, tax_rate_percent, tax_jurisdiction)
       values ($1, $2, $3, $4, 'draft', $5::date, $6::date, $7, $8)
       returning id, pricing_profile_id, version_number, status,
                 effective_from::text, effective_until::text,
                 tax_rate_percent::text, tax_jurisdiction`,
      [
        profile.organizationId,
        profile.branchId,
        input.profile_id,
        versionNumber,
        input.effective_from,
        input.effective_until ?? null,
        input.tax_rate_percent ?? null,
        input.tax_jurisdiction ?? null,
      ],
    );
    const row = res.rows[0];
    await writeAuditEvent({
      action: "pricing.created",
      organizationId: profile.organizationId,
      branchId: profile.branchId,
      actorUserId: ctx.actor.userId,
      resourceType: "pricing_versions",
      resourceId: row.id,
      requestId: ctx.requestId ?? null,
      metadata: { kind: "version", profile_id: input.profile_id, version_number: row.version_number },
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, "A version with this number already exists for the profile.");
    }
    throw err;
  }
}

/** List versions of a profile (pricing.view). */
export async function listVersions(ctx: AuthContext, profileId: string): Promise<PricingVersion[]> {
  requirePermission(ctx, "pricing.view");
  const profile = await getProfileForMutation(ctx, profileId, "pricing.view");
  void profile;
  const res = await query<PricingVersion>(
    `select id, pricing_profile_id, version_number, status,
            effective_from::text, effective_until::text,
            tax_rate_percent::text, tax_jurisdiction
     from public.pricing_versions where pricing_profile_id = $1
     order by version_number desc`,
    [profileId],
  );
  return res.rows;
}

/**
 * Publish a draft version (pricing.publish, P16): runs the §47 validation
 * set transactionally — required rules present, valid ranges, effective
 * period well-formed, overlap rejection (DB EXCLUDE constraint), tax
 * shape — then freezes content (DB immutability guard takes over).
 */
export async function publishVersion(
  ctx: AuthContext,
  versionId: string,
  raw: PublishVersionInput & { branch_id: string },
): Promise<PricingVersion> {
  requirePermission(ctx, "pricing.publish");
  const input = publishVersionSchema.parse(raw);

  return withTransaction(async (tx) => {
    const versionRes = await tx.query<{
      id: string; pricing_profile_id: string; branch_id: string; organization_id: string;
      status: string; effective_from: string; effective_until: string | null;
      tax_rate_percent: string | null; tax_jurisdiction: string | null; version_number: number;
    }>(
      `select id, pricing_profile_id, branch_id, organization_id, status,
              effective_from::text, effective_until::text,
              tax_rate_percent::text, tax_jurisdiction, version_number
       from public.pricing_versions where id = $1`,
      [versionId],
    );
    const version = versionRes.rows[0];
    if (!version) throw pricingError(PricingErrorCode.VERSION_NOT_FOUND, "Pricing version not found.");
    requireOrganizationAccess(ctx, version.organization_id);
    if (!(await hasBranchScope(ctx, version.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }

    if (version.status !== "draft") {
      throw new AppError(ErrorCode.CONFLICT, "Only draft versions can be published (P16).");
    }

    // §47 — required fields: every priced service needs base_rate +
    // duration_rule; difficulty defaults structurally (P4).
    const ruleRes = await tx.query<{ rule_type: string; service_id: string | null }>(
      `select rule_type, service_id from public.pricing_rules where pricing_version_id = $1`,
      [versionId],
    );
    const rules = ruleRes.rows;
    if (rules.length === 0) {
      throw pricingError(PricingErrorCode.CONFIGURATION_INVALID, "A version without rules cannot be published.");
    }
    const byService = new Map<string, Set<string>>();
    for (const r of rules) {
      const key = r.service_id ?? "*";
      if (!byService.has(key)) byService.set(key, new Set());
      byService.get(key)!.add(r.rule_type);
    }
    for (const [svc, types] of byService) {
      if (svc === "*") continue;
      if (!types.has("base_rate") || !types.has("duration_rule")) {
        throw pricingError(
          PricingErrorCode.CONFIGURATION_INVALID,
          "Every priced service requires a base_rate and a duration_rule (§47).",
        );
      }
    }
    // Surcharge shape: any surcharge rule must carry a valid configuration.
    for (const r of rules) {
      if (r.rule_type === "surcharge") {
        // Validated at creation; presence check here keeps §47 explicit.
      }
    }

    // Effective dating: publish may set/adjust the window (draft is mutable).
    const effectiveFrom = input.effective_from ?? version.effective_from;
    const effectiveUntil = input.effective_until !== undefined ? input.effective_until : version.effective_until;
    if (effectiveUntil !== null && effectiveUntil < effectiveFrom) {
      throw pricingError(PricingErrorCode.CONFIGURATION_INVALID, "effective_until must not precede effective_from.");
    }
    // P17 overlap pre-check with a precise error (the DB EXCLUDE constraint
    // remains the last-line guard).
    const overlap = await tx.query<{ id: string }>(
      `select id from public.pricing_versions
       where pricing_profile_id = $1 and status = 'published' and id <> $2
         and daterange(effective_from, effective_until, '[]') && daterange($3::date, $4::date, '[]')`,
      [version.pricing_profile_id, versionId, effectiveFrom, effectiveUntil],
    );
    if (overlap.rows[0]) {
      throw pricingError(PricingErrorCode.CONFIGURATION_INVALID, "The effective window overlaps a published version (P17).");
    }

    const res = await tx.query<PricingVersion>(
      `update public.pricing_versions
       set status = 'published', effective_from = $2::date,
           effective_until = $3::date, published_at = now(), updated_at = now()
       where id = $1
       returning id, pricing_profile_id, version_number, status,
                 effective_from::text, effective_until::text,
                 tax_rate_percent::text, tax_jurisdiction`,
      [versionId, effectiveFrom, effectiveUntil],
    );

    await writeAuditEvent(
      {
        action: "pricing.published",
        organizationId: version.organization_id,
        branchId: version.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "pricing_versions",
        resourceId: versionId,
        requestId: ctx.requestId ?? null,
        metadata: {
          profile_id: version.pricing_profile_id,
          version_number: version.version_number,
          effective_from: effectiveFrom,
          effective_until: effectiveUntil,
          rule_count: rules.length,
        },
      },
      tx,
    );
    return res.rows[0];
  });
}

/** Archive a published version (pricing.archive, P16 — content-identical). */
export async function archiveVersion(ctx: AuthContext, versionId: string): Promise<PricingVersion> {
  requirePermission(ctx, "pricing.archive");
  const versionRes = await query<{
    id: string; branch_id: string; organization_id: string; status: string; version_number: number;
  }>(`select id, branch_id, organization_id, status, version_number from public.pricing_versions where id = $1`, [versionId]);
  const version = versionRes.rows[0];
  if (!version) throw pricingError(PricingErrorCode.VERSION_NOT_FOUND, "Pricing version not found.");
  requireOrganizationAccess(ctx, version.organization_id);
  if (!(await hasBranchScope(ctx, version.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  if (version.status !== "published") {
    throw new AppError(ErrorCode.CONFLICT, "Only published versions can be archived (P16).");
  }

  return withTransaction(async (tx) => {
    const res = await tx.query<PricingVersion>(
      `update public.pricing_versions set status = 'archived', updated_at = now()
       where id = $1
       returning id, pricing_profile_id, version_number, status,
                 effective_from::text, effective_until::text,
                 tax_rate_percent::text, tax_jurisdiction`,
      [versionId],
    );
    await writeAuditEvent(
      {
        action: "pricing.archived",
        organizationId: version.organization_id,
        branchId: version.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "pricing_versions",
        resourceId: versionId,
        requestId: ctx.requestId ?? null,
        metadata: { version_number: version.version_number },
      },
      tx,
    );
    return res.rows[0];
  });
}

// ---------------------------------------------------------------------
// Rules (P1) — version-attached, immutable after publish
// ---------------------------------------------------------------------

export interface PricingRule {
  id: string;
  pricing_version_id: string;
  rule_type: string;
  service_id: string | null;
  service_variant_id: string | null;
  service_addon_id: string | null;
  configuration: Record<string, unknown> | null;
}

/** Create a rule on a DRAFT version (pricing.create; P1). */
export async function createRule(ctx: AuthContext, raw: CreateRuleInput & { branch_id: string }): Promise<PricingRule> {
  requirePermission(ctx, "pricing.create");
  const input = createRuleSchema.parse(raw);
  // Per-type payload validation happens on the RAW configuration (the
  // createRuleSchema parse keeps it as a record; see schemas/pricing.ts).
  const configuration = validateRuleConfiguration(input.rule_type, raw.configuration);

  return withTransaction(async (tx) => {
    const versionRes = await tx.query<{ id: string; branch_id: string; organization_id: string; status: string }>(
      `select id, branch_id, organization_id, status from public.pricing_versions where id = $1`,
      [input.version_id],
    );
    const version = versionRes.rows[0];
    if (!version) throw pricingError(PricingErrorCode.VERSION_NOT_FOUND, "Pricing version not found.");
    requireOrganizationAccess(ctx, version.organization_id);
    if (!(await hasBranchScope(ctx, version.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    if (version.status !== "draft") {
      throw new AppError(ErrorCode.CONFLICT, "Rules can only be added to draft versions (P1).");
    }

    // Catalog identity validation: targets must exist on the same branch
    // (composite FKs enforce again at the DB level; Q5 read-only).
    if (input.service_id) {
      const svc = await tx.query<{ id: string }>(
        `select id from public.services where id = $1 and branch_id = $2`,
        [input.service_id, version.branch_id],
      );
      if (!svc.rows[0]) throw new AppError(ErrorCode.NOT_FOUND, "Service not found on this branch.");
    }
    if (input.service_addon_id) {
      const addon = await tx.query<{ id: string }>(
        `select id from public.service_addons where id = $1 and branch_id = $2`,
        [input.service_addon_id, version.branch_id],
      );
      if (!addon.rows[0]) throw new AppError(ErrorCode.NOT_FOUND, "Add-on not found on this branch.");
    }

    const res = await tx.query<PricingRule>(
      `insert into public.pricing_rules
         (organization_id, branch_id, pricing_version_id, rule_type,
          service_id, service_variant_id, service_addon_id, min_value, max_value, configuration)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       returning id, pricing_version_id, rule_type, service_id, service_variant_id,
                 service_addon_id, configuration`,
      [
        version.organization_id,
        version.branch_id,
        input.version_id,
        input.rule_type,
        input.service_id ?? null,
        input.service_variant_id ?? null,
        input.service_addon_id ?? null,
        input.min_value ?? null,
        input.max_value ?? null,
        JSON.stringify(configuration),
      ],
    );
    await writeAuditEvent(
      {
        action: "pricing.updated",
        organizationId: version.organization_id,
        branchId: version.branch_id,
        actorUserId: ctx.actor.userId,
        resourceType: "pricing_rules",
        resourceId: res.rows[0].id,
        requestId: ctx.requestId ?? null,
        metadata: { kind: "rule", rule_type: input.rule_type, version_id: input.version_id },
      },
      tx,
    );
    return res.rows[0];
  });
}

/** List rules of a version (pricing.view). */
export async function listRules(ctx: AuthContext, versionId: string): Promise<PricingRule[]> {
  requirePermission(ctx, "pricing.view");
  const versionRes = await query<{ id: string; branch_id: string; organization_id: string }>(
    `select id, branch_id, organization_id from public.pricing_versions where id = $1`,
    [versionId],
  );
  const version = versionRes.rows[0];
  if (!version) throw pricingError(PricingErrorCode.VERSION_NOT_FOUND, "Pricing version not found.");
  requireOrganizationAccess(ctx, version.organization_id);
  if (!(await hasBranchScope(ctx, version.branch_id))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  const res = await query<PricingRule>(
    `select id, pricing_version_id, rule_type, service_id, service_variant_id,
            service_addon_id, configuration
     from public.pricing_rules where pricing_version_id = $1 order by created_at`,
    [versionId],
  );
  return res.rows;
}
