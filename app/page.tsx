import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold">CLENQO Platform</h1>
      <p className="mt-4 text-gray-600">
        One centralized application. Many branches. Branches are
        data/configuration, never separate codebases.
      </p>
      <Link
        href="/admin/branches"
        className="mt-8 inline-flex rounded-lg bg-[#07742F] px-5 py-2.5 font-medium text-white hover:bg-[#055c24]"
      >
        Branch administration
      </Link>
    </main>
  );
}
