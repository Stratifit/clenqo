import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3 text-sm">
          <Link href="/" className="font-semibold text-[#07742F]">
            CLENQO
          </Link>
          <Link href="/admin/branches" className="text-gray-600 hover:text-[#07742F]">
            Branches
          </Link>
          <Link href="/admin/employees" className="text-gray-600 hover:text-[#07742F]">
            Employees
          </Link>
          <Link href="/admin/jobs" className="text-gray-600 hover:text-[#07742F]">
            Jobs
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
