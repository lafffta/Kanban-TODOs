"use client";

import { useState, useTransition } from "react";
import { signOutOnceCleared } from "@/app/pwa/device-clearing";
import { useClearDevice } from "@/app/pwa/offline-data";

/**
 * Sign out, taking the device's copy of this account with it.
 *
 * The whole point of the PWA work is that the app opens with no network — which
 * means this account's boards are sitting on the phone in a cache. Signing out has
 * to clear them, or the next person to pick up the device could read them by
 * turning the network off. The session cookie goes last, once there is nothing
 * left to protect.
 *
 * And if the clearing doesn't work, the sign-out doesn't happen (ticket 19).
 * Dropping the session over a device that still holds the boards is the worst of
 * the two outcomes: it looks like the data is gone, and the person who picked the
 * phone up next is the one who finds out otherwise. So a failure is said out loud,
 * with what survived it named, and the session stays up until either a retry works
 * or the user decides — knowing what's left behind — to leave anyway.
 *
 * Still a `<form>` posting to the server action: with no JavaScript the submit goes
 * straight through and signs out, which is the behaviour this replaced. The handler
 * only takes over when there is a browser able to do the clearing.
 */
export function SignOutButton({ signOut }: { signOut: () => Promise<void> }) {
  const clearDevice = useClearDevice();
  const [pending, startTransition] = useTransition();
  const [remaining, setRemaining] = useState<string[] | null>(null);

  const clearThenSignOut = () => {
    setRemaining(null);
    startTransition(async () => {
      setRemaining(await signOutOnceCleared(clearDevice, signOut));
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <form
        action={signOut}
        onSubmit={(event) => {
          event.preventDefault();
          clearThenSignOut();
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20"
        >
          {pending ? "Signing out…" : remaining ? "Try again" : "Sign out"}
        </button>
      </form>

      {remaining && !pending && (
        // An alert, not a status: unlike a paused write, this is something the
        // person has to act on before walking away from the device.
        <div role="alert" className="max-w-xs text-right text-sm">
          <p className="font-medium text-red-700 dark:text-red-400">
            Couldn&apos;t clear this device
          </p>
          <p className="mt-1 opacity-70">
            Some of this account&apos;s data — {listSentence(remaining)} — could still be
            opened on this device without a network, so you&apos;re still signed in. Try
            again, or sign out anyway if this device is yours.
          </p>
          {/* Its own form, so it posts to the same action with no JavaScript in the
              way — the escape hatch has to be the reliable path. Deliberately plain
              text next to a real button: retrying is the action being offered, and
              this one names what it costs rather than reading as the way out. */}
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-sm underline opacity-70">
              Sign out and leave the copy on this device
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** "a", "a and b", "a, b and c" — the areas read back as a sentence. */
function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
