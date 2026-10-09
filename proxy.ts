import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Pages only admins can open; BDR logins get bounced to the Team page.
const ADMIN_PREFIXES = ["/settings", "/archive", "/campaigns", "/reps", "/enrichment"];

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = await verifySessionToken(token);

  if (!claims) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const path = request.nextUrl.pathname;
  if (claims.role !== "admin" && ADMIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL("/team", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except /login, /api/sync (auth'd separately via
    // CRON_SECRET), /api/inngest (called directly by Inngest's servers,
    // authenticated via INNGEST_SIGNING_KEY inside the route handler itself
    // — it never carries our session cookie), and Next.js internals/static
    // assets. /api/hubspot/webhook (HubSpot signature) and /api/live/tick
    // (CRON_SECRET) authenticate inside their handlers.
    "/((?!login|api/sync|api/inngest|api/hubspot/webhook|api/live/tick|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
