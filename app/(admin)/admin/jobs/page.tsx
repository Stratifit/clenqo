import Link from "next/link";
import { listJobsAction } from "@/features/worker/actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  assigned: "bg-blue-100 text-blue-800",
  en_route: "bg-indigo-100 text-indigo-800",
  checked_in: "bg-indigo-100 text-indigo-800",
  in_progress: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-200 text-gray-600",
};

export default async function JobsPage() {
  const result = await listJobsAction({});
  const jobs = result.success ? result.data : [];
  const error = result.success ? null : result.error;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold">Jobs</h1>
      <p className="mt-1 text-sm text-gray-500">
        Operational work items created from confirmed bookings.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error.code}: {error.message}
        </p>
      )}

      {jobs.length === 0 && !error ? (
        <p className="mt-10 text-sm text-gray-500">No jobs yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link href={`/admin/jobs/${j.id}`} className="font-medium text-[#07742F] hover:underline">
                  {j.job_number}
                </Link>
                <p className="text-xs text-gray-500">
                  {String(j.job_snapshot?.service_label ?? "")} ·{" "}
                  {new Date(j.scheduled_start).toLocaleString("en-GB", { timeZone: j.timezone })}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {j.assignment_flag_reason && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-800">
                    needs reassignment
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-1 font-medium ${STATUS_STYLES[j.status] ?? "bg-gray-100 text-gray-700"}`}
                >
                  {j.status.replace("_", " ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
