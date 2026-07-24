import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listBoardsForUser } from "@/db/boards";

/**
 * GET /api/boards — the boards the signed-in user is a member of. Scoped by the
 * session user id, so a user only ever sees their own boards; unauthenticated
 * callers get 401. (Polled by the client in a later ticket.)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const boards = await listBoardsForUser(session.user.id);
  return NextResponse.json({ boards });
}
