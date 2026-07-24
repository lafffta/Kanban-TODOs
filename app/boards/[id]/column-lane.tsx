"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Column } from "@/db/schema";
import {
  deleteColumnAction,
  renameColumnAction,
  reorderColumnAction,
  type ColumnFormState,
} from "./actions";

/** Where a column lands when moved one step left/right, or null if it can't. */
export type MoveTarget = { beforeId: string | null; afterId: string | null } | null;

/**
 * One board lane: its name (rename inline), reorder-by-one controls, and delete
 * (with a confirm). Cards render inside a lane in the next ticket — for now the
 * body is an empty-state placeholder. Every control routes through a membership-
 * checked server action.
 */
export function ColumnLane({
  boardId,
  column,
  moveLeft,
  moveRight,
}: {
  boardId: string;
  column: Column;
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
      <div className="flex-1 px-3 pb-3 text-xs opacity-50">No cards yet.</div>
    </section>
  );
}
