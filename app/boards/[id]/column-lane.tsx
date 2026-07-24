"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Column } from "@/db/schema";
import type { BoardMemberProfile } from "@/db/boards";
import type { CardWithAssignee } from "@/db/cards";
import { AddCardForm } from "./add-card-form";
import { CardItem } from "./card-item";
import {
  deleteColumnAction,
  renameColumnAction,
  reorderColumnAction,
  type ColumnFormState,
} from "./actions";

/** Where a column lands when moved one step left/right, or null if it can't. */
export type MoveTarget = { beforeId: string | null; afterId: string | null } | null;

/**
 * One board lane: its name (rename inline), reorder-by-one controls, delete (with
 * a confirm), its cards in `position` order, and an add-card form. Every control
 * routes through a membership-checked server action.
 */
export function ColumnLane({
  boardId,
  column,
  cards,
  members,
  moveLeft,
  moveRight,
}: {
  boardId: string;
  column: Column;
  cards: CardWithAssignee[];
  members: BoardMemberProfile[];
  moveLeft: MoveTarget;
  moveRight: MoveTarget;
}) {
  const [editing, setEditing] = useState(false);
  const rename = renameColumnAction.bind(null, boardId, column.id);
  const [state, renameForm, renaming] = useActionState<ColumnFormState, FormData>(
    rename,
    undefined,
  );
  const [isPending, startTransition] = useTransition();
  const busy = renaming || isPending;

  // The lane's card area is a drop target, so a card can be dropped into an empty
  // column (where there's no sibling card to hover) — the column id is the over id.
  const { setNodeRef: setDropRef } = useDroppable({ id: column.id });

  // Close the editor once a rename settles without an error.
  useEffect(() => {
    if (editing && !renaming && !state) setEditing(false);
  }, [editing, renaming, state]);

  function move(target: MoveTarget) {
    if (!target) return;
    startTransition(() =>
      reorderColumnAction({ boardId, columnId: column.id, ...target }),
    );
  }

  function remove() {
    if (!confirm(`Delete the "${column.name}" column?`)) return;
    startTransition(() => deleteColumnAction({ boardId, columnId: column.id }));
  }

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-2xl border border-black/10 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.03]">
      <header className="flex items-center gap-1 p-3">
        {editing ? (
          <form action={renameForm} className="flex flex-1 gap-1">
            <input
              name="name"
              type="text"
              required
              maxLength={80}
              defaultValue={column.name}
              aria-label="Column name"
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm font-semibold outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs font-medium opacity-70 hover:opacity-100 disabled:opacity-40"
            >
              Save
            </button>
          </form>
        ) : (
          <>
            <h2 className="flex-1 truncate text-sm font-semibold" title={column.name}>
              {column.name}
            </h2>
            <button
              type="button"
              onClick={() => move(moveLeft)}
              disabled={!moveLeft || busy}
              aria-label={`Move ${column.name} left`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => move(moveRight)}
              disabled={!moveRight || busy}
              aria-label={`Move ${column.name} right`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${column.name}`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              aria-label={`Delete ${column.name}`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:text-red-600 hover:opacity-100 disabled:opacity-20 dark:hover:text-red-400"
            >
              ✕
            </button>
          </>
        )}
      </header>
      {state?.error && editing && (
        <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <div ref={setDropRef} className="flex flex-1 flex-col gap-2 px-3 pb-3">
        <SortableContext
          items={cards.map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <CardItem key={card.id} boardId={boardId} card={card} members={members} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <p className="py-1 text-xs opacity-50">No cards yet.</p>
        )}
        <AddCardForm boardId={boardId} columnId={column.id} />
      </div>
    </section>
  );
}
