import Link from "next/link";
import { redirect } from "next/navigation";
import { getBoard, listBoardMembers, requireBoardMember } from "@/db/boards";
import { listColumns } from "@/db/columns";
import { listCards } from "@/db/cards";
import { redirectOnBoardDenial, requireUserId } from "./access";
import { CreateColumnForm } from "./create-column-form";
import { ColumnLane, type MoveTarget } from "./column-lane";

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

      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {columns.map((column, i) => {
          // Neighbours the column lands between when nudged one step. Moving left
          // means slotting before the previous lane; moving right, after the next.
          const moveLeft: MoveTarget =
            i > 0
              ? { beforeId: columns[i - 2]?.id ?? null, afterId: columns[i - 1].id }
              : null;
          const moveRight: MoveTarget =
            i < columns.length - 1
              ? { beforeId: columns[i + 1].id, afterId: columns[i + 2]?.id ?? null }
              : null;
          return (
            <ColumnLane
              key={column.id}
              boardId={id}
              column={column}
              cards={visibleCards.filter((card) => card.columnId === column.id)}
              members={members}
              moveLeft={moveLeft}
              moveRight={moveRight}
            />
          );
        })}
        <CreateColumnForm boardId={id} />
      </div>

      {columns.length === 0 && (
        <p className="text-sm opacity-60">No columns yet. Add your first lane above.</p>
      )}
    </main>
  );
}
