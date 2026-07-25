"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardCard } from "./board-data";
import { Avatar } from "./avatar";
import { CardSheet } from "./card-sheet";

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
 * One card in a lane: its title and, when assigned, the assignee's avatar. Opening
 * it hands over to `CardSheet` — the editor, the assignee picker and the comment
 * thread live there, as a full-screen sheet on a phone and a side panel on a
 * desktop (ticket 10).
 *
 * Drag-and-drop (ticket 06). The whole face is the drag handle; the mouse sensor's
 * activation distance keeps a plain click opening the card, and the touch sensor's
 * long-press keeps a tap opening it and a swipe scrolling.
 */
export function CardItem({ card }: { card: BoardCard }) {
  const [open, setOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  return (
    <>
      <button
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : undefined,
        }}
        type="button"
        onClick={() => setOpen(true)}
        className={`${cardFaceBase} bg-white shadow-sm transition hover:border-black/25 dark:bg-white/[0.06] dark:hover:border-white/30`}
        {...attributes}
        {...listeners}
      >
        <span className="flex-1 whitespace-pre-wrap break-words text-sm">{card.title}</span>
        <CommentCount count={card.commentCount} />
        {card.assignee && <Avatar user={card.assignee} />}
      </button>

      {/* Keyed on the card so an open sheet always edits the card it was opened
          on, even if a poll reorders the lane underneath it. */}
      {open && <CardSheet key={card.id} card={card} onClose={() => setOpen(false)} />}
    </>
  );
}
