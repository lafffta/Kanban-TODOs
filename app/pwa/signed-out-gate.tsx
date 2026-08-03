"use client";

import { useSignedOutElsewhere } from "./offline-data";

/**
 * What a tab shows once another tab has signed the account out (ticket 19).
 *
 * The sign-out clears the device, but a second tab left open on a board is still
 * a copy of it — in memory, and legible on the screen of a phone someone has just
 * handed over. `useSignedOutElsewhere` drops the memory; this drops the screen,
 * by rendering in place of the app rather than around it.
 *
 * It fetches nothing and navigates nowhere on its own. A page load from here would
 * be a request the service worker caches, refilling the cache the other tab is at
 * that moment sweeping — and the sign-out would then refuse to complete, over an
 * entry it created itself.
 */
export function SignedOutGate({ children }: { children: React.ReactNode }) {
  const signedOut = useSignedOutElsewhere();
  if (!signedOut) return children;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">This tab has let go of its copy</h1>
      {/* Careful about what this claims. The other tab announced that it was
          clearing the device, not that it succeeded — if it couldn't, it holds the
          session open and nobody is signed out. So this says only what is true
          either way, and reloading lands wherever the truth turns out to be: the
          sign-in page if the sign-out went through, the board if it didn't. */}
      <p className="max-w-sm text-sm opacity-70">
        Another tab signed out and cleared the boards saved on this device for offline
        use. Reload to carry on.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
      >
        Reload
      </button>
    </main>
  );
}
