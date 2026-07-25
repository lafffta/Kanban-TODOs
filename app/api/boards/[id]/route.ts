import { NextResponse } from "next/server";
import { getBoardSnapshot } from "@/db/board-snapshot";
import { serializeBoard } from "@/app/boards/[id]/board-data";
import { boardMemberAccess, noStore } from "@/app/api/board-access";

/**
 * GET /api/boards/:id — the whole board: its lanes, cards (with assignees and
 * comment counts) and members, plus the `version` it was read at. This is the
 * heavy read behind the polling loop, so the client only fetches it when
 * `/version` says the token moved (D4).
 *
 * Gated by board membership: unauthenticated → 401, non-member → 403. A member
 * asking for a board that has since been deleted gets 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await boardMemberAccess(id);
  if (!access.ok) return access.response;

  const snapshot = await getBoardSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json(serializeBoard(snapshot), { headers: noStore });
}
