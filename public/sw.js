/*
 * The app-shell service worker (ticket 10, D8).
 *
 * What it is for: the installed app has to open when there is no network. That
 * needs two halves — this worker, which answers for the *shell* (the HTML, the
 * build output, the icons), and the IndexedDB-persisted query cache, which holds
 * the *board* (see `app/pwa/query-persistence.ts`). Neither is much use alone.
 *
 * The policy is `classifyRequest` below, and it is deliberately the only place a
 * caching decision is made — it's unit-tested in `app/pwa/sw-strategy.test.ts`.
 * Everything else here is plumbing.
 *
 * This file ships as-is to the browser, so it is plain JavaScript with no
 * imports: a service worker is not part of the Next bundle.
 */

// Bump to retire every cache this worker owns — the activate handler deletes any
// `kanban-` cache that isn't one of these two.
const VERSION = "v1";
const SHELL_CACHE = `kanban-shell-${VERSION}`;
const RUNTIME_CACHE = `kanban-runtime-${VERSION}`;

/** The page shown when a navigation fails and nothing for it was ever cached. */
const OFFLINE_URL = "/offline";

/** Precached at install, so the fallback exists before the first failure. */
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/** Cap on runtime entries, so a long-lived install doesn't grow without bound. */
const RUNTIME_LIMIT = 64;

/**
 * How a request should be answered. Pure, and the whole caching policy:
 *
 * - `passthrough` — not ours to touch. Writes and cross-origin requests, plus
 *   anything under `/api/auth/`: a cached session or CSRF response would leak one
 *   account's sign-in into the next launch on a shared phone, and a mutation
 *   answered from a cache would report a save that never reached the server.
 * - `asset` — cache-first. Content-hashed build output and icons; the cache name
 *   carries the version, so there is nothing to go stale.
 * - `navigation` — network-first, falling back to the last good copy of that page
 *   and then to the offline page. This is what makes a home-screen launch open.
 * - `data` — network-first, falling back to the last good response. Covers the
 *   board API and App Router flight data. The fallback is only for a cold start;
 *   a running board's freshness comes from its 4s poll (D4).
 */
function classifyRequest(request, origin) {
  if (request.method !== "GET") return "passthrough";

  const url = new URL(request.url);
  if (url.origin !== origin) return "passthrough";
  if (url.pathname.startsWith("/api/auth/")) return "passthrough";

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  ) {
    return "asset";
  }

  // Only a real page load is a navigation. An App Router transition fetches the
  // same path with an `_rsc` token instead, and is data — served the cached page
  // it would be unparseable.
  if (request.mode === "navigate") return "navigation";

  return "data";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One at a time rather than `addAll`: a single 404 shouldn't fail the whole
      // install and leave the app with no worker at all.
      await Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await deleteCaches((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = classifyRequest(event.request, self.location.origin);
  if (strategy === "passthrough") return;
  if (strategy === "asset") {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(networkFirst(event, strategy === "navigation"));
});

/**
 * Signing out drops everything this worker holds. The runtime cache contains
 * pages and API responses rendered for whoever was signed in; on a shared device
 * the next person must not be able to pull them back offline.
 */
self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "CLEAR_CACHES") {
    event.waitUntil(deleteCaches((name) => name !== SHELL_CACHE));
  }
  if (event.data.type === "CACHE_PAGE" && typeof event.data.url === "string") {
    event.waitUntil(warmPage(event.data.url));
  }
});

/**
 * Fetch a page and keep it, so it can be opened offline later.
 *
 * Without this the offline app would only open pages that had been *loaded* as
 * pages. In an App Router app most aren't: you sign in and arrive at the boards
 * list, tap a board and arrive at the board, all without a document request the
 * `navigation` strategy could have cached. The pages that matter therefore ask
 * for a copy of themselves once, when they're first rendered (see
 * `OfflineCopyWarmer`).
 */
async function warmPage(url) {
  const target = new URL(url, self.location.origin);
  if (target.origin !== self.location.origin) return;

  try {
    // `Accept: text/html` so Next answers with the page, not flight data. Same
    // origin, so the session cookie rides along and this is the signed-in page.
    const request = new Request(target.href, { headers: { Accept: "text/html" } });
    const response = await fetch(request);
    if (isCacheable(response)) await store(request, response);
  } catch {
    // No network, or the page refused — there's simply no offline copy of it.
  }
}

/** Drop every cache this worker owns that `predicate` selects. */
async function deleteCaches(predicate) {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith("kanban-") && predicate(name))
      .map((name) => caches.delete(name)),
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(event, isNavigation) {
  const request = event.request;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      // Off the critical path: the response is already on its way back.
      event.waitUntil(store(request, response.clone()));
    }
    return response;
  } catch (networkError) {
    const cached = await matchRuntime(request, isNavigation);
    if (cached) return cached;
    if (isNavigation) {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw networkError;
  }
}

/**
 * Only a plain 200 from our own origin is worth keeping. A redirect to sign-in or
 * a 403 from a board you were just removed from must never become the answer the
 * app opens with offline.
 */
function isCacheable(response) {
  return response.ok && response.status === 200 && response.type === "basic" && !response.redirected;
}

async function matchRuntime(request, isNavigation) {
  const cache = await caches.open(RUNTIME_CACHE);
  // Next varies HTML on the router's own headers, which a plain reload doesn't
  // send. For a page there is only ever one cached copy per URL (flight data
  // carries an `_rsc` token, so it keys separately), so ignoring `Vary` here
  // turns a guaranteed miss into the hit the launch depends on.
  return cache.match(request, isNavigation ? { ignoreVary: true } : undefined);
}

async function store(request, response) {
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response);

  const keys = await cache.keys();
  if (keys.length <= RUNTIME_LIMIT) return;
  // `keys()` is in insertion order, so this evicts the oldest entries first.
  await Promise.all(keys.slice(0, keys.length - RUNTIME_LIMIT).map((key) => cache.delete(key)));
}
