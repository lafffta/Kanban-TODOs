"use server";

import { revalidatePath } from "next/cache";
import { PositionCollisionError } from "@/db/ordering";
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

/**
 * The board's writes. Since ticket 09 the *content* actions — columns, cards,
 * comments — no longer `revalidatePath`: the board they'd refresh is now held in
 * the client's query cache, which patches optimistically and re-reads on settle
 * (D3/D4). Pushing a whole RSC payload back on every keystroke-sized edit would
 * be a second, slower copy of the same news.
 *
 * The *governance* actions below — invites and membership — still revalidate,
 * because the members panel they feed is server-rendered and isn't polled.
 */
/**
 * Shown when every attempt to find a free `position` collided (D3). Rare enough to
 * need no design of its own, but it must not reach the user as a 500: the drop was
 * refused cleanly and nothing was written, so re-trying really is the fix.
 */
const POSITION_BUSY = "That spot is busy right now — try again.";

/**
 * Turn an exhausted position retry into a form error instead of letting it escape
 * as an unhandled 500. Wraps *outside* `redirectOnBoardDenial`, which only knows
 * about `BoardAccessError`.
 */
async function refuseOnPositionCollision(
  run: () => Promise<unknown>,
): Promise<{ error: string } | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof PositionCollisionError) return { error: POSITION_BUSY };
    throw error;
  }
}

export type ColumnFormState = { error: string } | undefined;
export type CardFormState = { error: string } | undefined;
export type CommentFormState = { error: string } | undefined;
export type MemberFormState = { error: string } | undefined;
/** A minted invite's token, or why one wasn't minted — read as `result?.error`. */
export type InviteFormState = { error?: string; token?: string } | undefined;

/** Create a column at the end of a board's lanes (member-permitted). */
export async function createColumnAction(input: {
  boardId: string;
  name: string;
}): Promise<ColumnFormState> {
  const userId = await requireUserId();
  const parsed = columnNameSchema.safeParse({ name: input.name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid column name." };
  }
  return refuseOnPositionCollision(() =>
    redirectOnBoardDenial(() =>
      createColumn({ boardId: input.boardId, name: parsed.data.name, userId }),
    ),
  );
}

/** Rename a column (member-permitted). */
export async function renameColumnAction(input: {
  columnId: string;
  name: string;
}): Promise<ColumnFormState> {
  const userId = await requireUserId();
  const parsed = columnNameSchema.safeParse({ name: input.name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid column name." };
  }
  await redirectOnBoardDenial(() =>
    renameColumn({ columnId: input.columnId, name: parsed.data.name, userId }),
  );
}

/**
 * Move a column to sit between `beforeId` and `afterId` (either may be null for
 * an end). The page passes the ids of the neighbours the column lands between;
 * the db layer generates one fractional key and rewrites the single moved row.
 */
export async function reorderColumnAction(input: {
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
}): Promise<ColumnFormState> {
  const userId = await requireUserId();
  return refuseOnPositionCollision(() =>
    redirectOnBoardDenial(() =>
      reorderColumn({
        columnId: input.columnId,
        beforeId: input.beforeId,
        afterId: input.afterId,
        userId,
      }),
    ),
  );
}

/** Delete a column (member-permitted). Confirm dialog lives in the UI. */
export async function deleteColumnAction(input: {
  columnId: string;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    deleteColumn({ columnId: input.columnId, userId }),
  );
}

/** Create a card at the end of a column (member-permitted). */
export async function createCardAction(input: {
  boardId: string;
  columnId: string;
  title: string;
}): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = cardTitleSchema.safeParse({ title: input.title });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card title." };
  }
  return refuseOnPositionCollision(() =>
    redirectOnBoardDenial(() =>
      createCard({
        boardId: input.boardId,
        columnId: input.columnId,
        title: parsed.data.title,
        userId,
      }),
    ),
  );
}

/** Edit a card's title and description (member-permitted). */
export async function updateCardAction(input: {
  cardId: string;
  title: string;
  description: string;
}): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = cardContentSchema.safeParse({
    title: input.title,
    description: input.description,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card." };
  }
  await redirectOnBoardDenial(() =>
    updateCard({
      cardId: input.cardId,
      title: parsed.data.title,
      description: parsed.data.description,
      userId,
    }),
  );
}

/**
 * Assign a card to a board member, or clear it with `assigneeId: null`. The UI
 * only offers current members, so the db-layer membership check is a backstop.
 */
export async function assignCardAction(input: {
  cardId: string;
  assigneeId: string | null;
}): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() =>
    assignCard({ cardId: input.cardId, assigneeId: input.assigneeId, userId }),
  );
}

/**
 * Move a card between `beforeId` and `afterId` (each a card id or null for an
 * end) inside `columnId` — a reorder when the column is unchanged, a cross-lane
 * move otherwise. The board view passes the ids of the neighbours the card lands
 * between; the db layer generates one fractional key and rewrites the single row.
 */
export async function moveCardAction(input: {
  cardId: string;
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
}): Promise<CardFormState> {
  const userId = await requireUserId();
  return refuseOnPositionCollision(() =>
    redirectOnBoardDenial(() =>
      moveCard({
        cardId: input.cardId,
        columnId: input.columnId,
        beforeId: input.beforeId,
        afterId: input.afterId,
        userId,
      }),
    ),
  );
}

/** Delete a card (member-permitted). Confirm dialog lives in the UI. */
export async function deleteCardAction(input: { cardId: string }): Promise<void> {
  const userId = await requireUserId();
  await redirectOnBoardDenial(() => deleteCard({ cardId: input.cardId, userId }));
}

/**
 * Add a plain-text comment to a card (any member). Returns a form-state error on an
 * empty/oversized body; the thread shows the comment optimistically and the poll
 * behind it (5s) brings the stored row — and the card face's count — into line.
 */
export async function addCommentAction(input: {
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
}

/**
 * Delete a comment — the author's own, or any as a board owner (enforced in the db
 * layer). The UI only shows the delete control to a permitted user, so the db-layer
 * `CommentPermissionError` is a backstop — but a stale thread (the comment was
 * reassigned or the caller's role changed since render) can still hit it, so it's
 * returned as a form error the thread can display rather than thrown as a 500.
 */
export async function deleteCommentAction(input: {
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
