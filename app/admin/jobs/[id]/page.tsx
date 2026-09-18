import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getJobAction,
  getJobAssignmentsAction,
  getJobIncidentsAction,
} from "@/features/worker/actions";
import JobAssignmentControls from "./controls";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getJobAction(id);
  if (!result.success) notFound();
  const job = result.data;

  const assignments = await getJobAssignmentsAction(id);
  const incidents = await getJobIncidentsAction(id);

  const snapshot = job.job_snapshot as {
    booking_number?: string;
    service_label?: string;
    variant_label?: string | null;
    addon_labels?: string[];
    service_address?: { label?: string; street?: string; city?: string; postal_code?: string } | null;
    customer_display?: { first_name?: string; last_initial?: string } | null;
    instructions?: string | null;
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/jobs" className="text-sm text-[#07742F] hover:underline">
        ← All jobs
      </Link>
      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{job.job_number}</h1>
        {job.assignment_flag_reason && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">
            assignment needs replacement: {job.assignment_flag_reason}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500">
        {snapshot.service_label}
        {snapshot.variant_label ? ` · ${snapshot.variant_label}` : ""}
        {snapshot.addon_labels && snapshot.addon_labels.length > 0
          ? ` · + ${snapshot.addon_labels.join(", ")}`
          : ""}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">Status</dt>
        <dd>{job.status.replace("_", " ")}</dd>
        <dt className="text-gray-500">Scheduled</dt>
        <dd>
          {new Date(job.scheduled_start).toLocaleString("en-GB", { timeZone: job.timezone })} —{" "}
          {new Date(job.scheduled_end).toLocaleTimeString("en-GB", { timeZone: job.timezone })}
        </dd>
        <dt className="text-gray-500">Booking</dt>
        <dd>{snapshot.booking_number ?? "—"}</dd>
        <dt className="text-gray-500">Customer</dt>
        <dd>
          {snapshot.customer_display
            ? `${snapshot.customer_display.first_name} ${snapshot.customer_display.last_initial ?? ""}.`
            : "—"}
        </dd>
        <dt className="text-gray-500">Address</dt>
        <dd>
          {snapshot.service_address
            ? [snapshot.service_address.street, snapshot.service_address.postal_code, snapshot.service_address.city]
                .filter(Boolean)
                .join(", ")
            : "—"}
        </dd>
        {snapshot.instructions ? (
          <>
            <dt className="text-gray-500">Instructions</dt>
            <dd>{snapshot.instructions}</dd>
          </>
        ) : null}
      </dl>

      <JobAssignmentControls
        jobId={job.id}
        jobStatus={job.status}
        requiredSkills={job.required_skills}
      />

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Assignment history
        </h2>
        {assignments.success && assignments.data.length > 0 ? (
          <ul className="mt-2 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {assignments.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>{"employee_name" in a ? a.employee_name : "(cleaner)"}</span>
                <span className="text-xs text-gray-500">
                  {a.assignment_status} · {new Date(a.assigned_at).toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No assignments yet.</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Incidents</h2>
        {incidents.success && incidents.data.length > 0 ? (
          <ul className="mt-2 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {incidents.data.map((i) => (
              <li key={i.id} className="px-5 py-3 text-sm">
                <span className="font-medium">{i.incident_type.replace(/_/g, " ")}</span>{" "}
                <span className="text-xs text-gray-500">
                  {i.status} · {new Date(i.created_at).toLocaleString("en-GB")}
                </span>
                {i.description ? <p className="mt-1 text-gray-600">{i.description}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">None recorded.</p>
        )}
      </section>
    </main>
  );
}
