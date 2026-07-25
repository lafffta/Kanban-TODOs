"use client";

import { useOnline } from "./connection";

/**
 * The "Offline" banner (D8).
 *
 * Launched from the home screen there is no browser chrome and no address bar, so
 * nothing else on screen would say why the board isn't changing and why nothing
 * can be saved. It says both, and it says them once, at the top of every page.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <p
      role="status"
      className="sticky top-0 z-40 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-slate-900"
    >
      Offline — showing your last synced board. Changes are paused.
    </p>
  );
}
