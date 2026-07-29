import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isValid = await verifySessionToken(token);

  if (!isValid) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except /login, /api/sync (auth'd separately via
    // CRON_SECRET), /api/inngest (called directly by Inngest's servers,
    // authenticated via INNGEST_SIGNING_KEY inside the route handler itself
    // — it never carries our session cookie), and Next.js internals/static
    // assets.
    "/((?!login|api/sync|api/inngest|_next/static|_next/image|favicon.ico).*)",
  ],
};
