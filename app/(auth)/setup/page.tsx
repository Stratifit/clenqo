import { getAuthenticatedUserIdOrNull } from "@/lib/session/server";
import { hasActiveHqAdmin } from "@/features/admin/auth";
import { performSetupAction } from "./setupActions";

export const dynamic = "force-dynamic";

/**
 * One-time HQ bootstrap page (BD-A1, design §6). Renders only while zero
 * active HQ Admin memberships exist — the invariant is checked server-side
 * again on submit, so rendering this page grants nothing.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const bootstrapped = await hasActiveHqAdmin();
  const userId = await getAuthenticatedUserIdOrNull();

  if (bootstrapped) {
    return (
      <main className="mx-auto max-w-sm px-6 py-24 text-center">
        <h1 className="text-xl font-bold">Setup unavailable</h1>
        <p className="mt-3 text-sm text-gray-600">
          Setup is permanently disabled after bootstrap.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-bold text-[#07742F]">CLENQO Setup</h1>
      <p className="mt-2 text-sm text-gray-600">
        One-time bootstrap of the first HQ Administrator.
      </p>
      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error === "invalid_token" ? "Invalid setup token." : "Setup failed."}
        </p>
      )}
      <form action={performSetupAction} className="mt-8 space-y-4">
        <div>
          <label htmlFor="setup_token" className="block text-xs font-medium text-gray-700">
            Setup token
          </label>
          <input
            id="setup_token"
            name="setup_token"
            type="password"
            required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="organization_name" className="block text-xs font-medium text-gray-700">
            Organization name
          </label>
          <input
            id="organization_name"
            name="organization_name"
            type="text"
            defaultValue="CLENQO"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!userId}
          className="w-full rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
        >
          Complete setup
        </button>
        {!userId && (
          <p className="text-xs text-gray-500">
            Sign in with the pre-created administrator account first.
          </p>
        )}
      </form>
    </main>
  );
}
