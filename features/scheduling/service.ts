/**
 * Scheduling & availability domain service — configuration half
 * (Change 3, tasks 6.1–6.6). The availability/hold half lives in
 * `availability.ts` and `holds.ts`.
 *
 * Authorization (S17): branch scheduling configuration — operating hours,
 * exceptions, per-branch parameters, service scheduling rules — is exercised
 * through the EXISTING canonical permissions `branches.view` /
 * `branches.edit` (lib/permissions.ts; no new permission names — S17 defers
 * any override permission to a later security decision). HQ roles act
 * organization-wide; branch-scoped roles only within their
 * membership_branches scope (hasBranchScope). Organization is taken from the
 * authenticated context, never from input (SECURITY.md §19).
 *
 * Decisions encoded:
 *   S2   effective-dated weekly template; closed day = no rows; multiple
 *        intervals per weekday; history immutable (close-and-replace only).
 *   S9   unified typed exceptions (closed | reduced_hours | blackout |
 *        holiday_override); V1 source is manual entry only (S9b).
 *   S18  service_scheduling_rules windows only; this module never prices and
 *        never computes duration (S6 — Pricing stays authoritative).
 *   Q9   organization_id always from ctx; branch_id must belong to it.
 *
 * Audit: every mutation writes its `resource.action` event inside the same
 * transaction (fail-closed, AUDIT_SYSTEM §50/§101).
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
import { findAlwaysNonexistentLocalTimes } from "./timezone";
import {
  closeOperatingHoursSchema,
  createScheduleExceptionSchema,
  deleteScheduleExceptionSchema,
  upsertOperatingHoursSchema,
  upsertServiceSchedulingRuleSchema,
  updateSchedulingConfigSchema,
  type CloseOperatingHoursInput,
  type CreateScheduleExceptionInput,
  type DeleteScheduleExceptionInput,
  type UpdateSchedulingConfigInput,
  type UpsertOperatingHoursInput,
  type UpsertServiceSchedulingRuleInput,
} from "./schemas/scheduling";

// ---------------------------------------------------------------------
// Shared guards (catalog service.ts pattern)
// ---------------------------------------------------------------------

async function requireBranchAccess(
  ctx: AuthContext,
  branchId: string,
): Promise<{ id: string; organizationId: string; timezone: string }> {
  const res = await query<{ id: string; organization_id: string; timezone: string }>(
    `select id, organization_id, timezone from public.branches where id = $1`,
    [branchId],
  );
  const branch = res.rows[0];
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  requireOrganizationAccess(ctx, branch.organization_id);
  if (!(await hasBranchScope(ctx, branchId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
  }
  return { id: branch.id, organizationId: branch.organization_id, timezone: branch.timezone };
}

export function parseOrThrow<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      parsed.error?.issues.map((i) => i.message).join("; ") ?? "Invalid input.",
    );
  }
  return parsed.data!;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505"
  );
}

// ---------------------------------------------------------------------
// Branch scheduling configuration (S3/S4/S5/S6b/S7b/S12/S1b)
// ---------------------------------------------------------------------

export interface SchedulingConfig {
  branch_id: string;
  minimum_notice_minutes: number;
  maximum_advance_days: number;
  slot_grid_minutes: number;
  operational_buffer_minutes: number;
  travel_buffer_minutes: number;
  concurrency_cap: number;
  customer_horizon_days: number;
  hold_ttl_minutes: number;
}

/**
 * Read the branch scheduling configuration. The row carries the approved
 * platform defaults (§86) and is provisioned by `seedSchedulingDefaults`
 * (task 11.1), so this never fails for a seeded branch (task 11.1 —
 * defaults live in the database, not in code).
 */
