import Link from "next/link";
import { listEmployeesAction } from "@/features/worker/actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  temporarily_unavailable: "bg-amber-100 text-amber-800",
  on_leave: "bg-blue-100 text-blue-800",
  inactive: "bg-gray-200 text-gray-600",
};

export default async function EmployeesPage() {
  const result = await listEmployeesAction({});
  const employees = result.success ? result.data : [];
  const error = result.success ? null : result.error;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold">Employees</h1>
      <p className="mt-1 text-sm text-gray-500">
        Workforce records — branch authorization, employment status, skills.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error.code}: {error.message}
        </p>
      )}

      {employees.length === 0 && !error ? (
        <p className="mt-10 text-sm text-gray-500">No employees yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {employees.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link
                  href={`/admin/employees/${e.id}`}
                  className="font-medium text-[#07742F] hover:underline"
                >
                  {e.first_name} {e.last_name}
                </Link>
                <p className="text-xs text-gray-500">
                  {e.employee_number} · {e.employment_type.replace("_", " ")}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[e.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {e.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
