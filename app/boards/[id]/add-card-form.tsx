"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCardAction, type CardFormState } from "./actions";

/** Adds a card to the end of a column. Clears on success (the page revalidates). */
export function AddCardForm({
  boardId,
  columnId,
}: {
  boardId: string;
  columnId: string;
}) {
  const action = createCardAction.bind(null, boardId, columnId);
  const [state, formAction, pending] = useActionState<CardFormState, FormData>(
    action,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // On a successful submit the action returns undefined; reset so the next card
  // can be typed straight away.
  useEffect(() => {
    if (!pending && !state) formRef.current?.reset();
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-1">
      <input
        name="title"
        type="text"
        required
        maxLength={200}
        placeholder="Add a card…"
        aria-label="New card title"
        className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
      />
      {state?.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
