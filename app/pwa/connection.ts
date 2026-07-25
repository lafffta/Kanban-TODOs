"use client";

import { useSyncExternalStore } from "react";

/** What a blocked write says, wherever it's reported (D8: no write queue in v1). */
export const OFFLINE_WRITE_MESSAGE =
  "You're offline. Changes are paused until you reconnect.";

/** Re-read `navigator.onLine` whenever the browser says the connection changed. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser believes it has a network.
 *
 * `navigator.onLine` is a coarse signal — it says the device has *a* connection,
 * not that our server is reachable — but it's the one that flips the instant a
 * phone loses signal, which is what the banner and the write gate need. A request
 * that fails despite it is handled where it fails: a mutation rolls its optimistic
 * patch back and reports itself, and a failing poll raises the board's own
 * "not syncing" notice.
 *
 * Server-rendered as online, so the first paint carries no offline chrome; a
 * device that really is offline corrects it on hydration.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
