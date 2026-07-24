"use server";

import { revalidatePath } from "next/cache";
import {
  columnNameSchema,
  createColumn,
  deleteColumn,
  renameColumn,
  reorderColumn,
} from "@/db/columns";
import {
  assignCard,
  cardContentSchema,
  cardTitleSchema,
  createCard,
  deleteCard,
  moveCard,
  updateCard,
} from "@/db/cards";
import {
  addComment,
  commentBodySchema,
  deleteComment,
  CommentNotFoundError,
  CommentPermissionError,
} from "@/db/comments";
import {
  MembershipError,
  boardRoleSchema,
  changeMemberRole,
  removeMember,
} from "@/db/boards";
import type { BoardRole } from "@/db/schema";
import {
  INVITE_REJECTION_MESSAGE,
  InviteError,
  createInvite,
  createInviteSchema,
} from "@/db/invites";
import { requireUserId } from "@/app/session";
import { redirectOnBoardDenial } from "./access";

export type ColumnFormState = { error: string } | undefined;
export type CardFormState = { error: string } | undefined;
export type CommentFormState = { error: string } | undefined;
export type MemberFormState = { error: string } | undefined;
/** A minted invite's token, or why one wasn't minted — read as `result?.error`. */
export type InviteFormState = { error?: string; token?: string } | undefined;

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

/** Create a card at the end of a column (member-permitted). */
export async function createCardAction(
  boardId: string,
  columnId: string,
  _prev: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = cardTitleSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card title." };
  }
  await redirectOnBoardDenial(() =>
    createCard({ boardId, columnId, title: parsed.data.title, userId }),
  );
  revalidatePath(`/boards/${boardId}`);
}

/** Edit a card's title and description (member-permitted). */
export async function updateCardAction(
  boardId: string,
  cardId: string,
  _prev: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = cardContentSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card." };
  }
  await redirectOnBoardDenial(() =>
    updateCard({
      cardId,
      title: parsed.data.title,
      description: parsed.data.description,
      userId,
    }),
  );
  revalidatePath(`/boards/${boardId}`);
}

/**
 * Assign a card to a board member, or clear it with `assigneeId: null`. The UI
 * only offers current members, so the db-layer membership check is a backstop.
 */
export async function assignCardAction(input: {
  boardId: string;
  cardId: string;
  assigneeId: string | null;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    assignCard({ cardId: input.cardId, assigneeId: input.assigneeId, userId }),
  );
  revalidatePath(`/boards/${input.boardId}`);
}

/**
 * Move a card between `beforeId` and `afterId` (each a card id or null for an
 * end) inside `columnId` — a reorder when the column is unchanged, a cross-lane
 * move otherwise. The board view passes the ids of the neighbours the card lands
 * between; the db layer generates one fractional key and rewrites the single row.
 */
export async function moveCardAction(input: {
  boardId: string;
  cardId: string;
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    moveCard({
      cardId: input.cardId,
      columnId: input.columnId,
      beforeId: input.beforeId,
      afterId: input.afterId,
      userId,
    }),
  );
  revalidatePath(`/boards/${input.boardId}`);
}

/** Delete a card (member-permitted). Confirm dialog lives in the UI. */
export async function deleteCardAction(input: {
  boardId: string;
  cardId: string;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() => deleteCard({ cardId: input.cardId, userId }));
  revalidatePath(`/boards/${input.boardId}`);
}

/**
 * Add a plain-text comment to a card (any member). Returns a form-state error on an
 * empty/oversized body; the card detail view reloads the thread on success and the
 * revalidate refreshes the card face's comment count.
 */
export async function addCommentAction(input: {
  boardId: string;
  cardId: string;
  body: string;
}): Promise<CommentFormState> {
  const userId = await requireUserId();
  const parsed = commentBodySchema.safeParse({ body: input.body });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }
  await redirectOnBoardDenial(() =>
    addComment({ cardId: input.cardId, body: parsed.data.body, userId }),
  );
  revalidatePath(`/boards/${input.boardId}`);
}

