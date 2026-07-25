import { NextResponse } from "next/server";
import { boardVersion } from "@/db/board-snapshot";
import { boardMemberAccess, noStore } from "@/app/api/board-access";

/**
 * GET /api/boards/:id/version — the board's change token (D4). One row of
 * aggregates, polled every 4s by everyone with the board open, so the heavy
 * `/api/boards/:id` payload is only fetched when the token differs from the one
 * the client already holds.
 *
 * The token is opaque and compared for equality only: it means *different*, not
 * *newer*. Same membership gate as the full read — 401 signed out, 403 for a
 * non-member — so it can't be used to probe which board ids exist. That covers a
 * board deleted out from under an open tab too: its memberships cascade away with
 * it (D5), so the poll starts answering 403 and the client stops syncing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await boardMemberAccess(id);
  if (!access.ok) return access.response;

  const version = await boardVersion(id);
  return NextResponse.json({ version }, { headers: noStore });
}
