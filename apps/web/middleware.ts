import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session so it doesn't expire mid-visit
  const { data: { session } } = await supabase.auth.getSession();
  const { pathname } = request.nextUrl;

  const isProtectedRoute = pathname.startsWith("/home");
  // Onboarding profile-pic and matches require auth (user just signed up)
  const isProtectedOnboarding =
    pathname === "/onboarding/profile-pic" || pathname === "/onboarding/matches";

  if ((isProtectedRoute || isProtectedOnboarding) && !session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/auth/login" && session) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
