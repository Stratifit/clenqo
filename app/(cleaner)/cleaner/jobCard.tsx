import Link from "next/link";
import type { CleanerJobView } from "@/features/cleaner/actions";

/** Minimized job card (BD-C1): branch-local time, service label, status. */
export default function JobCard({ job, label }: { job: CleanerJobView; label: string }) {
  const start = new Date(job.scheduled_start);
  const time = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: job.timezone });
  const customer = job.customer_first_name
    ? `${job.customer_first_name}${job.customer_last_initial ? ` ${job.customer_last_initial}.` : ""}`
    : "Customer";
  const address = job.service_address as { street?: string; house_number?: string; city?: string } | null;

  return (
    <Link href={`/cleaner/jobs/${job.id}`} className="cleaner-card block active:opacity-80">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{time}</span>
        <span className="cleaner-badge bg-[#07742F]/10 text-[#07742F]">{label}</span>
      </div>
      <p className="mt-1 text-sm">{job.service_label ?? "Cleaning job"}</p>
      <p className="text-sm text-gray-500">
        {customer}
        {address?.street ? ` · ${address.street} ${address.house_number ?? ""}, ${address.city ?? ""}` : ""}
      </p>
    </Link>
  );
}