export async function getSchedulingConfig(
  ctx: AuthContext,
  branchId: string,
): Promise<SchedulingConfig> {
  await requireBranchAccess(ctx, branchId);
  const res = await query<SchedulingConfig>(
    `select branch_id, minimum_notice_minutes, maximum_advance_days,
            slot_grid_minutes, operational_buffer_minutes, travel_buffer_minutes,
            concurrency_cap, customer_horizon_days, hold_ttl_minutes
     from public.branch_scheduling_configuration where branch_id = $1`,
    [branchId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  return row;
}

/** Update branch scheduling parameters (branches.edit, S17). */
export async function updateSchedulingConfig(
  ctx: AuthContext,
  raw: UpdateSchedulingConfigInput & { branch_id: string },
): Promise<SchedulingConfig> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, ...rest } = raw;
  const input = parseOrThrow(updateSchedulingConfigSchema, rest);
  const branch = await requireBranchAccess(ctx, branch_id);

  const keys = Object.keys(input) as (keyof UpdateSchedulingConfigInput)[];
  if (keys.length === 0) {
    throw new AppError(ErrorCode.INVALID_INPUT, "No configuration fields provided.");
  }
  const setSql = keys.map((k, i) => `${k} = $${i + 2}::int`).join(", ");
  const params = [branch_id, ...keys.map((k) => input[k])];

  try {
    const res = await query<SchedulingConfig>(
      `update public.branch_scheduling_configuration set ${setSql}, updated_at = now()
       where branch_id = $1
       returning branch_id, minimum_notice_minutes, maximum_advance_days,
                 slot_grid_minutes, operational_buffer_minutes, travel_buffer_minutes,
                 concurrency_cap, customer_horizon_days, hold_ttl_minutes`,
      params,
    );
    const row = res.rows[0];
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
    await writeAuditEvent({
      action: "scheduling_config.updated",
      organizationId: branch.organizationId,
      branchId: branch.id,
      actorUserId: ctx.actor.userId,
      resourceType: "branch_scheduling_configuration",
      resourceId: branch.id,
      metadata: { fields: keys },
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, "Scheduling configuration conflict.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Branch operating hours (S2)
// ---------------------------------------------------------------------

export interface OperatingHoursInterval {
  id: string;
  weekday: number;
  interval_index: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
}

/** List the operating-hours template (S2). */
export async function listOperatingHours(
  ctx: AuthContext,
  branchId: string,
): Promise<OperatingHoursInterval[]> {
  await requireBranchAccess(ctx, branchId);
  const res = await query<OperatingHoursInterval>(
    `select id, weekday, interval_index, start_time::text, end_time::text,
            effective_from::text, effective_until::text
     from public.branch_operating_hours
     where branch_id = $1
     order by effective_from desc, weekday, interval_index`,
    [branchId],
  );
  return res.rows;
}

/**
 * Create a new effective-dated version of a weekday's intervals (S2).
 * History is immutable: rows from the previous version keep their original
 * content and are closed by moving only `effective_until` (task 6.5).
 * Multiple intervals per weekday are supported via interval_index.
 */
export async function upsertOperatingHours(
  ctx: AuthContext,
  raw: UpsertOperatingHoursInput & { branch_id: string },
): Promise<OperatingHoursInterval[]> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, ...rest } = raw;
  const input = parseOrThrow(upsertOperatingHoursSchema, rest);
  const branch = await requireBranchAccess(ctx, branch_id);

  // S14 (design §5): a weekly template containing a local time that never
  // exists in the branch timezone is rejected at configuration time —
  // only a truly always-nonexistent time (e.g. a zone whose DST transition
  // permanently skips that wall clock) trips this; ordinary zones pass.
  const dstOffenders = findAlwaysNonexistentLocalTimes(
    input.intervals.flatMap((i) => [i.start, i.end]),
    branch.timezone,
  );
  if (dstOffenders.length > 0) {
    throw new AppError(
      ErrorCode.INVALID_INPUT,
      `Operating hours contain times that never exist in the branch timezone (DST): ${dstOffenders.join(", ")}.`,
    );
  }

  return withTransaction(async (tx) => {
    // Reject back-dating: the new effective_from must lie after the open
    // version's effective_from (history is immutable and monotonic; closing
    // before the version's own start would violate the effective-range
    // invariant and rewrite history).
    const open = await tx.query<{ effective_from: string }>(
      `select effective_from::text from public.branch_operating_hours
       where branch_id = $1 and weekday = $2 and effective_until is null`,
      [branch.id, input.weekday],
    );
    if (
      open.rows[0] &&
      input.effective_from <= open.rows[0].effective_from
    ) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "New effective_from must be after the currently open version's effective_from.",
      );
    }

    // Close the currently open version for this weekday effective the new
    // start date (immutability: content never changes, only the open end).
    await tx.query(
      `update public.branch_operating_hours
       set effective_until = $3::date - interval '1 day'
       where branch_id = $1 and weekday = $2 and effective_until is null`,
      [branch.id, input.weekday, input.effective_from],
    );

    const created: OperatingHoursInterval[] = [];
    for (let i = 0; i < input.intervals.length; i++) {
      const interval = input.intervals[i];
      try {
        const res = await tx.query<OperatingHoursInterval>(
          `insert into public.branch_operating_hours
             (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
           values ($1, $2, $3, $4, $5::time, $6::time, $7::date)
           returning id, weekday, interval_index, start_time::text, end_time::text,
                     effective_from::text, effective_until::text`,
          [
            branch.organizationId,
            branch.id,
            input.weekday,
            i,
            interval.start,
            interval.end,
            input.effective_from,
          ],
        );
        created.push(res.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(
            ErrorCode.CONFLICT,
            "An effective-dated version of this weekday already starts on that date.",
          );
        }
        throw err;
      }
    }

    await writeAuditEvent(
      {
        action: "operating_hours.created",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_operating_hours",
        resourceId: created[0]?.id ?? null,
        metadata: {
          weekday: input.weekday,
          effective_from: input.effective_from,
          interval_count: created.length,
        },
      },
      tx,
    );
    return created;
  });
}

