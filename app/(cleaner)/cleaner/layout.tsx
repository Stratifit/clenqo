import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./cleaner.css";
import CleanerClientShell from "./clientShell";

export const metadata: Metadata = {
  title: "CLENQO Cleaner",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CLENQO" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#07742F",
};

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cleaner-app min-h-screen bg-[#F3F8EE] text-[#18211C]">
      <CleanerClientShell />
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link href="/cleaner" className="text-base font-bold text-[#07742F]">
            CLENQO Cleaner
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/cleaner" className="text-gray-600">
              Home
            </Link>
            <Link href="/cleaner/today" className="text-gray-600">
              Today
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
    </div>
  );
}
