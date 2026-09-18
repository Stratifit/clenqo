import Link from "next/link";
import { cleanerHomeAction, type CleanerJobView } from "@/features/cleaner/actions";
import { getAuthenticatedUserIdOrNull } from "@/lib/session/server";
import JobCard from "./jobCard";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  en_route: "On my way",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  pending: "Pending",
  cancelled: "Cancelled",
};

export default async function CleanerHomePage() {
  const userId = await getAuthenticatedUserIdOrNull();
  if (!userId) {
    return (
      <div className="cleaner-card">
        <p className="text-sm text-gray-600">Please sign in to view your jobs.</p>
      </div>
    );
  }

  const result = await cleanerHomeAction();
  if (!result.success) {
    return (
      <div className="cleaner-card">
        <p className="text-sm text-gray-600">
          {result.error.code === "UNAUTHENTICATED"
            ? "Please sign in to view your jobs."
            : "You do not currently have cleaner access."}
        </p>
      </div>
    );
  }

  const { today, tomorrow, upcoming, notifications } = result.data;

  return (
    <div className="space-y-6">
      {notifications.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Updates</h2>
          <div className="space-y-1">
            {notifications.slice(0, 5).map((n) => (
              <div key={n.id} className="cleaner-badge bg-blue-50 text-blue-800">
                {n.job_number}: {n.event_type.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        </section>
      )}

      <Section title="Today" jobs={today} empty="No jobs today." />
      <Section title="Tomorrow" jobs={tomorrow} empty="No jobs tomorrow." />
      <Section title="Upcoming" jobs={upcoming} empty="No upcoming jobs." />

      <Link href="/cleaner/today" className="cleaner-btn-secondary block">
        View today&apos;s schedule
      </Link>
    </div>
  );
}

function Section({ title, jobs, empty }: { title: string; jobs: CleanerJobView[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-500">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} label={STATUS_LABELS[job.status] ?? job.status} />
          ))}
        </div>
      )}
    </section>
  );
}
