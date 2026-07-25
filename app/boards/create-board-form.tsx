"use client";

import { useActionState, useState } from "react";
import { useOfflineWriteGate } from "@/app/pwa/offline-write-gate";
import { createBoardAction } from "./actions";

/** Inline "new board" form. Clears on success (the page revalidates the list). */
export function CreateBoardForm() {
  const [state, formAction, pending] = useActionState(createBoardAction, undefined);
  // The boards list is where an offline launch lands, so this form is reachable
  // with no network — where the action would reject with nothing to show (D8).
  const refuseWhileOffline = useOfflineWriteGate();
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const message = refuseWhileOffline();
        setRefused(message);
        if (message) event.preventDefault();
      }}
      className="flex gap-2"
    >
      <input
        name="name"
        type="text"
        required
        maxLength={100}
        placeholder="New board name"
        aria-label="New board name"
        className="flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "…" : "Create"}
      </button>
      {(refused ?? state?.error) && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">
          {refused ?? state?.error}
        </p>
      )}
    </form>
  );
}
