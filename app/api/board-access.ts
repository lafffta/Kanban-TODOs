import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BoardAccessError, requireBoardMember } from "@/db/boards";

/** The caller may read the board, and this is who they are. */
type Allowed = { ok: true; userId: string };
/** The caller may not, and this is the response that says so. */
type Refused = { ok: false; response: NextResponse };

/**
 * The membership gate for a board's read endpoints — the route-handler face of
 * the one `requireBoardMember` seam every board query goes through. Signed out is
 * 401, a non-member is 403; there is deliberately no "board not found" answer
 * here, because a stranger must not be able to tell an id that exists from one
 * that doesn't.
 *
 * Returns a result rather than throwing so a handler reads top to bottom:
 *
 *     const access = await boardMemberAccess(id);
 *     if (!access.ok) return access.response;
 */
export async function boardMemberAccess(boardId: string): Promise<Allowed | Refused> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  try {
    await requireBoardMember(boardId, session.user.id);
  } catch (error) {
    if (error instanceof BoardAccessError) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    throw error;
  }

  return { ok: true, userId: session.user.id };
}

/**
 * Headers for a polled endpoint. These responses are per-user and re-read every
 * few seconds; a cached one would silently freeze a board (and the version guard
 * with it), so no store, anywhere, ever.
 */
export const noStore = { "Cache-Control": "no-store, max-age=0" } as const;
