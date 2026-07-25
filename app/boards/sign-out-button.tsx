"use client";

import { useTransition } from "react";
import { clearOfflineData } from "@/app/pwa/service-worker";

/**
 * Sign out, taking the device's offline copy with it.
 *
 * The whole point of the PWA work is that the app opens with no network — which
 * means this account's boards are sitting in a cache on the phone. Signing out
 * has to clear them, or the next person to pick up the device could read them by
 * turning the network off. The session cookie goes last, once there is nothing
 * left to protect.
 */
export function SignOutButton({ signOut }: { signOut: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await clearOfflineData();
          await signOut();
        })
      }
      className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
