"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardCard, BoardColumn } from "./board-data";
import {
  isProvisional,
  withColumnRenamed,
  withMovedColumn,
  withoutColumn,
} from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { AddCardForm } from "./add-card-form";
import { CardFace, CardItem } from "./card-item";
import {
  deleteColumnAction,
  renameColumnAction,
  reorderColumnAction,
} from "./actions";

/** Where a column lands when moved one step left/right, or null if it can't. */
export type MoveTarget = { beforeId: string | null; afterId: string | null } | null;

/**
 * One board lane: its name (rename inline), reorder-by-one controls, delete (with
 * a confirm), its cards in `position` order, and an add-card form. Every control
 * routes through a membership-checked server action, patching the cached board
 * first so the change is on screen before the round trip finishes (D3).
 */
export function ColumnLane({
  column,
  cards,
  moveLeft,
  moveRight,
}: {
  column: BoardColumn;
  cards: BoardCard[];
  moveLeft: MoveTarget;
  moveRight: MoveTarget;
}) {
  const { boardId, run } = useBoard();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A lane the server hasn't acknowledged yet has an id nothing can be done to.
  const pending = isProvisional(column.id);

  // The lane's card area is a drop target, so a card can be dropped into an empty
  // column (where there's no sibling card to hover) — the column id is the over id.
  const { setNodeRef: setDropRef } = useDroppable({ id: column.id });

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const result = await run({
      patches: [patchBoard(boardId, (data) => withColumnRenamed(data, column.id, trimmed))],
      action: () => renameColumnAction({ columnId: column.id, name: trimmed }),
    });
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
  }

  function move(target: MoveTarget) {
    if (!target) return;
    void run({
      patches: [
        patchBoard(boardId, (data) => withMovedColumn(data, { columnId: column.id, ...target })),
      ],
      action: () => reorderColumnAction({ columnId: column.id, ...target }),
    });
  }

  function remove() {
    if (!confirm(`Delete the "${column.name}" column?`)) return;
    void run({
      patches: [patchBoard(boardId, (data) => withoutColumn(data, column.id))],
      action: () => deleteColumnAction({ columnId: column.id }),
    });
  }

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-2xl border border-black/10 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.03]">
      <header className="flex items-center gap-1 p-3">
        {editing ? (
          <form onSubmit={rename} className="flex flex-1 gap-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              type="text"
              required
              maxLength={80}
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
              disabled={!moveLeft || busy || pending}
              aria-label={`Move ${column.name} left`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => move(moveRight)}
              disabled={!moveRight || busy || pending}
              aria-label={`Move ${column.name} right`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              aria-label={`Rename ${column.name}`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || pending}
              aria-label={`Delete ${column.name}`}
              className="rounded-md px-1.5 py-1 text-sm opacity-60 hover:text-red-600 hover:opacity-100 disabled:opacity-20 dark:hover:text-red-400"
            >
              ✕
            </button>
          </>
        )}
      </header>
      {error && editing && (
        <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div ref={setDropRef} className="flex flex-1 flex-col gap-2 px-3 pb-3">
        <SortableContext
          items={cards.filter((card) => !isProvisional(card.id)).map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) =>
            // A card whose insert is still in flight is shown, but inert: its id
            // means nothing to the server yet, so it can't be dragged or edited.
            isProvisional(card.id) ? (
              <div key={card.id} className="opacity-60">
                <CardFace card={card} />
              </div>
            ) : (
              <CardItem key={card.id} card={card} />
            ),
          )}
        </SortableContext>
        {cards.length === 0 && <p className="py-1 text-xs opacity-50">No cards yet.</p>}
        <AddCardForm columnId={column.id} disabled={pending} />
      </div>
    </section>
  );
}
