import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { keyBetween } from "./ordering";
import { requireBoardMember } from "./boards";
import { columns, type Column } from "./schema";

/** Zod shape for a column name — the boundary check for create and rename. */
export const columnNameSchema = z.object({
  name: z.string().trim().min(1, "Column name is required.").max(80),
});

/** Thrown when a column id doesn't resolve — e.g. it was deleted concurrently. */
export class ColumnNotFoundError extends Error {
  constructor(readonly columnId: string) {
    super(`Column not found: ${columnId}`);
    this.name = "ColumnNotFoundError";
  }
}

/** A board's columns in `position` order (id breaks any jitter tie). */
export async function listColumns(boardId: string): Promise<Column[]> {
  return db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position), asc(columns.id));
}

/**
 * Load a column and confirm the caller may act on its board. Every column
 * mutation funnels through here, so membership is checked in exactly one place
 * (the `requireBoardMember` seam) and no mutation can touch a column on a board
 * the caller isn't a member of. Throws `BoardAccessError` for a non-member,
 * `ColumnNotFoundError` if the column is gone.
 */
async function requireColumnMember(columnId: string, userId: string): Promise<Column> {
  const [column] = await db
    .select()
    .from(columns)
    .where(eq(columns.id, columnId))
    .limit(1);
  if (!column) throw new ColumnNotFoundError(columnId);
  await requireBoardMember(column.boardId, userId);
  return column;
}

/**
 * Create a column at the end of the board's lanes. Members may create columns
 * (D1); membership is checked here. The new key is generated after the current
 * last column's position, so appends touch no existing row.
 */
export async function createColumn(input: {
  boardId: string;
  name: string;
  userId: string;
}): Promise<Column> {
  await requireBoardMember(input.boardId, input.userId);
  const existing = await listColumns(input.boardId);
  const last = existing.at(-1)?.position ?? null;
  const [column] = await db
    .insert(columns)
    .values({
      boardId: input.boardId,
      name: input.name,
      position: keyBetween(last, null),
    })
    .returning();
  return column;
}

/** Rename a column (member-permitted, membership-checked). */
export async function renameColumn(input: {
  columnId: string;
  name: string;
  userId: string;
}): Promise<Column> {
  const column = await requireColumnMember(input.columnId, input.userId);
  const [updated] = await db
    .update(columns)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(columns.id, column.id))
    .returning();
  return updated;
}

/**
 * Move a column to sit between `beforeId` and `afterId` (either `null` for an
 * end). Both neighbours must belong to the same board as the moved column, so a
 * caller can't splice in a position from another board. Generates a fractional
 * key between the neighbours' positions and rewrites the one moved row (D3).
 */
export async function reorderColumn(input: {
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
  userId: string;
}): Promise<Column> {
  const column = await requireColumnMember(input.columnId, input.userId);

  const neighbourPosition = async (id: string | null): Promise<string | null> => {
    if (id === null) return null;
    if (id === column.id) {
      throw new Error("A column cannot be reordered relative to itself.");
    }
    const [neighbour] = await db
      .select()
      .from(columns)
      .where(and(eq(columns.id, id), eq(columns.boardId, column.boardId)))
      .limit(1);
    if (!neighbour) throw new ColumnNotFoundError(id);
    return neighbour.position;
  };

  const before = await neighbourPosition(input.beforeId);
  const after = await neighbourPosition(input.afterId);

  const [updated] = await db
    .update(columns)
    .set({ position: keyBetween(before, after), updatedAt: new Date() })
    .where(eq(columns.id, column.id))
    .returning();
  return updated;
}

/**
 * Delete a column (member-permitted, membership-checked). Only the column row is
 * removed here; the cascade of a non-empty column's cards + comments arrives with
 * the cards ticket (D5). The confirm dialog lives in the UI.
 */
export async function deleteColumn(input: {
  columnId: string;
  userId: string;
}): Promise<void> {
  const column = await requireColumnMember(input.columnId, input.userId);
  await db.delete(columns).where(eq(columns.id, column.id));
}
