import { type NextRequest, NextResponse } from "next/server";

// Account pages need a session. Visitors without a session cookie are sent to sign-in before the
// page renders, so they get a real 307 instead of a streamed client-side redirect. The account
// layout still verifies the session itself; this only short-circuits the obvious case.
export function middleware(request: NextRequest) {
  const localOperator =
    process.env.NODE_ENV !== "production" && process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  if (localOperator || request.cookies.has("sisera-privy-session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = `?returnTo=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: [
    "/portfolio/:path*",
    "/risk/:path*",
    "/agents/:path*",
    "/marketplace/:path*",
    "/audit/:path*",
    "/alerts/:path*",
    "/settings/:path*",
    "/leaderboard/:path*",
    "/social/:path*",
    "/copilot/:path*",
    "/launch/:path*",
  ],
};
