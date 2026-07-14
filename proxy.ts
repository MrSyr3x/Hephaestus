import arcjet, { detectBot, shield } from "@arcjet/next";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// ─── Global Arcjet client ──────────────────────────────────────────────────
// Runs on every request matched below. lib/arcjet.ts adds a second,
// route-specific client on top of this (rate limiting + prompt injection
// checks) for /api/gen-ai-code only — this one is the site-wide baseline.
const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }), // blocks common attacks (SQLi, XSS, etc.)
    detectBot({
      mode: "LIVE",
      // Allow search engines and link-preview bots (Slack/Twitter unfurls)
      // so the landing page stays crawlable and shareable.
      allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:PREVIEW"],
    }),
  ],
});

// Auth is enforced where the data is fetched (e.g. actions/workspace.ts's
// getWorkspaceUser(), app/(main)/projects/page.tsx) rather than here with
// Clerk's createRouteMatcher — that export still exists and isn't
// deprecated, we just don't need a second layer of the same check.
// Checking at the data layer also covers Server Actions called directly,
// not only requests that pass through this middleware.
export default clerkMiddleware(async (_auth, req) => {
  const decision = await aj.protect(req);
  if (decision.isDenied()) {
    // A denial can hit a full page navigation (browser address bar) or an
    // underlying fetch (RSC payload, client-side data request) — those
    // expect different response shapes. Without this check, a false
    // positive on a real page load renders as a blank raw-JSON response
    // instead of anything readable, since the browser never gets HTML back.
    if (req.headers.get("accept")?.includes("text/html")) {
      return new NextResponse(
        `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#1a1815;color:#e8e6dc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:0 20px"><p>Request blocked. If this seems wrong, please try again in a moment.</p></body></html>`,
        { status: 403, headers: { "Content-Type": "text/html" } },
      );
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