/**
 * Supersede a weekday's template: close the open version and, when new
 * intervals are provided, start a new one. Omitting intervals closes the day
 * entirely (no rows = closed, S2). Same transactional close-and-replace
 * mechanics as upsertOperatingHours.
 */
export async function closeOperatingHours(
  ctx: AuthContext,
  raw: CloseOperatingHoursInput & { branch_id: string; weekday: number },
): Promise<{ closed: boolean; created: OperatingHoursInterval[] }> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, weekday, ...rest } = raw;
  const input = parseOrThrow(closeOperatingHoursSchema, rest);
  const branch = await requireBranchAccess(ctx, branch_id);

  return withTransaction(async (tx) => {
    const closedRes = await tx.query<{ id: string }>(
      `update public.branch_operating_hours
       set effective_until = $3::date - interval '1 day'
       where branch_id = $1 and weekday = $2 and effective_until is null
       returning id`,
      [branch.id, weekday, input.effective_from],
    );

    const created: OperatingHoursInterval[] = [];
    for (let i = 0; input.intervals && i < input.intervals.length; i++) {
      const interval = input.intervals[i];
      const res = await tx.query<OperatingHoursInterval>(
        `insert into public.branch_operating_hours
           (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
         values ($1, $2, $3, $4, $5::time, $6::time, $7::date)
         returning id, weekday, interval_index, start_time::text, end_time::text,
                   effective_from::text, effective_until::text`,
        [branch.organizationId, branch.id, weekday, i, interval.start, interval.end, input.effective_from],
      );
      created.push(res.rows[0]);
    }

    await writeAuditEvent(
      {
        action: "operating_hours.closed",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_operating_hours",
        resourceId: closedRes.rows[0]?.id ?? null,
        metadata: {
          weekday,
          effective_from: input.effective_from,
          replaced: created.length > 0,
        },
      },
      tx,
    );
    return { closed: closedRes.rowCount > 0, created };
  });
}

// ---------------------------------------------------------------------
// Branch schedule exceptions (S9/S9b)
// ---------------------------------------------------------------------

export interface ScheduleException {
  id: string;
  exception_type: string;
  start_date: string;
  end_date: string;
  intervals: { start: string; end: string }[] | null;
  reason: string | null;
}

export async function listScheduleExceptions(
  ctx: AuthContext,
  branchId: string,
): Promise<ScheduleException[]> {
  await requireBranchAccess(ctx, branchId);
  const res = await query<ScheduleException>(
    `select id, exception_type, start_date::text, end_date::text, intervals, reason
     from public.branch_schedule_exceptions
     where branch_id = $1
     order by start_date desc`,
    [branchId],
  );
  return res.rows;
}

