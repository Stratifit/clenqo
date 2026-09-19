import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session middleware (Change 8, design §4): refresh Supabase Auth session
 * cookies for /admin/* requests and redirect unauthenticated access to the
 * login flow with a safe local `next`.
 *
 * SECURITY (design §13): this middleware is a UX layer ONLY. It never
 * authorizes. Server actions/domain services (`currentContext` →
 * `resolveActor` → permission/branch checks) and PostgreSQL RLS remain the
 * authoritative security boundary.
 */

/** Validated safe-local `next`: leading "/", never "//", never a scheme. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/admin";
  if (!raw.startsWith("/")) return "/admin";
  if (raw.startsWith("//")) return "/admin";
  if (raw.includes("://")) return "/admin";
  return raw;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    // Refresh exchange: rotates session cookies when Supabase reissues them.
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("next", safeNextPath(pathname + search));
      response = NextResponse.redirect(url);
      // Re-apply any refreshed cookies onto the redirect response.
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-")) response.cookies.set(cookie);
      }
    }
  } catch {
    // Fail closed: any session-resolution error is treated as signed out.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", safeNextPath(pathname + search));
    response = NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