/**
 * Delete a comment — the author's own, or any as a board owner (enforced in the db
 * layer). The UI only shows the delete control to a permitted user, so the db-layer
 * `CommentPermissionError` is a backstop — but a stale thread (the comment was
 * reassigned or the caller's role changed since render) can still hit it, so it's
 * returned as a form error the thread can display rather than thrown as a 500.
 */
export async function deleteCommentAction(input: {
  boardId: string;
  commentId: string;
}): Promise<CommentFormState> {
  const userId = await requireUserId();
  try {
    await redirectOnBoardDenial(() =>
      deleteComment({ commentId: input.commentId, userId }),
    );
  } catch (error) {
    if (error instanceof CommentPermissionError) {
      return { error: "You can only delete your own comments." };
    }
    if (error instanceof CommentNotFoundError) {
      return { error: "That comment was already deleted." };
    }
    throw error;
  }
  revalidatePath(`/boards/${input.boardId}`);
}

/** What a refused membership change means to the owner who attempted it. */
const MEMBERSHIP_MESSAGE: Record<MembershipError["reason"], string> = {
  "not-a-member": "They're no longer a member of this board.",
  "board-creator": "The board's creator can't be removed or have their role changed.",
};

/**
 * Mint an invite to this board (owner-only, enforced in the db layer — a member is
 * redirected away like any other denied board action). Returns the token so the
 * panel can show the owner a link to share out-of-band; there is no email
 * infrastructure in v1 (D2).
 */
export async function createInviteAction(input: {
  boardId: string;
  email: string;
  role: BoardRole;
}): Promise<InviteFormState> {
  const userId = await requireUserId();
  const parsed = createInviteSchema.safeParse({ email: input.email, role: input.role });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite." };
  }

  let token: string;
  try {
    ({ token } = await redirectOnBoardDenial(() =>
      createInvite({
        boardId: input.boardId,
        email: parsed.data.email,
        role: parsed.data.role,
        userId,
      }),
    ));
  } catch (error) {
    if (error instanceof InviteError) {
      return { error: INVITE_REJECTION_MESSAGE[error.reason] };
    }
    throw error;
  }
  revalidatePath(`/boards/${input.boardId}`);
  return { token };
}

/**
 * Remove a member from the board (owner-only). A refusal the panel couldn't
 * foresee — the target left already, or is the board's creator — comes back as a
 * message rather than a 500.
 */
export async function removeMemberAction(input: {
  boardId: string;
  userId: string;
}): Promise<MemberFormState> {
  const actorId = await requireUserId();
  try {
    await redirectOnBoardDenial(() =>
      removeMember({ boardId: input.boardId, userId: input.userId, actorId }),
    );
  } catch (error) {
    if (error instanceof MembershipError) {
      return { error: MEMBERSHIP_MESSAGE[error.reason] };
    }
    throw error;
  }
  revalidatePath(`/boards/${input.boardId}`);
}

/** Change a member's role (owner-only). Same refusals as removal. */
export async function changeMemberRoleAction(input: {
  boardId: string;
  userId: string;
  role: BoardRole;
}): Promise<MemberFormState> {
  const actorId = await requireUserId();
  // The role arrives from a client and lands in a text column — parse it, never
  // trust the cast on the other side of the wire.
  const parsed = boardRoleSchema.safeParse(input.role);
  if (!parsed.success) return { error: "That isn't a role on this board." };
  try {
    await redirectOnBoardDenial(() =>
      changeMemberRole({
        boardId: input.boardId,
        userId: input.userId,
        role: parsed.data,
        actorId,
      }),
    );
  } catch (error) {
    if (error instanceof MembershipError) {
      return { error: MEMBERSHIP_MESSAGE[error.reason] };
    }
    throw error;
  }
  revalidatePath(`/boards/${input.boardId}`);
}
