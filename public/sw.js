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
// `kanban-` cache that isn't one of these three.
const VERSION = "v1";
const SHELL_CACHE = `kanban-shell-${VERSION}`;

// Pages and data are kept apart, and each is trimmed on its own. Sharing one
// bounded cache would let the chatty side evict the other: an account with a few
// boards prefetches an entry per link, and those would push out the one page an
// offline launch needs to open — the case this whole worker exists for.
const PAGE_CACHE = `kanban-pages-${VERSION}`;
const DATA_CACHE = `kanban-data-${VERSION}`;

/** The page shown when a navigation fails and nothing for it was ever cached. */
const OFFLINE_URL = "/offline";

/**
 * Set on every response this worker answers from a cache instead of the network.
 *
 * The worker cannot tell a device in airplane mode from a deployment that is down
 * or a domain that stopped resolving: all three arrive as one rejected `fetch`. So
 * it doesn't try to. It says only "this did not come from the server", and the app
 * decides what that means — `board-data.ts` treats a marked read as a failed one,
 * which is what puts the board into its "Not syncing" state. Without the marker a
 * failed poll is an HTTP 200 carrying a token that cannot have moved, and a board
 * nobody is syncing looks current forever (ticket 18).
 *
 * The name is declared canonically as `CACHED_RESPONSE_HEADER` in `board-data.ts`
 * and repeated here because this file ships as a plain script and cannot import
 * it. The worker's own tests import that constant, so the two cannot drift apart
 * without a failure.
 */
const CACHED_HEADER = "X-Kanban-Cached";

/** Precached at install, so they exist before the first failure. */
const SHELL_ASSETS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// Caps, so a long-lived install doesn't grow without bound. Pages are few and
// each one matters; data is many and every entry is replaceable by a poll.
const PAGE_LIMIT = 24;
const DATA_LIMIT = 64;

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
      await precacheOfflinePage(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = [SHELL_CACHE, PAGE_CACHE, DATA_CACHE];
      await deleteCaches((name) => !current.includes(name));
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
 * Signing out drops the pages and API responses rendered for whoever was signed
 * in; on a shared device the next person must not be able to pull them back
 * offline. The shell survives — it is the same for everyone.
 */
self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "CLEAR_CACHES") {
    const cleared = deleteCaches((name) => name !== SHELL_CACHE);
    event.waitUntil(cleared);
    // Answer when it's actually gone, so sign-out can drop the session *after*
    // the caches rather than racing them.
    const [port] = event.ports;
    if (port) void cleared.finally(() => port.postMessage({ type: "CACHES_CLEARED" }));
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
    if (isCacheable(response)) await keep(PAGE_CACHE, PAGE_LIMIT, request, response);
  } catch {
    // No network, or the page refused — there's simply no offline copy of it.
  }
}

/**
 * Precache the offline page *and the build output it needs to render*.
 *
 * Caching the HTML alone isn't enough: the page is server-rendered, but React
 * still hydrates it, and with its chunks missing the browser replaces the whole
 * document with "a client-side exception has occurred" — the fallback failing in
 * exactly the situation it exists for. The filenames are content-hashed and so
 * unknowable to a static list; they are read out of the page itself instead.
 */
async function precacheOfflinePage(cache) {
  try {
    const response = await fetch(OFFLINE_URL, { headers: { Accept: "text/html" } });
    if (!isCacheable(response)) return;

    const html = await response.clone().text();
    await cache.put(OFFLINE_URL, response);

    const assets = new Set(html.match(/\/_next\/static\/[^"'\\]+/g) ?? []);
    await Promise.all([...assets].map((url) => cache.add(url).catch(() => {})));
  } catch {
    // Installing with no network. The next activation precaches it instead; until
    // then a page that was never opened simply can't be opened offline.
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
  const cacheName = isNavigation ? PAGE_CACHE : DATA_CACHE;
  const limit = isNavigation ? PAGE_LIMIT : DATA_LIMIT;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      // Off the critical path: the response is already on its way back.
      event.waitUntil(keep(cacheName, limit, request, response.clone()));
    }
    return response;
  } catch (networkError) {
    const cached = await matchCached(cacheName, request, isNavigation);
    if (cached) return markCached(cached);
    if (isNavigation) {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return markCached(offline);
    }
    // Nothing to fall back to, so the failure is the answer. It always was for
    // this case; `markCached` is what makes the two above honest as well.
    throw networkError;
  }
}

/** The same response, marked as having come from a cache — see `CACHED_HEADER`. */
function markCached(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_HEADER, "1");
  // Rebuilt rather than mutated: a Response's headers are immutable once it has
  // one. The body is passed through as a stream, so nothing is buffered here.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Only a plain 200 from our own origin is worth keeping. A redirect to sign-in or
 * a 403 from a board you were just removed from must never become the answer the
 * app opens with offline.
 */
function isCacheable(response) {
  return response.ok && response.status === 200 && response.type === "basic" && !response.redirected;
}

/** The cached answer for a request, or undefined if there isn't one. */
async function matchCached(cacheName, request, isNavigation) {
  const cache = await caches.open(cacheName);
  // Next varies HTML on the router's own headers, which a plain reload doesn't
  // send. For a page there is only ever one cached copy per URL (flight data
  // carries an `_rsc` token and lives in the data cache anyway), so ignoring
  // `Vary` here turns a guaranteed miss into the hit the launch depends on.
  return cache.match(request, isNavigation ? { ignoreVary: true } : undefined);
}

/** Put a response in a cache, evicting the oldest entries once it's over `limit`. */
async function keep(cacheName, limit, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);

  const keys = await cache.keys();
  if (keys.length <= limit) return;
  // `keys()` is in insertion order, so this evicts the oldest entries first.
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
