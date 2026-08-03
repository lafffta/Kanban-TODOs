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
      <h1 className="text-xl font-semibold">Signed out</h1>
      <p className="max-w-sm text-sm opacity-70">
        This account was signed out in another tab, and the boards saved on this device
        for offline use have been cleared.
      </p>
      {/* A plain link: a full page load, when the person asks for one, long after
          the clearing has finished. */}
      <a href="/sign-in" className="text-sm font-medium underline">
        Sign in again
      </a>
    </main>
  );
}
