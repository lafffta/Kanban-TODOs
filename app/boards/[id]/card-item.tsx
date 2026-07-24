"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { BoardMemberProfile } from "@/db/boards";
import type { CardWithAssignee } from "@/db/cards";
import { Avatar, displayName } from "./avatar";
import {
  assignCardAction,
  deleteCardAction,
  updateCardAction,
  type CardFormState,
} from "./actions";

/**
 * One card in a lane. Collapsed it shows its title and, when assigned, the
 * assignee's avatar. Clicking opens an inline editor for the title + description
 * (plain multiline text), an assignee picker, and delete. Every control routes
 * through a membership-checked server action.
 */
export function CardItem({
  boardId,
  card,
  members,
}: {
  boardId: string;
  card: CardWithAssignee;
  members: BoardMemberProfile[];
}) {
  const [editing, setEditing] = useState(false);
  const save = updateCardAction.bind(null, boardId, card.id);
  const [state, saveForm, saving] = useActionState<CardFormState, FormData>(
    save,
    undefined,
  );
  const [isPending, startTransition] = useTransition();
  const busy = saving || isPending;

  // Close the editor once a save settles without an error.
  useEffect(() => {
    if (editing && !saving && !state) setEditing(false);
  }, [editing, saving, state]);

  function assign(assigneeId: string | null) {
    startTransition(() => assignCardAction({ boardId, cardId: card.id, assigneeId }));
  }

  function remove() {
    if (!confirm(`Delete the "${card.title}" card?`)) return;
    startTransition(() => deleteCardAction({ boardId, cardId: card.id }));
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-full items-start gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-left shadow-sm transition hover:border-black/25 dark:border-white/10 dark:bg-white/[0.06] dark:hover:border-white/30"
      >
        <span className="flex-1 whitespace-pre-wrap break-words text-sm">{card.title}</span>
        {card.assignee && <Avatar user={card.assignee} />}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-black/15 bg-white p-3 shadow-sm dark:border-white/20 dark:bg-white/[0.06]">
      <form action={saveForm} className="space-y-2">
        <input
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={card.title}
          aria-label="Card title"
          autoFocus
          className="w-full rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm font-medium outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
        />
        <textarea
          name="description"
          rows={4}
          maxLength={5000}
          defaultValue={card.description}
          placeholder="Add a description…"
          aria-label="Card description"
          className="w-full resize-y rounded-md border border-black/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
        />
        {state?.error && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {saving ? "Saving…" : "Save"}
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
          onChange={(e) => assign(e.target.value === "" ? null : e.target.value)}
          aria-label="Assignee"
          className="min-w-0 flex-1 rounded-md border border-black/20 bg-transparent px-2 py-1 outline-none focus:border-black/50 disabled:opacity-50 dark:border-white/25 dark:focus:border-white/60"
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {displayName(m)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
