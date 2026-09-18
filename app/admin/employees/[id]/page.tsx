import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getEmployeeAction,
  getEmployeeSkillsAction,
  getEmployeeAvailabilityAction,
  getEmployeeExceptionsAction,
} from "@/features/worker/actions";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getEmployeeAction(id);
  if (!result.success) notFound();
  const employee = result.data;

  const skills = await getEmployeeSkillsAction(id);
  const availability = await getEmployeeAvailabilityAction(id);
  const exceptions = await getEmployeeExceptionsAction(id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/employees" className="text-sm text-[#07742F] hover:underline">
        ← All employees
      </Link>
      <h1 className="mt-4 text-2xl font-bold">
        {employee.first_name} {employee.last_name}
      </h1>
      <p className="text-sm text-gray-500">
        {employee.employee_number} · {employee.employment_type.replace("_", " ")} ·{" "}
        {employee.status.replace("_", " ")}
        {employee.phone ? ` · ${employee.phone}` : ""}
        {employee.email ? ` · ${employee.email}` : ""}
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Authorized branches
        </h2>
        <p className="mt-2 text-sm">
          {employee.branches.length === 0 ? (
            <span className="text-gray-500">None — not eligible for assignment.</span>
          ) : (
            employee.branches.join(", ")
          )}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Skills</h2>
        {skills.success && skills.data.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {skills.data.map((s: { id: string; skill_key: string; expiry_date: string | null }) => (
              <li key={s.id}>
                {s.skill_key.replace(/_/g, " ")}
                {s.expiry_date ? ` · qualification expires ${s.expiry_date}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No skills recorded.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recurring availability
        </h2>
        {availability.success && availability.data.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {availability.data.map(
              (a: { id: string; weekday: number; start_time: string; end_time: string }) => (
                <li key={a.id}>
                  weekday {a.weekday} · {a.start_time}–{a.end_time}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            No recurring windows — availability exceptions only.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Availability exceptions
        </h2>
        {exceptions.success && exceptions.data.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {exceptions.data.map(
              (x: { id: string; exception_type: string; start_at: string; end_at: string }) => (
                <li key={x.id}>
                  {x.exception_type} · {x.start_at} → {x.end_at}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">None.</p>
        )}
      </section>
    </main>
  );
}
