import Link from "next/link";
import { notFound } from "next/navigation";
import { getBranchAction, checkActivationReadinessAction } from "@/features/branches/actions";
import type { BranchRecord } from "@/features/branches/service";
import BranchAdminControls from "./controls";

export const dynamic = "force-dynamic";

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getBranchAction(id);
  if (!result.success) notFound();
  const branch: BranchRecord = result.data;

  const readiness = await checkActivationReadinessAction(id);
  const readinessData = readiness.success ? readiness.data : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/branches" className="text-sm text-[#07742F] hover:underline">
        ← All branches
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{branch.name}</h1>
      <p className="text-sm text-gray-500">
        /{branch.slug} · {branch.timezone} · {branch.currency} · default locale:{" "}
        {branch.locale}
      </p>

      <div className="mt-6 flex gap-2 text-xs">
        <span
          className={`rounded-full px-3 py-1 font-medium ${
            branch.provisioning_status === "ready"
              ? "bg-green-100 text-green-800"
              : branch.provisioning_status === "failed"
                ? "bg-red-100 text-red-800"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          provisioning: {branch.provisioning_status}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">
          status: {branch.status}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">
          attempts: {branch.provisioning_attempts}
        </span>
      </div>

      {branch.provisioning_status === "failed" && branch.provisioning_error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-800">
            Provisioning failed (recoverable)
          </p>
          <p className="mt-1 text-xs text-red-700">
            Stage: {branch.provisioning_stage} · {branch.provisioning_error}
          </p>
        </div>
      )}

      <BranchAdminControls branchId={branch.id} provisioningStatus={branch.provisioning_status} />

      <h2 className="mt-10 text-lg font-semibold">Activation readiness</h2>
      <p className="text-xs text-gray-500">
        Activation is a separate authorized operation and requires all mandatory
        configuration (services, pricing, hours, etc.).
      </p>
      {readinessData && (
        <ul className="mt-4 space-y-2">
          {readinessData.items.map((item) => (
            <li key={item.requirement} className="flex items-center gap-2 text-sm">
              <span className={item.satisfied ? "text-green-600" : "text-red-500"}>
                {item.satisfied ? "✓" : "✗"}
              </span>
              <span className="font-mono text-xs">{item.requirement}</span>
              {item.note && <span className="text-xs text-gray-400">— {item.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
