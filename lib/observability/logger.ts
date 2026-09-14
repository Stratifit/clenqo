/**
 * Observability: structured diagnostic logging + counters
 * (OBSERVABILITY.md §5, §9, §17).
 *
 * Telemetry is diagnostic, NOT authoritative — audit records are the
 * business truth (design §4). All emission happens outside database
 * transactions; nothing here blocks or fails business operations.
 * Sensitive values are redacted before serialization (OBSERVABILITY §…sensitive).
 */

type LogFields = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|key|credential|authorization|cookie|cvv|card_number)/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as LogFields);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", message: string, fields: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...redact(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields: LogFields = {}) => emit("info", message, fields),
  warn: (message: string, fields: LogFields = {}) => emit("warn", message, fields),
  error: (message: string, fields: LogFields = {}) => emit("error", message, fields),
};

// ---------------------------------------------------------------------
// Metrics (in-memory counters/gauges; exported to the platform monitor
// later — OBSERVABILITY.md §17 provisioning signals)
// ---------------------------------------------------------------------

const counters = new Map<string, number>();
const durationsMs: number[] = [];

export const metrics = {
  increment(name: string, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },
  observeDuration(name: string, ms: number): void {
    durationsMs.push(ms);
    counters.set(`${name}_count`, (counters.get(`${name}_count`) ?? 0) + 1);
  },
  snapshot(): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries(counters);
    if (durationsMs.length > 0) {
      out["provisioning_duration_ms_avg"] =
        durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
    }
    return out;
  },
};
