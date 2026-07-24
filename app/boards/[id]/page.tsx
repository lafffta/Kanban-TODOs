import Link from "next/link";
import { redirect } from "next/navigation";
import { getBoard, listBoardMembers, requireBoardMember } from "@/db/boards";
import { listColumns } from "@/db/columns";
import { listCards } from "@/db/cards";
import { redirectOnBoardDenial, requireUserId } from "./access";
import { BoardView } from "./board-view";

// Board detail: the lanes of one board in `position` order, each holding its cards
// in `position` order. Gated by `requireBoardMember` — a non-member is bounced back
// to their boards list. Members create/rename/reorder/delete columns and
// create/edit/assign/delete cards here; the "my cards" filter (?mine=1) narrows the
// board to the current user's assigned cards (ticket 05).
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
  await redirectOnBoardDenial(() => requireBoardMember(id, userId));

  const board = await getBoard(id);
  if (!board) redirect("/boards");

  const [columns, allCards, members] = await Promise.all([
    listColumns(id),
    listCards(id),
    listBoardMembers(id),
  ]);

  const onlyMine = mine === "1";
  const visibleCards = onlyMine
    ? allCards.filter((card) => card.assigneeId === userId)
    : allCards;

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/boards" className="text-sm opacity-60 hover:opacity-100">
            ← Boards
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{board.name}</h1>
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

      <BoardView boardId={id} columns={columns} cards={visibleCards} members={members} />


      {columns.length === 0 && (
        <p className="text-sm opacity-60">No columns yet. Add your first lane above.</p>
      )}
    </main>
  );
}
