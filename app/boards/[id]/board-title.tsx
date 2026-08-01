"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { forgetBoard } from "@/app/pwa/offline-data";
import { useOfflineWriteGate } from "@/app/pwa/offline-write-gate";
import { boardKeys } from "./board-data";
import { deleteBoardAction, renameBoardAction } from "./actions";

/**
 * The board's name in the page header, and — for an owner — the two lifecycle
 * controls D1 reserves for them: rename it inline, or delete it for everyone.
 * A member sees the heading alone.
 *
 * Both writes are owner-checked in the db layer, so this decides what to *offer*,
 * never what is *permitted*. Neither is optimistic: the name is server-rendered
 * here and in the boards list, so the action revalidates both paths and the new
 * heading arrives with the refreshed page rather than being painted ahead of it.
 *
 * The polled board payload carries the name too, and a rename moves no version
 * token — `boardVersion` is built from the board's *contents* — so nothing would
 * ever correct the copy the device is holding, including the one persisted to
 * IndexedDB (D8). Both writes therefore clear it here rather than leaving it to
 * the polling loop.
 */
export function BoardTitle({
  boardId,
  name,
  isOwner,
}: {
  boardId: string;
  name: string;
  isOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  // The header sits outside the board's query provider, so — like the members
  // panel — it carries the offline gate itself: offline, every write is refused (D8).
  const refuseWhileOffline = useOfflineWriteGate();

  const heading = <h1 className="mt-1 text-2xl font-semibold">{name}</h1>;
  if (!isOwner) return heading;

  function edit() {
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
    // Start from the name on screen, not from an abandoned earlier draft.
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function rename(event: React.FormEvent) {
    event.preventDefault();
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
    startTransition(async () => {
      // The draft is sent as typed: the action's `boardNameSchema` is the one
      // authority on what a name may be, so a name of nothing but spaces comes
      // back with a reason instead of the form quietly doing nothing.
      const result = await renameBoardAction({ boardId, name: draft });
      if (result?.error) {
        setError(result.error);
        return;
      }
      // The refreshed page brings the new heading; this brings the payload the
      // board's queries are still holding under the old name.
      queryClient.invalidateQueries({ queryKey: boardKeys.board(boardId) });
      setError(null);
      setEditing(false);
    });
  }

  function remove() {
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
    // Deletion takes the board's columns, cards and comments with it (D5), so it
    // asks first — and says what it means.
    if (!confirm(`Delete "${name}" and everything on it? This can't be undone.`)) {
      return;
    }
    // Forgotten *before* the delete is sent: the action ends with a redirect,
    // which unmounts this page, so code after the await isn't a place to rely on.
    // A refused delete costs only a refetch and a note rewritten on the next visit.
    forgetBoard(queryClient, boardId);
    startTransition(() => deleteBoardAction({ boardId }));
  }

  return (
    <div>
      {editing ? (
        <form onSubmit={rename} className="mt-1 flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            type="text"
            required
            maxLength={100}
            aria-label="Board name"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-black/20 bg-transparent px-2 py-1 text-2xl font-semibold outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-white/20"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg px-2 py-1.5 text-sm opacity-60 hover:opacity-100"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {heading}
          <button
            type="button"
            onClick={edit}
            disabled={pending}
            className="rounded-lg border border-black/15 px-2 py-1 text-xs font-medium disabled:opacity-40 dark:border-white/20"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg border border-black/15 px-2 py-1 text-xs font-medium hover:text-red-600 disabled:opacity-40 dark:border-white/20 dark:hover:text-red-400"
          >
            Delete board
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
