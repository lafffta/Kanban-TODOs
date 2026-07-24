import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BoardAccessError } from "@/db/boards";
import { CardNotFoundError, requireCardMember } from "@/db/cards";
import { listComments } from "@/db/comments";

/**
 * GET /api/cards/:id/comments — a card's comment thread (with author profiles),
 * for the card detail view. Gated by `requireCardMember`, so only a member of the
 * card's board can read it: unauthenticated → 401, non-member → 403, missing card
 * → 404. Polled while a card is open in a later ticket (D4).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    await requireCardMember(id, session.user.id);
  } catch (err) {
    if (err instanceof BoardAccessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof CardNotFoundError) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
    throw err;
  }

  const comments = await listComments(id);
  return NextResponse.json({ comments });
}
