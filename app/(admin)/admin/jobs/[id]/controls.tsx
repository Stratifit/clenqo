"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignCleanerAction,
  unassignCleanerAction,
  completeJobAction,
  listEmployeesAction,
} from "@/features/worker/actions";

export default function JobAssignmentControls({
  jobId,
  jobStatus,
  requiredSkills,
}: {
  jobId: string;
  jobStatus: string;
  requiredSkills: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [employees, setEmployees] = useState<
    Array<{ id: string; first_name: string; last_name: string; employee_number: string }>
  >([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const mutable = jobStatus === "pending" || jobStatus === "assigned";

  async function loadEmployees() {
    setLoadingEmployees(true);
    const res = await listEmployeesAction({ status: "active", limit: 200 });
    setLoadingEmployees(false);
    if (res.success) {
      setEmployees(res.data);
    } else {
      setMessage({ kind: "error", text: `${res.error.code}: ${res.error.message}` });
    }
  }

  function run(fn: () => Promise<{ success: boolean; error?: { code: string; message: string } }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.success && res.error) {
        setMessage({ kind: "error", text: `${res.error.code}: ${res.error.message}` });
      } else {
        router.refresh();
      }
    });
  }

  if (!mutable) {
    return (
      <p className="mt-8 text-sm text-gray-500">
        This job is <span className="font-medium">{jobStatus.replace("_", " ")}</span> — assignment
        controls are closed.
      </p>
    );
  }

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Assignment
      </h2>
      {requiredSkills.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Required skills: {requiredSkills.map((s) => s.replace(/_/g, " ")).join(", ")}
        </p>
      )}

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            message.kind === "error"
              ? "border border-red-200 bg-red-50 text-red-800"
              : "border border-green-200 bg-green-50 text-green-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {employees.length === 0 ? (
          <button
            type="button"
            onClick={loadEmployees}
            disabled={loadingEmployees}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingEmployees ? "Loading…" : "Load active employees"}
          </button>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select cleaner…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.first_name} {e.last_name} ({e.employee_number})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selected || pending}
              onClick={() =>
                run(() =>
                  selected
                    ? assignCleanerAction({ job_id: jobId, employee_id: selected })
                    : Promise.resolve({ success: false }),
                )
              }
              className="rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
            >
              {pending ? "Working…" : "Assign"}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => unassignCleanerAction({ job_id: jobId, reason: "manager_unassigned" }))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Unassign
        </button>
        <button
          type="button"
          disabled={pending || jobStatus !== "assigned"}
          onClick={() => run(() => completeJobAction(jobId))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Mark completed
        </button>
      </div>
    </div>
  );
}
