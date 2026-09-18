/**
 * Lightweight offline action queue (Change 7, task 8; design §8; BD-C5).
 *
 * NOT offline-first: a client-side queue of idempotent execution actions
 * that replays deterministically when connectivity returns. The server is
 * authoritative — replaying an already-applied action is an acknowledged
 * no-op (execution contracts are idempotent), and a stale replay returns
 * a deterministic conflict that the queue surfaces as an error state.
 * Media upload is NEVER queued (BD-C5). No authoritative job state lives
 * only on-device: the queue stores intents, not state. Architecture is
 * additive — it can deepen later without replacing the Worker domain.
 */

export type OfflineActionKind =
  | "en_route"
  | "check_in"
  | "start_work"
  | "checklist_item"
  | "incident"
  | "check_out"
  | "complete";

export interface OfflineAction {
  /** Client-generated idempotency key — deterministic replays reuse it. */
  id: string;
  kind: OfflineActionKind;
  jobId: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}

export type OfflineActionState = "pending" | "syncing" | "error";

export interface OfflineQueueEntry extends OfflineAction {
  state: OfflineActionState;
  error?: string;
  attempts: number;
}

const STORAGE_KEY = "clenqo.cleaner.offlineQueue.v1";

function readQueue(): OfflineQueueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: OfflineQueueEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full/unavailable — the explicit error state surfaces it.
  }
}

export function enqueueOfflineAction(action: Omit<OfflineAction, "id" | "createdAt">, idempotencyKey: string): OfflineQueueEntry {
  const entries = readQueue();
  // Deterministic ordering: appended at creation order; replay sorts by createdAt.
  const entry: OfflineQueueEntry = {
    ...action,
    id: idempotencyKey,
    createdAt: Date.now(),
    state: "pending",
    attempts: 0,
  };
  writeQueue([...entries, entry]);
  return entry;
}

export function getOfflineQueue(): OfflineQueueEntry[] {
  return readQueue().sort((a, b) => a.createdAt - b.createdAt);
}

export function pendingOfflineCount(): number {
  return readQueue().filter((e) => e.state !== "error").length;
}

function mark(entryId: string, patch: Partial<OfflineQueueEntry>): void {
  writeQueue(readQueue().map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
}

/** Replay the queue in deterministic creation order. Returns remaining entries. */
export async function replayOfflineQueue(
  executor: (action: OfflineAction) => Promise<{ ok: boolean; stale?: boolean }>,
): Promise<OfflineQueueEntry[]> {
  const entries = getOfflineQueue();
  for (const entry of entries) {
    if (entry.state === "error") continue; // failed entries wait for explicit retry
    mark(entry.id, { state: "syncing" });
    try {
      const result = await executor(entry);
      if (result.ok) {
        // Applied (or already applied server-side — idempotent no-op): remove.
        writeQueue(readQueue().filter((e) => e.id !== entry.id));
      } else if (result.stale) {
        // Deterministic stale/conflict response: keep visible as error.
        mark(entry.id, { state: "error", error: "Job state changed on the server. Open the job for the current status." });
      } else {
        mark(entry.id, { state: "error", error: "Action failed." });
      }
    } catch {
      // Connectivity lost mid-replay: back to pending for the next pass.
      mark(entry.id, { state: "pending", attempts: entry.attempts + 1 });
    }
  }
  return getOfflineQueue();
}

export function retryOfflineAction(entryId: string): void {
  mark(entryId, { state: "pending", error: undefined });
}

export function clearOfflineQueue(): void {
  writeQueue([]);
}
