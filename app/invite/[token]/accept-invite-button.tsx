"use client";

import { useState, useTransition } from "react";
import { acceptInviteAction } from "./actions";

/**
 * The accept control on the invite screen. On success the action redirects to the
 * board, so the only thing there is to render here is the in-flight state and a
 * rejection the screen couldn't foresee — the invite expiring or being spent
 * between the page rendering and the click.
 */
export function AcceptInviteButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptInviteAction(token);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Joining…" : "Accept invite"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
