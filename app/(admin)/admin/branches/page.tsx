import Link from "next/link";
import { listBranchesAction } from "@/features/branches/actions";
import type { BranchRecord } from "@/features/branches/service";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const result = await listBranchesAction();
  const branches: BranchRecord[] = result.success ? result.data : [];
  const error = result.success ? null : result.error;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Branches</h1>
        <Link
          href="/admin/branches/new"
          className="rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24]"
        >
          New branch
        </Link>
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error.code}: {error.message}
        </p>
      )}

      {branches.length === 0 && !error ? (
        <p className="mt-10 text-sm text-gray-500">
          No branches yet. Create the first one.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {branches.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link
                  href={`/admin/branches/${b.id}`}
                  className="font-medium text-[#07742F] hover:underline"
                >
                  {b.name}
                </Link>
                <p className="text-xs text-gray-500">
                  /{b.slug} · {b.timezone} · {b.currency}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2.5 py-1 font-medium ${
                    b.provisioning_status === "ready"
                      ? "bg-green-100 text-green-800"
                      : b.provisioning_status === "failed"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  provisioning: {b.provisioning_status}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                  {b.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
