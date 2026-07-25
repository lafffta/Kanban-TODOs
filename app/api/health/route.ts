import { NextResponse } from "next/server";
import { checkDatabase } from "@/db/queries";

// Health probe: verifies the DB round-trip (the check the old homepage used to
// show). Never prerender it — it must hit the pool at request time.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — unauthenticated liveness/readiness probe.
 *   200 { status: "ok", db: "up" }         — Postgres reachable.
 *   503 { status: "error", db: "down", ... } — pool couldn't reach Postgres.
 */
export async function GET() {
  try {
    await checkDatabase();
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown database error";
    return NextResponse.json(
      { status: "error", db: "down", error },
      { status: 503 },
    );
  }
}