/** Create a typed schedule exception (branches.edit, S17; manual V1, S9b). */
export async function createScheduleException(
  ctx: AuthContext,
  raw: CreateScheduleExceptionInput & { branch_id: string },
): Promise<ScheduleException> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, ...rest } = raw;
  const input = parseOrThrow(createScheduleExceptionSchema, rest);
  const branch = await requireBranchAccess(ctx, branch_id);

  return withTransaction(async (tx) => {
    const res = await tx.query<ScheduleException>(
      `insert into public.branch_schedule_exceptions
         (organization_id, branch_id, exception_type, start_date, end_date, intervals, reason)
       values ($1, $2, $3, $4::date, $5::date, $6::jsonb, $7)
       returning id, exception_type, start_date::text, end_date::text, intervals, reason`,
      [
        branch.organizationId,
        branch.id,
        input.exception_type,
        input.start_date,
        input.end_date,
        input.intervals ? JSON.stringify(input.intervals) : null,
        input.reason ?? null,
      ],
    );
    await writeAuditEvent(
      {
        action: "schedule_exception.created",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_schedule_exceptions",
        resourceId: res.rows[0].id,
        metadata: { exception_type: input.exception_type, start_date: input.start_date, end_date: input.end_date },
      },
      tx,
    );
    return res.rows[0];
  });
}

/** Delete a manual exception (branches.edit, S17). */
export async function deleteScheduleException(
  ctx: AuthContext,
  raw: DeleteScheduleExceptionInput & { branch_id: string },
): Promise<void> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, exception_id } = raw;
  parseOrThrow(deleteScheduleExceptionSchema, { exception_id });
  const branch = await requireBranchAccess(ctx, branch_id);

  await withTransaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `delete from public.branch_schedule_exceptions where id = $1 and branch_id = $2 returning id`,
      [exception_id, branch.id],
    );
    if (res.rowCount === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, "Schedule exception not found.");
    }
    await writeAuditEvent(
      {
        action: "schedule_exception.deleted",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "branch_schedule_exceptions",
        resourceId: exception_id,
        metadata: {},
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------
// Service scheduling rules (S18)
// ---------------------------------------------------------------------

export interface ServiceSchedulingRule {
  id: string;
  service_id: string;
  /** Single window per (service, weekday); null = branch operating window. */
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
}

/**
 * Upsert the scheduling rule for a service (branches.edit, S17). Windows
 * only — this never stores duration or price (S6/S18). One rule per
 * (service, weekday) pair; a null weekday means "every open day". The
 * service must belong to the same branch (enforced again by the composite
 * FK, migration 0009).
 */
export async function upsertServiceSchedulingRule(
  ctx: AuthContext,
  raw: UpsertServiceSchedulingRuleInput & { branch_id: string },
): Promise<ServiceSchedulingRule> {
  requirePermission(ctx, "branches.edit");
  const { branch_id, ...rest } = raw;
  const input = parseOrThrow(upsertServiceSchedulingRuleSchema, rest);
  const branch = await requireBranchAccess(ctx, branch_id);

  return withTransaction(async (tx) => {
    const svc = await tx.query<{ id: string }>(
      `select id from public.services where id = $1 and branch_id = $2`,
      [input.service_id, branch.id],
    );
    if (!svc.rows[0]) {
      throw new AppError(ErrorCode.NOT_FOUND, "Service not found on this branch.");
    }
    const weekday = input.weekday ?? null;
    const startTime = input.start_time ?? null;
    const endTime = input.end_time ?? null;

    const res = await tx.query<ServiceSchedulingRule>(
      `insert into public.service_scheduling_rules
         (organization_id, branch_id, service_id, weekday, start_time, end_time)
       values ($1, $2, $3, $4, $5::time, $6::time)
       on conflict (branch_id, service_id, weekday, start_time) do update set
         end_time = excluded.end_time,
         updated_at = now()
       returning id, service_id, weekday, start_time::text, end_time::text, true as is_active`,
      [
        branch.organizationId,
        branch.id,
        input.service_id,
        weekday,
        startTime,
        endTime,
      ],
    );

    await writeAuditEvent(
      {
        action: "service_scheduling_rule.updated",
        organizationId: branch.organizationId,
        branchId: branch.id,
        actorUserId: ctx.actor.userId,
        resourceType: "service_scheduling_rules",
        resourceId: res.rows[0].id,
        metadata: { service_id: input.service_id, weekday },
      },
      tx,
    );
    return res.rows[0];
  });
}

export type { TransactionClient };
