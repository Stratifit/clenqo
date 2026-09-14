import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLENQO",
  description: "Professional cleaning, operated from one platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F3F8EE] text-[#18211C] antialiased">
        {children}
      </body>
    </html>
  );
}
