/**
 * Server-side session resolution (API_STANDARDS.md §4 flow step 1).
 * In production the user comes from Supabase Auth session cookies;
 * tests inject a fixed user id via setSessionOverrideForTests.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError, ErrorCode } from "@/lib/errors";

let sessionOverride: string | null | undefined;

/** Test-only session override. Never effective in production. */
export function setSessionOverrideForTests(userId: string | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setSessionOverrideForTests must never run in production");
  }
  sessionOverride = userId;
}

export async function getAuthenticatedUserId(): Promise<string> {
  if (sessionOverride !== undefined) {
    if (sessionOverride === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, "Authentication required.");
    }
    return sessionOverride;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component render — safe to ignore (middleware refreshes).
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Authentication required.");
  }
  return data.user.id;
}

/** Optional variant for layouts that render differently when signed out. */
export async function getAuthenticatedUserIdOrNull(): Promise<string | null> {
  try {
    return await getAuthenticatedUserId();
  } catch {
    return null;
  }
}
