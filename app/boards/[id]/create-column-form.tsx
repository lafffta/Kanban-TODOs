"use client";

import { useState } from "react";
import { withNewColumn } from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { laneWidthClass } from "./column-lane";
import { createColumnAction } from "./actions";

/**
 * Adds a lane to the end of the board. The lane appears immediately (a provisional
 * column in the cached board, inert until the write returns) and the field clears
 * so the next lane can be typed straight away.
 */
export function CreateColumnForm() {
  const { boardId, run } = useBoard();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    setBusy(true);

    const result = await run({
      patches: [patchBoard(boardId, (data) => withNewColumn(data, { name: trimmed }))],
      action: () => createColumnAction({ boardId, name: trimmed }),
    });
    setBusy(false);
    if (result?.error) {
      setName(trimmed);
      setError(result.error);
      return;
    }
    setError(null);
  }

  return (
    <form onSubmit={submit} className={`${laneWidthClass} space-y-2`}>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          type="text"
          required
          maxLength={80}
          placeholder="New column"
          aria-label="New column name"
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
