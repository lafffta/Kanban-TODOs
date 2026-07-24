import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { requireCardMember } from "./cards";
import { comments, users, type Comment, type UserProfile } from "./schema";

/** Zod shape for a comment's body — the boundary check for posting a comment. */
export const commentBodySchema = z.object({
  // Plain multiline text, no markdown (D7). Trimmed and non-empty.
  body: z.string().trim().min(1, "Comment can't be empty.").max(5000),
});

/** Thrown when a comment id doesn't resolve — e.g. it was deleted concurrently. */
export class CommentNotFoundError extends Error {
  constructor(readonly commentId: string) {
    super(`Comment not found: ${commentId}`);
    this.name = "CommentNotFoundError";
  }
}

/**
 * Thrown when a member tries to delete a comment they neither authored nor own
 * the board over (D1: author deletes own, owner deletes any). Distinct from
 * `BoardAccessError` — the caller *is* a member, just not permitted this delete.
 */
export class CommentPermissionError extends Error {
  constructor(
    readonly commentId: string,
    readonly userId: string,
  ) {
    super(`User ${userId} may not delete comment ${commentId}`);
    this.name = "CommentPermissionError";
  }
}

/** A comment plus its resolved author profile (null for a former member). */
export type CommentWithAuthor = Comment & { author: UserProfile | null };

/**
 * A card's comments in `createdAt` order (id breaks any same-instant tie), each
 * with its author's display profile — null when the author is a former member
 * whose account was removed (`authorId` set null, D5). The caller checks board
 * membership first (route handler / server action); this is the plain read.
 */
export async function listComments(cardId: string): Promise<CommentWithAuthor[]> {
  const rows = await db
    .select({
      comment: comments,
      author: {
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      },
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.cardId, cardId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return rows.map((r) => ({ ...r.comment, author: r.author?.id ? r.author : null }));
}

/**
 * Post a comment on a card. Any board member may comment (D1); membership is
 * checked here, and the author is recorded so they (or an owner) can later delete
 * it. Comments are add + delete only — there is no edit path (D7).
 */
export async function addComment(input: {
  cardId: string;
  body: string;
  userId: string;
}): Promise<Comment> {
  await requireCardMember(input.cardId, input.userId);
  const [comment] = await db
    .insert(comments)
    .values({ cardId: input.cardId, authorId: input.userId, body: input.body })
    .returning();
  return comment;
}

/**
 * Delete a comment. The author may delete their own; a board owner may delete any
 * (D1). A member deleting someone else's comment is refused with
 * `CommentPermissionError`, leaving the comment untouched. Membership is confirmed
 * first, so a non-member is refused with `BoardAccessError` before permission is
 * even considered.
 */
export async function deleteComment(input: {
  commentId: string;
  userId: string;
}): Promise<void> {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, input.commentId))
    .limit(1);
  if (!comment) throw new CommentNotFoundError(input.commentId);

  const { membership } = await requireCardMember(comment.cardId, input.userId);

  const isAuthor = comment.authorId === input.userId;
  const isOwner = membership.role === "owner";
  if (!isAuthor && !isOwner) {
    throw new CommentPermissionError(input.commentId, input.userId);
  }

  await db.delete(comments).where(eq(comments.id, comment.id));
}
