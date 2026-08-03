import Link from "next/link";
import { redirect } from "next/navigation";
import { requireBoardMember } from "@/db/boards";
import { getBoardSnapshot } from "@/db/board-snapshot";
import { listPendingInvites } from "@/db/invites";
import { requireUserId } from "@/app/session";
import { RememberBoard } from "@/app/pwa/last-board-launch";
import { OfflineCopyWarmer } from "@/app/pwa/service-worker";
import { redirectOnBoardDenial } from "./access";
import { serializeBoard } from "./board-data";
import { BoardProvider } from "./board-context";
import { BoardTitle } from "./board-title";
import { BoardView } from "./board-view";
import { MembersPanel } from "./members-panel";

// Board detail: the lanes of one board in `position` order, each holding its cards
// in `position` order. Gated by `requireBoardMember` — a non-member is bounced back
// to their boards list. Members create/rename/reorder/delete columns and
// create/edit/assign/delete cards here; the "my cards" filter (?mine=1) narrows the
// board to the current user's assigned cards (ticket 05). The heading carries the
// owner-only lifecycle controls — rename the board, or delete it and everything on
// it (ticket 12) — which is why the name is rendered through `BoardTitle`.
//
// The board is read once here so the first paint needs no round trip, then handed
// to `BoardProvider`, which polls it from `/api/boards/:id` from that point on
// (ticket 09). Everything the board renders sits inside that provider, governance
// included: a role is a row another owner can change mid-session, so the heading's
// owner controls and the members panel read the viewer's standing from the polled
// payload rather than from what was true at render (ticket 17). Only the pending
// invites are still read here — their tokens are owner-only (D2/D6), so they can't
// travel in a payload every member polls.
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mine?: string }>;
}) {
  const { id } = await params;
  const { mine } = await searchParams;
  const userId = await requireUserId();
  const membership = await redirectOnBoardDenial(() => requireBoardMember(id, userId));
  const isOwner = membership.role === "owner";

  const snapshot = await getBoardSnapshot(id);
  if (!snapshot) redirect("/boards");

  // Invite tokens are owner-only, so a member's page never carries them (ticket 08).
  const invites = isOwner ? await listPendingInvites(id, userId) : [];

  // The filter is applied inside `BoardView` at render, not here: it needs every
  // card to resolve a drop's true neighbours, which may be cards the filter hides.
  const onlyMine = mine === "1";

  return (
    // The board owns the viewport: the header and members panel keep their size
    // and the lanes take the rest, scrolling inside themselves (ticket 10).
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 sm:gap-6 sm:p-6">
      <BoardProvider
        boardId={id}
        currentUserId={userId}
        initialBoard={serializeBoard(snapshot)}
        renderedAt={Date.now()}
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/boards" className="text-sm opacity-60 hover:opacity-100">
              ← Boards
            </Link>
            <BoardTitle boardId={id} name={snapshot.board.name} />
          </div>
          <Link
            href={onlyMine ? `/boards/${id}` : `/boards/${id}?mine=1`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              onlyMine
                ? "border-transparent bg-black text-white dark:bg-white dark:text-black"
                : "border-black/15 opacity-70 hover:opacity-100 dark:border-white/20"
            }`}
          >
            {onlyMine ? "Showing my cards" : "My cards"}
          </Link>
        </div>

        <MembersPanel
          invites={invites.map((invite) => ({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            token: invite.token,
            expiresAt: invite.expiresAt.toISOString(),
          }))}
        />

        {/* Where an offline launch comes back to, and the copy it opens (D8). */}
        <RememberBoard boardId={id} name={snapshot.board.name} />
        <OfflineCopyWarmer />

        <BoardView filterAssigneeId={onlyMine ? userId : null} />
      </BoardProvider>
    </main>
  );
}
