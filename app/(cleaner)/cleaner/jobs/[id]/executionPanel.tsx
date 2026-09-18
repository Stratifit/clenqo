"use client";

/**
 * Execution panel (Change 7): cleaner actions over the Worker contracts.
 * UI only — all validation/authorization lives server-side. Blocked
 * completion shows the deterministic gate feedback (BD-C9). Failed
 * transitions due to connectivity enqueue onto the offline action queue
 * (BD-C5) with an idempotency key; media is never queued.
 */
import { useState } from "react";
import { enqueueOfflineAction } from "@/features/cleaner/offlineQueue";
import {
  enRouteAction,
  checkInAction,
  startWorkAction,
  checkOutAction,
  completeJobAction,
  completeChecklistItemAction,
  reportIncidentAction,
} from "@/features/cleaner/actions";
import type { ChecklistItemRow, ChecklistSnapshotRow } from "@/features/worker/execution";
import type { Result } from "@/lib/errors";

interface Props {
  jobId: string;
  status: string;
  checklist: { snapshot: ChecklistSnapshotRow | null; items: ChecklistItemRow[] } | null;
}

interface GateDetail {
  pending_mandatory_items?: string[];
  blocking_incidents?: number;
  requires_check_in?: boolean;
}

function failureParts(result: Extract<Result<unknown>, { success: false }>): { blocked: string[]; stale: boolean } {
  const gates = (result.error as { details?: { gates?: GateDetail } }).details?.gates;
  if (gates) {
    const parts: string[] = [];
    if (gates.requires_check_in) parts.push("You need to check in first.");
    if ((gates.pending_mandatory_items ?? []).length > 0) {
      parts.push(`Mandatory checklist items pending: ${gates.pending_mandatory_items!.join(", ")}`);
    }
    if ((gates.blocking_incidents ?? 0) > 0) {
      parts.push(`${gates.blocking_incidents} high/critical incident(s) must be resolved by your manager.`);
    }
    if (parts.length > 0) return { blocked: parts, stale: false };
  }
  return { blocked: [], stale: result.error.code === "CONFLICT" };
}

