"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Avatar, displayName } from "./avatar";
import { addCommentAction, deleteCommentAction } from "./actions";

/**
 * A comment as the read API serves it: dates arrive JSON-serialized as ISO
 * strings, and the author is null for a former member whose account was removed.
 */
type ThreadComment = {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string; image: string | null } | null;
};

/** A short, locale-formatted timestamp for a comment. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The comment thread inside a card's detail view: the card's comments (newest at
 * the bottom), a box to post a plain-text comment, and a delete control on each
 * comment the current user may remove — their own, or any as a board owner. The
 * thread is fetched from `GET /api/cards/:id/comments` when the card opens and
 * re-fetched after each add/delete; every mutation routes through a
 * membership-checked server action.
 */
export function CommentThread({
  boardId,
  cardId,
  currentUserId,
  isOwner,
}: {
  boardId: string;
  cardId: string;
  currentUserId: string;
  isOwner: boolean;
}) {
  const [comments, setComments] = useState<ThreadComment[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const res = await fetch(`/api/cards/${cardId}/comments`);
    if (!res.ok) {
      setError("Couldn't load comments.");
      return;
    }
    const data = (await res.json()) as { comments: ThreadComment[] };
    setComments(data.comments);
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load]);

  function add(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await addCommentAction({ boardId, cardId, body: trimmed });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setBody("");
      setError(null);
      await load();
    });
  }

  function remove(commentId: string) {
    startTransition(async () => {
      await deleteCommentAction({ boardId, commentId });
      await load();
    });
  }

  function canDelete(comment: ThreadComment): boolean {
    return isOwner || comment.authorId === currentUserId;
  }

  return (
    <section className="mt-2 border-t border-black/10 pt-2 dark:border-white/10">
      <h3 className="mb-2 text-xs font-semibold opacity-60">Comments</h3>

      {comments === null ? (
        <p className="text-xs opacity-50">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs opacity-50">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="flex items-start gap-2 text-sm">
              {comment.author ? (
                <Avatar user={comment.author} size={20} />
              ) : (
                <Avatar
                  user={{ id: "", name: null, email: "?", image: null }}
                  size={20}
                  title="Former member"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-medium">
                    {comment.author ? displayName(comment.author) : "Former member"}
                  </span>
                  <span className="text-[11px] opacity-50">
                    {formatWhen(comment.createdAt)}
                  </span>
                  {canDelete(comment) && (
                    <button
                      type="button"
                      onClick={() => remove(comment.id)}
                      disabled={pending}
                      aria-label="Delete comment"
                      className="ml-auto shrink-0 rounded px-1 text-xs opacity-50 hover:text-red-600 hover:opacity-100 disabled:opacity-30 dark:hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-2 space-y-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Add a comment…"
          aria-label="New comment"
          className="w-full resize-y rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || body.trim() === ""}
          className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "Posting…" : "Comment"}
        </button>
      </form>
    </section>
  );
}
