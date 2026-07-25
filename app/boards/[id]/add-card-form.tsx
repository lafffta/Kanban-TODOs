"use client";

import { useState } from "react";
import { withNewCard } from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { createCardAction } from "./actions";

/**
 * Adds a card to the end of a column. The card appears in the lane the moment the
 * form is submitted (a provisional row in the cached board) and is replaced by the
 * server's row when the write settles; the field clears straight away so the next
 * card can be typed without waiting.
 */
export function AddCardForm({
  columnId,
  disabled = false,
}: {
  columnId: string;
  /** True while the lane itself is still being created — nothing to add to yet. */
  disabled?: boolean;
}) {
  const { boardId, currentUserId, run } = useBoard();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");

    const result = await run({
      patches: [
        patchBoard(boardId, (data) =>
          withNewCard(data, { columnId, title: trimmed, createdById: currentUserId }),
        ),
      ],
      action: () => createCardAction({ boardId, columnId, title: trimmed }),
    });
    if (result?.error) {
      // Put the rejected title back so it isn't lost — the optimistic row has
      // already been rolled back.
      setTitle(trimmed);
      setError(result.error);
      return;
    }
    setError(null);
  }

  return (
    <form onSubmit={submit} className="space-y-1">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        type="text"
        required
        maxLength={200}
        disabled={disabled}
        placeholder="Add a card…"
        aria-label="New card title"
        className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 disabled:opacity-50 dark:border-white/20 dark:focus:border-white/50"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
