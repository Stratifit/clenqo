"use server";

/**
 * Server Actions for scheduling & availability (Change 3, task 6.2;
 * API_STANDARDS §4: authenticate → authorize → validate → domain service →
 * typed result). No business logic lives here — everything is delegated to
 * features/scheduling/service.ts, availability.ts, holds.ts.
 *
 * Authorization (S17) is enforced inside the domain service:
 * `branches.view` / `branches.edit` only; no new permission names; the §56
 * override capability does not exist in this surface.
 */
import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
import {
  closeOperatingHours,
  createScheduleException,
  deleteScheduleException,
  getSchedulingConfig,
  listOperatingHours,
  listScheduleExceptions,
  upsertOperatingHours,
  upsertServiceSchedulingRule,
  updateSchedulingConfig,
  type OperatingHoursInterval,
  type ScheduleException,
  type SchedulingConfig,
  type ServiceSchedulingRule,
} from "./service";
import { getAvailability, type AvailabilitySlot } from "./availability";
import {
  createSlotHold,
  releaseSlotHold,
  sweepExpiredHolds,
  type SlotHold,
} from "./holds";
import { validateSlotFeasibility, type FeasibilityResult } from "./feasibility";
import { placeholderDurationProvider } from "./durationProvider";
import { availabilityRequestSchema } from "./schemas/scheduling";
import { parseOrThrow } from "./service";

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

// -- Configuration (S17: branches.view / branches.edit) ------------------

export async function getSchedulingConfigAction(branchId: string): Promise<Result<SchedulingConfig>> {
  return run((ctx) => getSchedulingConfig(ctx, branchId));
}

export async function updateSchedulingConfigAction(
  input: unknown,
): Promise<Result<SchedulingConfig>> {
  return run((ctx) => updateSchedulingConfig(ctx, input as Parameters<typeof updateSchedulingConfig>[1] & { branch_id: string }));
}

// -- Operating hours (S2) -------------------------------------------------

export async function listOperatingHoursAction(
  branchId: string,
): Promise<Result<OperatingHoursInterval[]>> {
  return run((ctx) => listOperatingHours(ctx, branchId));
}

export async function upsertOperatingHoursAction(input: unknown): Promise<Result<OperatingHoursInterval[]>> {
  return run((ctx) => upsertOperatingHours(ctx, input as Parameters<typeof upsertOperatingHours>[1]));
}

export async function closeOperatingHoursAction(
  input: unknown,
): Promise<Result<{ closed: boolean; created: OperatingHoursInterval[] }>> {
  return run((ctx) => closeOperatingHours(ctx, input as Parameters<typeof closeOperatingHours>[1]));
}

// -- Schedule exceptions (S9/S9b) -----------------------------------------

export async function listScheduleExceptionsAction(
  branchId: string,
): Promise<Result<ScheduleException[]>> {
  return run((ctx) => listScheduleExceptions(ctx, branchId));
}

export async function createScheduleExceptionAction(input: unknown): Promise<Result<ScheduleException>> {
  return run((ctx) => createScheduleException(ctx, input as Parameters<typeof createScheduleException>[1]));
}

export async function deleteScheduleExceptionAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await deleteScheduleException(ctx, input as Parameters<typeof deleteScheduleException>[1]);
    return null;
  });
}

// -- Service scheduling rules (S18) ---------------------------------------

export async function upsertServiceSchedulingRuleAction(input: unknown): Promise<Result<ServiceSchedulingRule>> {
  return run((ctx) => upsertServiceSchedulingRule(ctx, input as Parameters<typeof upsertServiceSchedulingRule>[1]));
}

// -- Availability (customer-safe shape; deterministic) --------------------

export async function getAvailabilityAction(input: {
  branchId: string;
  serviceId: string;
  variantId?: string;
  days?: number;
}): Promise<Result<AvailabilitySlot[]>> {
  return run((ctx) => {
    // §60: server-side Zod validation of the availability request before any
    // domain work (the horizon is further clamped by branch config, S12).
    const request = parseOrThrow(availabilityRequestSchema, input);
    void ctx;
    return getAvailability(
      { branchId: request.branchId, serviceId: request.serviceId, variantId: request.variantId, days: request.days },
      placeholderDurationProvider,
    );
  });
}

// -- Slot holds (S1) -------------------------------------------------------

export async function createSlotHoldAction(input: unknown): Promise<Result<SlotHold>> {
  return run((ctx) => createSlotHold(ctx, input as Parameters<typeof createSlotHold>[1]));
}

export async function releaseSlotHoldAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await releaseSlotHold(ctx, input as Parameters<typeof releaseSlotHold>[1]);
    return null;
  });
}

export async function sweepExpiredHoldsAction(branchId?: string): Promise<Result<number>> {
  return run((ctx) => sweepExpiredHolds(ctx, branchId));
}

// -- Booking-boundary primitive (S16 stage 3) ------------------------------

export async function validateSlotFeasibilityAction(input: unknown): Promise<Result<FeasibilityResult>> {
  return run((ctx) =>
    validateSlotFeasibility(
      input as Parameters<typeof validateSlotFeasibility>[0],
      placeholderDurationProvider,
    ).then((r) => {
      void ctx;
      return r;
    }),
  );
}
