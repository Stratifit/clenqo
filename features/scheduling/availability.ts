/**
 * Availability engine & deterministic slot generation (Change 3, task 7.x).
 *
 * Implements the approved S18 eight-step pipeline (design §4, normative):
 *   1. Read branch schedule/configuration.
 *   2. Apply schedule exceptions (override the weekly template).
 *   3. Resolve service offering via the catalog read model (`services`
 *      module `listEffectiveCatalog`) — read-only, never re-decided.
 *   4. Obtain authoritative duration from the injected `DurationProvider`.
 *   5. Materialize local intervals into UTC with S14 DST rules.
 *   6. Generate candidate starts on the configured grid (S3).
 *   7. Filter: minimum notice (S4), maximum advance (S5), customer horizon
 *      (S12), occupied intervals incl. buffers (S6), capacity cap (S7).
 *   8. Return customer-safe slots — start/end/timezone/available only
 *      (§25): no pricing, no workforce internals.
 *
 * Determinism contract: same inputs (configuration + state snapshot) ⇒ the
 * same slot list. `now` is an explicit input, never a side effect. This
 * module contains NO pricing logic and NO worker selection (S15 — it counts
 * eligibility, it never chooses a worker).
 */
import "server-only";
import { query } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  localDateString,
  materializeLocalTime,
  weekdayOf,
  assertValidTimeZone,
} from "./timezone";
import type { DurationProvider } from "./durationProvider";
import type { SchedulingConfig } from "./service";

/** Customer-safe availability slot (§25 — the ONLY result shape exposed). */
export interface AvailabilitySlot {
  start: string; // ISO 8601 UTC instant
  end: string; // ISO 8601 UTC instant (promised window: start + duration)
  timezone: string; // branch IANA timezone the customer browses against
  available: boolean;
}

export interface AvailabilityRequest {
  branchId: string;
  serviceId: string;
  variantId?: string;
  /** Query horizon length in days; clamped by branch config (S12). */
  days?: number;
  /**
   * Evaluation instant ("now"). Explicit input for determinism; production
   * callers omit it to use the server clock.
   */
  now?: Date;
}

