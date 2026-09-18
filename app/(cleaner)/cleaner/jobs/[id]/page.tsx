import { notFound } from "next/navigation";
import { cleanerJobAction, cleanerChecklistAction, listMediaAction } from "@/features/cleaner/actions";
import { getAuthenticatedUserIdOrNull } from "@/lib/session/server";
import ExecutionPanel from "./executionPanel";
import MediaPanel from "./mediaPanel";

export const dynamic = "force-dynamic";

export default async function CleanerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getAuthenticatedUserIdOrNull();
  if (!userId) {
    return (
      <div className="cleaner-card">
        <p className="text-sm text-gray-600">Please sign in to view this job.</p>
      </div>
    );
  }

  const result = await cleanerJobAction(id);
  if (!result.success) notFound(); // fail-closed: not-assigned jobs look like 404
  const job = result.data;

  const checklist = await cleanerChecklistAction(id);
  const media = await listMediaAction(id);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-400">{job.job_number}</p>
        <h1 className="text-lg font-bold">
          {job.service_label ?? "Cleaning job"}
          {job.variant_label ? ` · ${job.variant_label}` : ""}
        </h1>
        <p className="text-sm text-gray-500">
          {new Date(job.scheduled_start).toLocaleString("en-GB", { timeZone: job.timezone, dateStyle: "medium", timeStyle: "short" })}
        </p>
      </header>

      {/* BD-C1 minimized customer information — exactly the allowed field set. */}
      <section className="cleaner-card">
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Customer &amp; address</h2>
        <p className="text-sm">
          {job.customer_first_name}
          {job.customer_last_initial ? ` ${job.customer_last_initial}.` : ""}
        </p>
        {job.customer_phone && (
          <p className="text-sm">
            <a className="text-[#07742F] underline" href={`tel:${job.customer_phone}`}>
              {job.customer_phone}
            </a>
          </p>
        )}
        {job.service_address ? (
          <address className="mt-1 not-italic text-sm text-gray-600">
            {(job.service_address as { street?: string; house_number?: string; postal_code?: string; city?: string }).street}{" "}
            {(job.service_address as { house_number?: string }).house_number}
            <br />
            {(job.service_address as { postal_code?: string }).postal_code}{" "}
            {(job.service_address as { city?: string }).city}
          </address>
        ) : null}
      </section>

      {job.instructions && (
        <section className="cleaner-card">
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Instructions</h2>
          <p className="whitespace-pre-wrap text-sm">{job.instructions}</p>
        </section>
      )}

      <ExecutionPanel jobId={job.id} status={job.status} checklist={checklist.success ? checklist.data : null} />

      <MediaPanel jobId={job.id} media={media.success ? media.data : []} />
    </div>
  );
}
