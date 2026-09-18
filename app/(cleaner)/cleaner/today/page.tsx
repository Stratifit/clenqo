import { cleanerJobsAction } from "@/features/cleaner/actions";
import { getAuthenticatedUserIdOrNull } from "@/lib/session/server";
import JobCard from "../jobCard";

export const dynamic = "force-dynamic";

export default async function CleanerTodayPage() {
  const userId = await getAuthenticatedUserIdOrNull();
  if (!userId) {
    return (
      <div className="cleaner-card">
        <p className="text-sm text-gray-600">Please sign in to view your schedule.</p>
      </div>
    );
  }
  const result = await cleanerJobsAction("today");
  if (!result.success) {
    return (
      <div className="cleaner-card">
        <p className="text-sm text-gray-600">You do not currently have cleaner access.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="mb-3 text-lg font-bold">Today</h1>
      {result.data.length === 0 ? (
        <p className="text-sm text-gray-400">No jobs scheduled today.</p>
      ) : (
        <div className="space-y-2">
          {result.data.map((job) => (
            <JobCard key={job.id} job={job} label={job.status.replace(/_/g, " ")} />
          ))}
        </div>
      )}
    </div>
  );
}
