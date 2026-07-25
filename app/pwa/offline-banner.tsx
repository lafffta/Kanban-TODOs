"use client";

import { useOnline } from "./connection";

/**
 * The amber strip that says the app is offline. One look for every place that has
 * to say it, so the message reads the same wherever it appears.
 *
 * A live region, not an alert: a paused board is news, not an emergency.
 */
export function OfflineNotice({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`bg-amber-500 px-4 text-center font-medium text-slate-900 ${className}`}
    >
      {children}
    </p>
  );
}

/**
 * The "Offline" banner (D8).
 *
 * Launched from the home screen there is no browser chrome and no address bar, so
 * nothing else on screen would say why the board isn't changing and why nothing
 * can be saved. It says both, and it says them once, at the top of every page.
 *
 * The card sheet covers it on a phone, so the sheet carries its own copy.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <OfflineNotice className="sticky top-0 z-40 py-2 text-sm">
      Offline — showing your last synced board. Changes are paused.
    </OfflineNotice>
  );
}
