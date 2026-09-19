import { redirect } from "next/navigation";
import { getAuthenticatedUserIdOrNull } from "@/lib/session/server";
import { signInAction } from "./authActions";
import { safeNextPath } from "@/middleware";

export const dynamic = "force-dynamic";

/**
 * Staff login (Change 8, design §7): Supabase Auth email/password; no public
 * signup; safe-`next` redirect (validated in middleware.ts — single source).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(next ?? null);

  const userId = await getAuthenticatedUserIdOrNull();
  if (userId) {
    redirect(target);
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-bold text-[#07742F]">CLENQO</h1>
      <p className="mt-2 text-sm text-gray-600">Sign in to the Control Center.</p>
      <form action={signInAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={target} />
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24]"
        >
          Sign in
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-gray-400">
        No account? Contact your administrator.
      </p>
    </main>
  );
}
