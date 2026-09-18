"use client";

/**
 * Client shell (Change 7): registers the service worker (app-shell only),
 * surfaces the update prompt, and shows the offline queue status with a
 * replay executor that maps queued actions to the cleaner server actions
 * (deterministic replay; server authoritative — BD-C5).
 */
import { useEffect, useState } from "react";
import {
  getOfflineQueue,
  replayOfflineQueue,
  retryOfflineAction,
  type OfflineAction,
  type OfflineQueueEntry,
} from "@/features/cleaner/offlineQueue";
import {
  enRouteAction,
  checkInAction,
  startWorkAction,
  checkOutAction,
  completeJobAction,
  completeChecklistItemAction,
  reportIncidentAction,
} from "@/features/cleaner/actions";

export default function CleanerClientShell() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [queue, setQueue] = useState<OfflineQueueEntry[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Sync-then-listen: initial state derives from a microtask (not a
    // synchronous setState within the effect body) to avoid cascading renders.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setQueue(getOfflineQueue());
      setOnline(navigator.onLine);
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/cleaner/sw.js").then((reg) => {
        reg.addEventListener("updatefound", () => setUpdateAvailable(true));
      });
      navigator.serviceWorker.addEventListener("message", (event) => {
        if ((event.data as { type?: string })?.type === "SW_UPDATED") setUpdateAvailable(true);
      });
    }

    const goOnline = () => {
      setOnline(true);
      void replayOfflineQueue(executeQueued).then(setQueue);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const pending = queue.filter((e) => e.state !== "error");
  const errored = queue.filter((e) => e.state === "error");

  if (!updateAvailable && pending.length === 0 && errored.length === 0 && online) return null;

  return (
    <div className="mx-auto max-w-xl px-4 pt-2 text-xs">
      {updateAvailable && (
        <button
          className="cleaner-btn-secondary mb-1"
          onClick={() => window.location.reload()}
          type="button"
        >
          Update available — tap to reload
        </button>
      )}
      {!online && pending.length > 0 && (
        <div className="cleaner-badge bg-amber-100 text-amber-800">
          {pending.length} action{pending.length === 1 ? "" : "s"} queued offline — will sync automatically
        </div>
      )}
      {online && pending.length > 0 && (
        <div className="cleaner-badge bg-blue-100 text-blue-800">Syncing {pending.length} queued action(s)…</div>
      )}
      {errored.length > 0 && (
        <div className="mt-1 rounded-lg border border-red-200 bg-red-50 p-2">
          {errored.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-red-700">{e.error ?? "Action failed."}</span>
              <button
                type="button"
                className="underline text-red-700"
                onClick={() => {
                  retryOfflineAction(e.id);
                  void replayOfflineQueue(executeQueued).then(setQueue);
                }}
              >
                Retry
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Map a queued action to its server action (deterministic replay). */
async function executeQueued(action: OfflineAction): Promise<{ ok: boolean; stale?: boolean }> {
  try {
    let result;
    switch (action.kind) {
      case "en_route":
        result = await enRouteAction(action.jobId);
        break;
      case "check_in":
        result = await checkInAction(action.jobId);
        break;
      case "start_work":
        result = await startWorkAction(action.jobId);
        break;
      case "check_out":
        result = await checkOutAction(action.jobId);
        break;
      case "complete":
        result = await completeJobAction(action.jobId);
        break;
      case "checklist_item":
        result = await completeChecklistItemAction(
          action.payload as { job_id: string; item_id: string; notes?: string | null },
        );
        break;
      case "incident":
        result = await reportIncidentAction(
          action.payload as { job_id: string; incident_type: string; severity?: string | null; description?: string | null },
        );
        break;
      default:
        return { ok: false, stale: true };
    }
    if (result.success) return { ok: true };
    // Deterministic stale handling: state conflicts are stale; everything
    // else (auth/permission) is surfaced as a plain failure.
    const stale = result.error.code === "CONFLICT";
    return { ok: false, stale };
  } catch {
    return { ok: false };
  }
}
