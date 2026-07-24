import Link from "next/link";
import { redirect } from "next/navigation";
import { getBoard, requireBoardMember } from "@/db/boards";
import { listColumns } from "@/db/columns";
import { redirectOnBoardDenial, requireUserId } from "./access";
import { CreateColumnForm } from "./create-column-form";
import { ColumnLane, type MoveTarget } from "./column-lane";

// Board detail: the lanes of one board, in `position` order. Gated by
// `requireBoardMember` — a non-member is bounced back to their boards list, so a
// board is only ever rendered to someone who belongs to it. Members create,
// rename, reorder, and delete columns here (the ticket 04 demo).
export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireUserId();
  await redirectOnBoardDenial(() => requireBoardMember(id, userId));

  const board = await getBoard(id);
  if (!board) redirect("/boards");

  const columns = await listColumns(id);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <Link href="/boards" className="text-sm opacity-60 hover:opacity-100">
          ← Boards
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{board.name}</h1>
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
