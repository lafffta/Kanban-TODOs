import { NextResponse } from "next/server";
import { checkDatabase } from "@/db/queries";

// Health probe: verifies the DB round-trip (the check the old homepage used to
// show). Never prerender it — it must hit the pool at request time.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — unauthenticated liveness/readiness probe.
 *   200 { status: "ok", db: "up" }      — Postgres reachable.
 *   503 { status: "error", db: "down" } — pool couldn't reach Postgres.
 *
 * The body is exactly these two shapes and nothing more. Anyone on the internet
 * can call this route, and a driver's own failure text names the host, port,
 * role and TLS posture of the database — infrastructure detail a probe has no
 * reason to hand out. The cause goes to the platform log instead, where an
 * operator diagnosing the outage can read it.
 */
export async function GET() {
  try {
    await checkDatabase();
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (err) {
    // The thrown value verbatim, not just its message: Vercel's log captures the
    // stack and the driver's own fields (`code`, `errno`) alongside it.
    console.error("/api/health: database probe failed", err);
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
