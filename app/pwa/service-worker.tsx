"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Installs `public/sw.js`, which is what makes the app open with no network.
 *
 * Production only, and it actively removes itself in development: a worker
 * serving cached build output on `localhost` outlives the build that produced it
 * and will hand hot-reloaded pages stale chunks. Verifying the offline behaviour
 * therefore means `npm run build && npm start`, which is also the only way to see
 * the real install prompt.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          registrations.forEach((registration) => void registration.unregister()),
        )
        .catch(() => {});
      return;
    }

    // Registration is not urgent and competes with the first render for
    // bandwidth, so it waits for the page to finish loading.
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

/**
 * Asks the service worker for an offline copy of the page this renders on.
 *
 * The worker caches pages it *serves*, which in an App Router app misses the ones
 * that matter: you sign in and arrive at the boards list, tap a board and arrive
 * at the board — both client-side transitions, neither a document request. A
 * launch with no network would then find nothing cached for either and fall
 * through to the offline page, which is precisely the case D8 exists to avoid.
 *
 * So the two pages an offline launch needs render this, and it asks for a copy of
 * exactly one page: the one it's on. Twice at most — on arrival, and again when
 * the app is put away, which is when the copy someone comes back to is decided.
 */
export function OfflineCopyWarmer() {
  // Re-runs on client-side navigation, which is exactly the case being covered.
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // The path without its query: an offline launch opens `/boards/:id`, so a
    // copy filed under `/boards/:id?mine=1` would be one it could never find.
    const url = `${window.location.origin}${pathname}`;

    const warm = () => {
      if (!navigator.onLine) return;
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.active?.postMessage({ type: "CACHE_PAGE", url }))
        .catch(() => {});
    };

    // A page that really was loaded is already cached by having been served.
    const [documentLoad] = performance.getEntriesByType("navigation");
    if (documentLoad?.name !== url) warm();

    // Leaving the app is the moment worth capturing: it's the state a launch is
    // expecting to come back to, and it's long past the first paint.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") warm();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pathname]);

  return null;
}
