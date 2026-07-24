"use client";

import { useActionState, useEffect, useRef } from "react";
import { createColumnAction, type ColumnFormState } from "./actions";

/** Adds a lane to the end of the board. Clears on success (the page revalidates). */
export function CreateColumnForm({ boardId }: { boardId: string }) {
  const action = createColumnAction.bind(null, boardId);
  const [state, formAction, pending] = useActionState<ColumnFormState, FormData>(
    action,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // On a successful submit the action returns undefined; reset the field so the
  // next lane can be typed straight away.
  useEffect(() => {
    if (!pending && !state) formRef.current?.reset();
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="w-72 shrink-0 space-y-2">
      <div className="flex gap-2">
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          placeholder="New column"
          aria-label="New column name"
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "…" : "Add"}
        </button>
      </div>
      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