interface OccupiedInterval {
  start: number; // epoch ms
  end: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ---------------------------------------------------------------------
// Step 1 — branch schedule + configuration
// ---------------------------------------------------------------------

async function loadBranch(branchId: string): Promise<{ id: string; timezone: string }> {
  const res = await query<{ id: string; timezone: string }>(
    `select id, timezone from public.branches where id = $1`,
    [branchId],
  );
  const branch = res.rows[0];
  if (!branch) throw new AppError(ErrorCode.NOT_FOUND, "Branch not found.");
  assertValidTimeZone(branch.timezone);
  return branch;
}

async function loadConfig(branchId: string): Promise<SchedulingConfig> {
  const res = await query<SchedulingConfig>(
    `select branch_id, minimum_notice_minutes, maximum_advance_days,
            slot_grid_minutes, operational_buffer_minutes, travel_buffer_minutes,
            concurrency_cap, customer_horizon_days, hold_ttl_minutes
     from public.branch_scheduling_configuration where branch_id = $1`,
    [branchId],
  );
  const row = res.rows[0];
  if (!row) {
    // Defaults are seeded at provisioning (task 11.1); absence = unseeded.
    throw new AppError(ErrorCode.NOT_FOUND, "Branch scheduling configuration missing.");
  }
  return row;
}

// ---------------------------------------------------------------------
// Step 2 — schedule exceptions override the weekly template (S9)
// ---------------------------------------------------------------------

interface DayResolution {
  intervals: { start: string; end: string }[]; // branch-local wall clock
  closed: boolean;
}

async function resolveDaySchedule(
  branchId: string,
  localDate: string,
  weekday: number,
): Promise<DayResolution> {
  // Exception for this date (typed model, manual V1 source — S9b).
  const exc = await query<{ exception_type: string; intervals: { start: string; end: string }[] | null }>(
    `select exception_type, intervals
     from public.branch_schedule_exceptions
     where branch_id = $1 and start_date <= $2::date and end_date >= $2::date
     order by created_at desc limit 1`,
    [branchId, localDate],
  );
  if (exc.rows[0]) {
    const e = exc.rows[0];
    if (e.exception_type === "closed" || e.exception_type === "blackout") {
      return { intervals: [], closed: true };
    }
    if (e.exception_type === "reduced_hours") {
      // Replacement intervals for the date (validated by Zod at write time).
      if (e.intervals && e.intervals.length > 0) return { intervals: e.intervals, closed: false };
      return { intervals: [], closed: true };
    }
    // holiday_override: fall through to explicit rows if present, else closed.
    if (e.intervals && e.intervals.length > 0) return { intervals: e.intervals, closed: false };
    return { intervals: [], closed: true };
  }

  // Weekly template: effective-dated rows; closed day = no rows (S2).
  const rows = await query<{ start_time: string; end_time: string }>(
    `select start_time::text, end_time::text
     from public.branch_operating_hours
     where branch_id = $1 and weekday = $2
       and effective_from <= $3::date
       and (effective_until is null or effective_until >= $3::date)
     order by interval_index asc`,
    [branchId, weekday, localDate],
  );
  if (rows.rows.length === 0) return { intervals: [], closed: true };
  return {
    intervals: rows.rows.map((r) => ({ start: r.start_time, end: r.end_time })),
    closed: false,
  };
}

// ---------------------------------------------------------------------
// Step 3 — service offering gate (catalog read model, read-only)
// ---------------------------------------------------------------------

async function serviceOffered(branchId: string, serviceId: string): Promise<boolean> {
  // Same bookability conjunction as the catalog read model (Q2/Q4): service
  // active+enabled within an active+enabled category. Read-only consumption —
  // scheduling never mutates or duplicates catalog state.
  const res = await query<{ exists: boolean }>(
    `select exists(
       select 1
       from public.services s
       join public.service_categories c on c.id = s.category_id
       where s.id = $1
         and s.branch_id = $2
         and s.status = 'active' and s.is_enabled
         and c.status = 'active' and c.is_enabled
     ) as exists`,
    [serviceId, branchId],
  );
  return res.rows[0]?.exists === true;
}

// ---------------------------------------------------------------------
// Service scheduling rules (S18 step 3) — optional windows/weekdays
// ---------------------------------------------------------------------

interface ServiceRule {
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
}

async function loadServiceRule(branchId: string, serviceId: string): Promise<ServiceRule | null> {
  const res = await query<ServiceRule>(
    `select weekday, start_time::text, end_time::text from public.service_scheduling_rules
     where branch_id = $1 and service_id = $2
     order by (weekday is null) asc, weekday asc limit 1`,
    [branchId, serviceId],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------
// Step 7 inputs — occupancy (committed jobs + ACTIVE holds) and capacity
// ---------------------------------------------------------------------

async function loadOccupied(branchId: string, windowStart: Date, windowEnd: Date): Promise<OccupiedInterval[]> {
  const out: OccupiedInterval[] = [];
  const params = [branchId, windowStart.toISOString(), windowEnd.toISOString()];

  // Active holds (S1 — the single blocking mechanism; read-time expiry:
  // rows past expires_at are ignored/expired here, never trusted as blockers).
  const holds = await query<{ start_time: string; end_time: string; expires_at: string }>(
    `select start_time, end_time, expires_at from public.slot_holds
     where branch_id = $1 and status = 'held' and expires_at > now()
       and tstzrange(start_time, end_time) && tstzrange($2::timestamptz, $3::timestamptz)`,
    params,
  );
  for (const h of holds.rows) {
    out.push({ start: new Date(h.start_time).getTime(), end: new Date(h.end_time).getTime() });
  }

  // Committed occupancy = committed bookings (BD-W13/TD-W10: bookings are
  // the SINGLE authoritative occupancy source). The Change 3 speculative
  // `jobs` probe was removed in Change 6: every booking-sourced job is
  // already covered by its booking row, so counting jobs would double-count.
  // Bookings in blocking statuses occupy; cancelled never does; no_show and
  // completed are past-start in practice but kept for overlap correctness.
  const bookings = await query<{ scheduled_start: string; scheduled_end: string }>(
    `select b.scheduled_start, b.scheduled_end
     from public.bookings b
     where b.branch_id = $1
       and b.status in ('confirmed', 'assigned', 'in_progress', 'completed')
       and b.scheduled_start < $3::timestamptz and b.scheduled_end > $2::timestamptz`,
    params,
  );
  for (const b of bookings.rows) {
    out.push({
      start: new Date(b.scheduled_start).getTime(),
      end: new Date(b.scheduled_end).getTime(),
    });
  }

  return out;
}

// ---------------------------------------------------------------------
// The engine (steps 5–8)
// ---------------------------------------------------------------------

/**
 * Compute customer-safe availability slots (S18). Pure w.r.t. inputs:
 * configuration + state + `now` ⇒ deterministic slot list.
 */
export async function getAvailability(
  request: AvailabilityRequest,
  durationProvider: DurationProvider,
): Promise<AvailabilitySlot[]> {
  const now = request.now ?? new Date();
  const branch = await loadBranch(request.branchId);
  const cfg = await loadConfig(request.branchId);
  const tz = branch.timezone;

  // Step 3 — offering gate.
  if (!(await serviceOffered(request.branchId, request.serviceId))) {
    return []; // disabled service produces no slots (spec scenario)
  }

  // Step 4 — authoritative duration (injected contract; never computed here).
  const durationMinutes = await durationProvider.getEstimatedDuration({
    branchId: request.branchId,
    serviceId: request.serviceId,
    variantId: request.variantId,
  });
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
    throw new AppError(ErrorCode.CONFLICT, "Duration provider returned an invalid duration.");
  }
  const durationMs = durationMinutes * MINUTE;
  const buffersMs = (cfg.operational_buffer_minutes + cfg.travel_buffer_minutes) * MINUTE;

  // Query bounds: customer horizon (S12) clamped by max advance (S5).
  const horizonDays = Math.min(request.days ?? cfg.customer_horizon_days, cfg.customer_horizon_days);
  const windowStart = new Date(now.getTime() + cfg.minimum_notice_minutes * MINUTE);
  const windowEnd = new Date(
    Math.min(now.getTime() + horizonDays * DAY, now.getTime() + cfg.maximum_advance_days * DAY),
  );
  if (windowEnd <= windowStart) return [];

  // Occupancy snapshot for the (buffer-extended) evaluation window.
  const occupied = await loadOccupied(
    request.branchId,
    new Date(windowStart.getTime() - buffersMs),
    new Date(windowEnd.getTime() + durationMs + buffersMs),
  );
  const cap = cfg.concurrency_cap;

  const rule = await loadServiceRule(request.branchId, request.serviceId);
  const slots: AvailabilitySlot[] = [];

  // Walk branch-local calendar days across the evaluation window (step 5–6).
  let dayInstant = windowStart;
  const seenDates = new Set<string>();
  while (dayInstant.getTime() <= windowEnd.getTime() + DAY) {
    const localDate = localDateString(dayInstant, tz);
    dayInstant = new Date(dayInstant.getTime() + DAY);
    if (seenDates.has(localDate)) continue;
    seenDates.add(localDate);

    const weekday = weekdayOf(new Date(`${localDate}T12:00:00Z`), tz);
    const daySchedule = await resolveDaySchedule(request.branchId, localDate, weekday);
    if (daySchedule.closed) continue;

    // Service scheduling rule wins over the branch template (S18 step 3);
    // fallback = branch window. A specific weekday rule beats the null
    // (every-open-day) rule for that day.
    let windows = daySchedule.intervals;
    const specific = rule && rule.weekday === weekday ? rule : null;
    const generic = rule && rule.weekday === null ? rule : null;
    const effective = specific ?? generic;
    if (effective && effective.start_time && effective.end_time) {
      windows = [{ start: effective.start_time, end: effective.end_time }];
    }
    if (!windows || windows.length === 0) continue;

    for (const w of windows) {
      // Step 5 — materialize per date into UTC (S14). Nonexistent candidate
      // starts are skipped; ambiguous starts take the FIRST occurrence.
      const startMat = materializeLocalTime(localDate, w.start, tz);
      if (startMat.kind === "nonexistent") continue; // spring-forward skip
      const endMat = materializeLocalTime(localDate, w.end, tz);
      if (endMat.kind === "nonexistent") continue;
      const windowStartMs = startMat.instant.getTime();
      const windowEndMs = endMat.instant.getTime();
      if (windowEndMs <= windowStartMs) continue; // S13 guard

      // Step 6 — candidate starts on the configured grid.
      const firstCandidate = Math.max(windowStartMs, alignToGrid(windowStartMs, cfg.slot_grid_minutes));
      for (let startMs = firstCandidate; startMs + durationMs <= windowEndMs; startMs += cfg.slot_grid_minutes * MINUTE) {
        const mat = materializeLocalTime(localDate, hhmm(startMs, tz), tz);
        if (mat.kind === "nonexistent") continue; // DST gap inside the window
        const promisedEndMs = startMs + durationMs;
        const bufferedStart = startMs - buffersMs;
        const bufferedEnd = promisedEndMs + buffersMs;

        // Step 7 — filters.
        if (startMs < windowStart.getTime()) continue; // S4 notice
        // S5/S12 clamp: the whole promised job must fit inside the window.
        if (startMs >= windowEnd.getTime() || promisedEndMs > windowEnd.getTime()) continue;
        // S7 — capacity: count overlapping buffered intervals; at cap ⇒ full.
        const concurrent = occupied.filter((o) => o.start < bufferedEnd && o.end > bufferedStart).length;
        const available = concurrent < cap;

        slots.push({
          start: new Date(startMs).toISOString(),
          end: new Date(promisedEndMs).toISOString(),
          timezone: tz,
          available,
        });
      }
    }
  }

  // Step 8 — customer-safe ordering, no dedupe issues by construction.
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

function alignToGrid(epochMs: number, gridMinutes: number): number {
  // Grid aligns to wall-clock quarters within the local day; computing from
  // the epoch keeps determinism across DST (candidates re-derived per date).
  const gridMs = gridMinutes * MINUTE;
  return Math.ceil(epochMs / gridMs) * gridMs;
}

/** Branch-local `HH:MM` of an epoch instant. */
function hhmm(epochMs: number, tz: string): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
