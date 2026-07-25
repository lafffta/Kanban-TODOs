"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardCard } from "./board-data";
import { withCardPatch, withoutCard } from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { Avatar, displayName } from "./avatar";
import { CommentThread } from "./comment-thread";
import { assignCardAction, deleteCardAction, updateCardAction } from "./actions";

// Shared box styling for a card's collapsed face — reused by the interactive card
// and by the drag overlay clone so the lifted card looks identical to its slot.
const cardFaceBase =
  "flex w-full items-start gap-2 rounded-xl border border-black/10 px-3 py-2 text-left dark:border-white/10";

/** A small "💬 N" badge on a card face, shown only when the card has comments. */
function CommentCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-xs opacity-60"
      aria-label={`${count} comment${count === 1 ? "" : "s"}`}
      title={`${count} comment${count === 1 ? "" : "s"}`}
    >
      <span aria-hidden>💬</span>
      {count}
    </span>
  );
}

/**
 * A card's collapsed face — title, a comment count when it has comments, and the
 * assignee's avatar when assigned. Used for the `DragOverlay` clone and for a card
 * whose insert hasn't come back from the server yet; the interactive collapsed card
 * below repeats the same content on a sortable `<button>`.
 */
export function CardFace({
  card,
  dragging = false,
}: {
  card: BoardCard;
  dragging?: boolean;
}) {
  return (
    <div
      className={`${cardFaceBase} bg-white dark:bg-white/[0.06] ${
        dragging ? "cursor-grabbing shadow-lg" : "shadow-sm"
      }`}
    >
      <span className="flex-1 whitespace-pre-wrap break-words text-sm">{card.title}</span>
      <CommentCount count={card.commentCount} />
      {card.assignee && <Avatar user={card.assignee} />}
    </div>
  );
}

/**
 * One card in a lane. Collapsed it shows its title and, when assigned, the
 * assignee's avatar. Clicking opens an inline editor for the title + description
 * (plain multiline text), an assignee picker, and delete. Every control routes
 * through a membership-checked server action and patches the cached board first,
 * so the edit shows before the round trip returns and reconciles on settle (D3).
 */
export function CardItem({ card }: { card: BoardCard }) {
  const { boardId, members, run } = useBoard();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Drag-and-drop (ticket 06). The whole collapsed face is the drag handle; the
  // mouse sensor's activation distance keeps a plain click opening the editor,
  // and the touch sensor's long-press keeps a tap editing and a swipe scrolling.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  function open() {
    // Start from what the board currently shows — a poll may have brought someone
    // else's edit in since this card was last rendered.
    setTitle(card.title);
    setDescription(card.description);
    setError(null);
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const result = await run({
      patches: [
        patchBoard(boardId, (data) =>
          withCardPatch(data, card.id, { title: trimmed, description }),
        ),
      ],
      action: () => updateCardAction({ cardId: card.id, title: trimmed, description }),
    });
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
  }

  function assign(assigneeId: string | null) {
    const assignee = members.find((member) => member.id === assigneeId) ?? null;
    void run({
      patches: [patchBoard(boardId, (data) => withCardPatch(data, card.id, { assigneeId, assignee }))],
      action: () => assignCardAction({ cardId: card.id, assigneeId }),
    });
  }

  function remove() {
    if (!confirm(`Delete the "${card.title}" card?`)) return;
    void run({
      patches: [patchBoard(boardId, (data) => withoutCard(data, card.id))],
      action: () => deleteCardAction({ cardId: card.id }),
    });
  }

  if (!editing) {
    return (
      <button
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : undefined,
        }}
        type="button"
        onClick={open}
        className={`${cardFaceBase} bg-white shadow-sm transition hover:border-black/25 dark:bg-white/[0.06] dark:hover:border-white/30`}
        {...attributes}
        {...listeners}
      >
        <span className="flex-1 whitespace-pre-wrap break-words text-sm">{card.title}</span>
        <CommentCount count={card.commentCount} />
        {card.assignee && <Avatar user={card.assignee} />}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-black/15 bg-white p-3 shadow-sm dark:border-white/20 dark:bg-white/[0.06]">
      <form onSubmit={save} className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          type="text"
          required
          maxLength={200}
          aria-label="Card title"
          autoFocus
          className="w-full rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm font-medium outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Add a description…"
          aria-label="Card description"
          className="w-full resize-y rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="ml-auto rounded-md px-2 py-1 text-xs opacity-70 hover:text-red-600 hover:opacity-100 disabled:opacity-40 dark:hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </form>

      <label className="mt-2 flex items-center gap-2 border-t border-black/10 pt-2 text-xs dark:border-white/10">
        <span className="opacity-60">Assignee</span>
        <select
          value={card.assigneeId ?? ""}
          disabled={busy}
          onChange={(event) => assign(event.target.value === "" ? null : event.target.value)}
          aria-label="Assignee"
          className="min-w-0 flex-1 rounded-md border border-black/20 bg-transparent px-2 py-1 outline-none focus:border-black/50 disabled:opacity-50 dark:border-white/25 dark:focus:border-white/60"
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {displayName(member)}
            </option>
          ))}
        </select>
      </label>

      <CommentThread cardId={card.id} />
    </div>
  );
}
