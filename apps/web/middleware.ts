import { NextRequest, NextResponse } from "next/server";

// Vercel's native Password Protection needs a Pro plan (this project is on
// Hobby), so this is a self-hosted equivalent via HTTP Basic Auth. Skipped
// entirely in local dev (localhost never needs a password); enforced for
// every other environment, including Vercel preview deployments, since
// those are reachable by URL just like production.
const REALM = "reality-manager";

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const expectedPassword = process.env.SITE_AUTH_PASSWORD;
  if (!expectedPassword) {
    // Fail closed — a missing password env var should never mean "open to
    // everyone," it should mean "nobody gets in until it's configured."
    return new NextResponse("Site password not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
    if (password === expectedPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}"` },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
