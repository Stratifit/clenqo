/**
 * Deterministic timezone materialization (Change 3, S14 — design §5).
 *
 * Branch timezone (IANA) is authoritative; all storage and comparison uses
 * absolute UTC instants (`timestamptz`). Every local wall-clock interval is
 * materialized **per date** into UTC before any comparison — never at render
 * time, never via ambient locale.
 *
 * S14 rules implemented here:
 *   - Spring-forward: a candidate local time that does not exist on its date
 *     is SKIPPED (the engine generates no slot for it); a weekly
 *     configuration that *always* contains a nonexistent time is rejected at
 *     configuration time (see `listNonexistentLocalTimes`).
 *   - Fall-back: an ambiguous local time resolves to the EARLIER (first)
 *     occurrence — one rule, applied in slots, holds, and bookings.
 *
 * Implementation notes: Node's full-ICU `Intl.DateTimeFormat` with
 * `timeZone` + `hourCycle: "h23"` provides exact wall-clock decompositions
 * for arbitrary IANA zones (Node 18+ always full-icu; this repo pins
 * engines >= 20). Offsets are derived by round-tripping candidate instants,
 * not by parsing zone tables.
 */
import { AppError, ErrorCode } from "@/lib/errors";

/** 0 = Sunday … 6 = Saturday — matches JS getDay() and migration 0009. */
export function weekdayOf(date: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/** `YYYY-MM-DD` of the branch-local calendar day containing `instant`. */
export function localDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function localDateTimeParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts;
}

/**
 * Materialize one branch-local wall-clock time on a concrete local date to an
 * absolute UTC instant — S14 deterministic, DST-safe:
 *
 * - Nonexistent spring-forward times are detected (instant round-trips to a
 *   different wall clock) and reported; the availability engine SKIPS these
 *   candidates (S14).
 * - Ambiguous fall-back times resolve to the EARLIER occurrence (S14).
 *
 * @param localDate `YYYY-MM-DD` (branch-local)
 * @param localTime `HH:MM` 24h (branch-local)
 */
export function materializeLocalTime(
  localDate: string,
  localTime: string,
  timeZone: string,
): { instant: Date; kind: "unique" | "ambiguous" | "nonexistent" } {
  const [y, mo, d] = localDate.split("-").map(Number);
  const [h, mi] = localTime.split(":").map(Number);

  // Probe the instant assuming UTC, then correct by the measured offset.
  const probe = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const off1 = utcOffsetMs(new Date(probe), timeZone);
  let instant = new Date(probe - off1);
  const off2 = utcOffsetMs(instant, timeZone);
  if (off2 !== off1) {
    // Offset differs on either side of a transition; re-derive once.
    instant = new Date(probe - off2);
  }

  const parts = localDateTimeParts(instant, timeZone);
  const showsSameWallClock =
    parts.year === y && parts.month === mo && parts.day === d && parts.hour === h && parts.minute === mi;

  if (showsSameWallClock) {
    // Round-trips exactly — but the time may still be AMBIGUOUS (fall-back
    // repeats it): test the candidate 2h earlier; if it also shows the same
    // wall clock, the earlier instant is the first occurrence (S14).
    const probeEarlier = new Date(instant.getTime() - 2 * 3600_000);
    const offEarlier = utcOffsetMs(probeEarlier, timeZone);
    const earlierCandidate = new Date(probe - offEarlier);
    const partsEarlier = localDateTimeParts(earlierCandidate, timeZone);
    const earlierSame =
      partsEarlier.year === y &&
      partsEarlier.month === mo &&
      partsEarlier.day === d &&
      partsEarlier.hour === h &&
      partsEarlier.minute === mi;
    if (earlierSame && earlierCandidate.getTime() < instant.getTime()) {
      return { instant: earlierCandidate, kind: "ambiguous" }; // first occurrence
    }
    return { instant, kind: "unique" };
  }

  // Round-trip lands on a different wall clock → the requested local time
  // does not exist on this date (spring-forward gap).
  return { instant: new Date(instant.getTime()), kind: "nonexistent" };
}

/** UTC offset (ms) of `timeZone` at the given instant. */
function utcOffsetMs(instant: Date, timeZone: string): number {
  const parts = localDateTimeParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return asUtc - instant.getTime();
}

/**
 * Validate a weekly configuration (S14 configuration-time rule): a weekday
 * window whose local time never exists in the branch timezone (e.g. 02:30 in
 * a zone whose spring-forward permanently skips 02:30–03:00) is rejected
 * before persistence. Returns the offending times.
 */
export function findAlwaysNonexistentLocalTimes(
  times: string[],
  timeZone: string,
): string[] {
  // Probe one date safely inside the year, far from Jan 1 edge cases.
  const probeDates = [
    `${new Date().getUTCFullYear()}-07-01`,
    `${new Date().getUTCFullYear()}-12-15`,
  ];
  const offenders: string[] = [];
  for (const t of times) {
    const allMissing = probeDates.every(
      (d) => materializeLocalTime(d, t, timeZone).kind === "nonexistent",
    );
    if (allMissing) offenders.push(t);
  }
  return offenders;
}

/** Guard against invalid IANA zone ids at the domain boundary. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new AppError(ErrorCode.INVALID_INPUT, `Unknown timezone: ${timeZone}`);
  }
}