export default function ExecutionPanel({ jobId, status, checklist }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [blockedInfo, setBlockedInfo] = useState<string[] | null>(null);
  const [localItems, setLocalItems] = useState<ChecklistItemRow[]>(checklist?.items ?? []);
  const [showIncident, setShowIncident] = useState(false);
  const [incidentType, setIncidentType] = useState("access_problem");
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [incidentNotes, setIncidentNotes] = useState("");

  const snapshotItems: ChecklistSnapshotRow["snapshot"] = checklist?.snapshot?.snapshot ?? [];

  /** Run a server action; on connectivity failure enqueue for replay. */
  async function run(kind: "en_route" | "check_in" | "start_work" | "check_out" | "complete", fn: () => Promise<Result<unknown>>): Promise<void> {
    setBusy(true);
    setError(null);
    setQueued(false);
    setBlockedInfo(null);
    try {
      const result = await fn();
      if (!result.success) {
        const { blocked, stale } = failureParts(result);
        if (blocked.length > 0) setBlockedInfo(blocked);
        else if (typeof navigator !== "undefined" && !navigator.onLine) {
          enqueueOfflineAction({ kind, jobId }, `${kind}:${jobId}`);
          setQueued(true);
        } else if (stale) {
          setError("This job changed on the server — pull to refresh for the current status.");
        } else {
          setError(result.error.message);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cleaner-card space-y-3">
      <h2 className="text-sm font-semibold text-gray-500">Execution</h2>
      {queued && <p className="text-xs text-amber-700">No connection — action queued and will sync automatically.</p>}
      {blockedInfo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold">Completion blocked</p>
          <ul className="mt-1 list-disc pl-4">
            {blockedInfo.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        {status === "assigned" && (
          <>
            <button type="button" disabled={busy} className="cleaner-btn-secondary" onClick={() => void run("en_route", () => enRouteAction(jobId))}>
              On my way
            </button>
            <button type="button" disabled={busy} className="cleaner-btn-primary" onClick={() => void run("check_in", () => checkInAction(jobId))}>
              Check in
            </button>
          </>
        )}
        {status === "en_route" && (
          <button type="button" disabled={busy} className="cleaner-btn-primary col-span-2" onClick={() => void run("check_in", () => checkInAction(jobId))}>
            Check in
          </button>
        )}
        {status === "checked_in" && (
          <button type="button" disabled={busy} className="cleaner-btn-primary col-span-2" onClick={() => void run("start_work", () => startWorkAction(jobId))}>
            Start work
          </button>
        )}
        {(status === "in_progress" || status === "checked_in") && (
          <button type="button" disabled={busy} className="cleaner-btn-secondary col-span-2" onClick={() => void run("check_out", () => checkOutAction(jobId))}>
            Check out
          </button>
        )}
        {status !== "completed" && status !== "cancelled" && (
          <button type="button" disabled={busy} className="cleaner-btn-primary col-span-2" onClick={() => void run("complete", () => completeJobAction(jobId))}>
            Complete job
          </button>
        )}
      </div>

      {/* Checklist (BD-C3): snapshot items with provenance-preserving completion. */}
      {localItems.length > 0 && (
        <div>
          <h3 className="mt-2 text-sm font-semibold text-gray-500">Checklist</h3>
          <ul className="mt-1 space-y-1">
            {localItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-sm">
                  {item.label}
                  {item.mandatory && <span className="ml-1 text-red-500">*</span>}
                  {item.notes && <span className="block text-xs text-gray-400">{item.notes}</span>}
                </span>
                {item.status === "completed" ? (
                  <span className="cleaner-badge bg-green-100 text-green-800">done</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="cleaner-badge bg-gray-100 text-gray-700"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await completeChecklistItemAction({ job_id: jobId, item_id: item.id });
                        if (res.success) {
                          setLocalItems((prev) => prev.map((i) => (i.id === item.id ? res.data : i)));
                        } else if (typeof navigator !== "undefined" && !navigator.onLine) {
                          enqueueOfflineAction(
                            { kind: "checklist_item", jobId, payload: { job_id: jobId, item_id: item.id } },
                            `chk:${item.id}:${jobId}`,
                          );
                        } else {
                          setError(res.error.message);
                        }
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    done
                  </button>
                )}
              </li>
            ))}
          </ul>
          {snapshotItems.some((s) => s.mandatory) && (
            <p className="mt-1 text-xs text-gray-400">* mandatory — required before completion</p>
          )}
        </div>
      )}

      {/* Incident reporting (existing Worker incidents model — no new domain). */}
      {status !== "completed" && status !== "cancelled" && (
        <div>
          {!showIncident ? (
            <button type="button" className="cleaner-btn-secondary" onClick={() => setShowIncident(true)}>
              Report an incident
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <select className="w-full rounded-lg border border-gray-300 p-2 text-sm" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
                <option value="access_problem">Access problem</option>
                <option value="property_damage">Property damage</option>
                <option value="customer_issue">Customer issue</option>
                <option value="safety_issue">Safety issue</option>
                <option value="cleaner_issue">Other issue</option>
                <option value="late_arrival">Late arrival</option>
              </select>
              <select className="w-full rounded-lg border border-gray-300 p-2 text-sm" value={incidentSeverity} onChange={(e) => setIncidentSeverity(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <textarea
                className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                placeholder="What happened?"
                value={incidentNotes}
                onChange={(e) => setIncidentNotes(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                className="cleaner-btn-danger"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await reportIncidentAction({
                      job_id: jobId,
                      incident_type: incidentType,
                      severity: incidentSeverity,
                      description: incidentNotes || null,
                    });
                    if (res.success) {
                      setShowIncident(false);
                      setIncidentNotes("");
                    } else if (typeof navigator !== "undefined" && !navigator.onLine) {
                      enqueueOfflineAction(
                        {
                          kind: "incident",
                          jobId,
                          payload: { job_id: jobId, incident_type: incidentType, severity: incidentSeverity, description: incidentNotes || null },
                        },
                        `inc:${jobId}:${incidentType}`,
                      );
                      setShowIncident(false);
                    } else {
                      setError(res.error.message);
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Submit incident
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
