"use server";

import { revalidatePath } from "next/cache";
import {
  columnNameSchema,
  createColumn,
  deleteColumn,
  renameColumn,
  reorderColumn,
} from "@/db/columns";
import { redirectOnBoardDenial, requireUserId } from "./access";

export type ColumnFormState = { error: string } | undefined;

/** Create a column at the end of a board's lanes (member-permitted). */
export async function createColumnAction(
  boardId: string,
  _prev: ColumnFormState,
  formData: FormData,
): Promise<ColumnFormState> {
  const userId = await requireUserId();
  const parsed = columnNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid column name." };
  }
  await redirectOnBoardDenial(() =>
    createColumn({ boardId, name: parsed.data.name, userId }),
  );
  revalidatePath(`/boards/${boardId}`);
}

/** Rename a column (member-permitted). */
export async function renameColumnAction(
  boardId: string,
  columnId: string,
  _prev: ColumnFormState,
  formData: FormData,
): Promise<ColumnFormState> {
  const userId = await requireUserId();
  const parsed = columnNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid column name." };
  }
  await redirectOnBoardDenial(() =>
    renameColumn({ columnId, name: parsed.data.name, userId }),
  );
  revalidatePath(`/boards/${boardId}`);
}

/**
 * Move a column to sit between `beforeId` and `afterId` (either may be null for
 * an end). The page passes the ids of the neighbours the column lands between;
 * the db layer generates one fractional key and rewrites the single moved row.
 */
export async function reorderColumnAction(input: {
  boardId: string;
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    reorderColumn({
      columnId: input.columnId,
      beforeId: input.beforeId,
      afterId: input.afterId,
      userId,
    }),
  );
  revalidatePath(`/boards/${input.boardId}`);
}

/** Delete a column (member-permitted). Confirm dialog lives in the UI. */
export async function deleteColumnAction(input: {
  boardId: string;
  columnId: string;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    deleteColumn({ columnId: input.columnId, userId }),
  );
  revalidatePath(`/boards/${input.boardId}`);
}
