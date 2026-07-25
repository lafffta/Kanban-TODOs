"use client";

import { useTransition } from "react";
import { clearOfflineData } from "@/app/pwa/offline-data";

/**
 * Sign out, taking the device's offline copy with it.
 *
 * The whole point of the PWA work is that the app opens with no network — which
 * means this account's boards are sitting in a cache on the phone. Signing out
 * has to clear them, or the next person to pick up the device could read them by
 * turning the network off. The session cookie goes last, once there is nothing
 * left to protect.
 *
 * Still a `<form>` posting to the server action: with no JavaScript the submit
 * goes straight through and signs out, which is the behaviour this replaced. The
 * handler only takes over when there is a browser able to do the clearing.
 */
export function SignOutButton({ signOut }: { signOut: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={signOut}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          await clearOfflineData();
          await signOut();
        });
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
