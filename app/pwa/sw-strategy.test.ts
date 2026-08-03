import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CACHED_RESPONSE_HEADER } from "@/app/boards/[id]/board-data";

// The rule the offline app rests on (D8): which requests the service worker may
// answer from a cache, which must always reach the network, and — once it has
// answered from a cache — how it says so. Getting this wrong is not a cosmetic bug:
// caching a sign-in response would hand one account's session to the next, caching
// a write would "succeed" a mutation that never happened, and answering a failed
// poll with a silent cached 200 would leave a board looking current forever
// (ticket 18).
//
// `public/sw.js` ships as a plain script the browser runs, so it can't be imported
// here. Its source is evaluated against a stub `self`, an in-memory Cache API and a
// stand-in server, and the worker is then driven the way the browser drives it.

type Strategy = "passthrough" | "navigation" | "data" | "asset";
type RequestLike = { method: string; url: string; mode?: string };
type Network = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ORIGIN = "https://kanban.example";
const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const VERSION_PATH = "/api/boards/abc/version";
const BOARD_PATH = "/api/boards/abc";
const PAGE_PATH = "/boards/abc";

// ---------------------------------------------------------------------------
// The browser the worker runs in
// ---------------------------------------------------------------------------

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, ORIGIN).href;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Enough of `Cache` for the worker to run against, keyed by URL. */
class FakeCache {
  private readonly entries = new Map<string, Response>();

  constructor(private readonly network: Network) {}

  async put(request: RequestInfo, response: Response): Promise<void> {
    this.entries.set(urlOf(request), response);
  }

  /** A fresh copy each time, as the real Cache API hands one out. */
  async match(request: RequestInfo): Promise<Response | undefined> {
    return this.entries.get(urlOf(request))?.clone();
  }

  async add(request: RequestInfo): Promise<void> {
    const response = await this.network(urlOf(request));
    if (!response.ok) throw new Error(`could not cache ${urlOf(request)}`);
    await this.put(request, response);
  }

  /** Insertion order, which is what the worker's eviction relies on. */
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

/** Enough of `CacheStorage`, including the cross-cache `match`. */
class FakeCacheStorage {
  private readonly opened = new Map<string, FakeCache>();

  constructor(private readonly network: Network) {}

  async open(name: string): Promise<FakeCache> {
    const existing = this.opened.get(name);
    if (existing) return existing;
    const cache = new FakeCache(this.network);
    this.opened.set(name, cache);
    return cache;
  }

  async match(request: RequestInfo): Promise<Response | undefined> {
    for (const cache of this.opened.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** Mark a response same-origin — what the worker checks before keeping one. */
function basic(response: Response): Response {
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

/** A JSON response as the network delivers it from our own origin. */
function live(body: unknown): Response {
  return basic(Response.json(body));
}

/** An HTML page as the network delivers it. */
function page(html: string): Response {
  return basic(new Response(html, { headers: { "content-type": "text/html" } }));
}

/**
 * A stand-in server that can be taken away.
 *
 * `goDown` covers airplane mode, a dead deployment and a domain that stopped
 * resolving alike — from inside the worker all three are the same rejected
 * `fetch`, which is the whole reason it must not answer any of them with a
 * response that looks live.
 */
function server(routes: Record<string, () => Response>) {
  let reachable = true;
  const network: Network = async (input) => {
    if (!reachable) throw new TypeError("Failed to fetch");
    const route = routes[new URL(urlOf(input)).pathname];
    return route ? route() : basic(new Response("not found", { status: 404 }));
  };
  return {
    network,
    goDown: () => {
      reachable = false;
    },
    comeBack: () => {
      reachable = true;
    },
  };
}

type Worker = {
  classify: (request: RequestLike, origin: string) => Strategy;
  /** Run the install handler, as the browser does before the worker serves. */
  install: () => Promise<void>;
  /** Hand the worker a request and get back what it answers with. */
  respondTo: (request: RequestLike) => Promise<Response>;
};

function startWorker(network: Network): Worker {
  const listeners = new Map<string, (event: never) => void>();
  const self = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
    location: { origin: ORIGIN },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  // The worker's top level only registers listeners; evaluating it captures them
  // and hands back the pure classifier for the tests that exercise it directly.
  const classify = new Function(
    "self",
    "caches",
    "fetch",
    `${SOURCE}\nreturn classifyRequest;`,
  )(self, new FakeCacheStorage(network), network) as Worker["classify"];

  const dispatch = (type: string, event: Record<string, unknown>) => {
    const listener = listeners.get(type) as ((event: Record<string, unknown>) => void) | undefined;
    if (!listener) throw new Error(`the worker registered no "${type}" listener`);
    listener(event);
  };

  return {
    classify,
    install: async () => {
      const pending: Promise<unknown>[] = [];
      dispatch("install", { waitUntil: (work: Promise<unknown>) => pending.push(work) });
      await Promise.all(pending);
    },
    respondTo: async (request) => {
      const pending: Promise<unknown>[] = [];
      let answer: Promise<Response> | undefined;
      dispatch("fetch", {
        request,
        respondWith: (response: Promise<Response>) => {
          answer = response;
        },
        waitUntil: (work: Promise<unknown>) => pending.push(work),
      });
      if (!answer) throw new Error("the worker passed this request through");
      try {
        return await answer;
      } finally {
        // The worker caches off the critical path; wait for it, so a later
        // request sees what this one stored.
        await Promise.allSettled(pending);
      }
    },
  };
}

/** A same-origin GET for `path`, as the browser would issue it. */
function get(path: string, mode = "cors"): RequestLike {
  return { method: "GET", url: `${ORIGIN}${path}`, mode };
}

// The classifier is pure, so any worker's copy of it answers the same.
const { classify } = startWorker(server({}).network);

// ---------------------------------------------------------------------------
// Which strategy a request gets
// ---------------------------------------------------------------------------

test("a page load is network-first, so it shows the real board whenever it can", () => {
  expect(classify(get("/boards/abc", "navigate"), ORIGIN)).toBe("navigation");
});

test("board reads are network-first with a cached fallback", () => {
  // The fallback is what makes a hard reload of an installed app resolve offline;
  // the freshness the board actually runs on is the 4s poll (D4).
  expect(classify(get("/api/boards/abc"), ORIGIN)).toBe("data");
  expect(classify(get("/api/boards/abc/version"), ORIGIN)).toBe("data");
});

test("a client-side navigation's flight data is treated as data, not as a page", () => {
  // App Router transitions fetch the same path with an `_rsc` token rather than a
  // navigation request; served the cached *page* they'd be unparseable.
  expect(classify(get("/boards/abc?_rsc=1a2b3c"), ORIGIN)).toBe("data");
});

test("auth requests never touch the cache", () => {
  // A cached session or CSRF response would leak one account's sign-in into the
  // next launch on a shared phone.
  expect(classify(get("/api/auth/session"), ORIGIN)).toBe("passthrough");
  expect(classify(get("/api/auth/csrf"), ORIGIN)).toBe("passthrough");
});

test("a write is passed straight through", () => {
  // Answering a mutation from a cache would report a save that never reached the
  // server. Offline writes are refused in the UI instead (D8).
  expect(classify({ method: "POST", url: `${ORIGIN}/boards/abc` }, ORIGIN)).toBe("passthrough");
  expect(classify({ method: "DELETE", url: `${ORIGIN}/api/boards/abc` }, ORIGIN)).toBe(
    "passthrough",
  );
});

test("another origin's requests are left alone", () => {
  expect(classify({ method: "GET", url: "https://cdn.example/x.js" }, ORIGIN)).toBe(
    "passthrough",
  );
});

test("build output and icons are served cache-first", () => {
  // Content-hashed and versioned by the cache name, so there's nothing to go stale.
  expect(classify(get("/_next/static/chunks/main-9f8.js"), ORIGIN)).toBe("asset");
  expect(classify(get("/icons/icon-512.png"), ORIGIN)).toBe("asset");
  expect(classify(get("/manifest.webmanifest"), ORIGIN)).toBe("asset");
});

// ---------------------------------------------------------------------------
// What the worker actually answers with (ticket 18)
// ---------------------------------------------------------------------------

test("a reachable server answers the poll itself, unmarked", async () => {
  // Nothing in the app should have to wonder whether a poll was real: a response
  // with no marker on it is one the server gave us.
  const site = server({ "/api/boards/abc/version": () => live({ version: "7" }) });
  const worker = startWorker(site.network);

  const response = await worker.respondTo(get(VERSION_PATH));

  expect(await response.json()).toEqual({ version: "7" });
  expect(response.headers.get(CACHED_RESPONSE_HEADER)).toBe(null);
});

test("with the server gone the last answer is still served, so an offline launch has data", async () => {
  const site = server({ "/api/boards/abc": () => live({ version: "7", cards: [] }) });
  const worker = startWorker(site.network);
  await worker.respondTo(get(BOARD_PATH));

  site.goDown();
  const response = await worker.respondTo(get(BOARD_PATH));

  // Readable — the point of caching it at all.
  expect(await response.json()).toEqual({ version: "7", cards: [] });
});

test("but every cached answer is marked, so a failed poll can't pass for a live one", async () => {
  // The failure this ticket exists for: the browser says it is online, the server
  // is unreachable, and the poll comes back 200 with a token that hasn't moved
  // since it was cached. Marked, the query layer sees the failure and the board
  // says "Not syncing" (ticket 18); unmarked, it looks current forever.
  const site = server({ "/api/boards/abc/version": () => live({ version: "7" }) });
  const worker = startWorker(site.network);
  await worker.respondTo(get(VERSION_PATH));

  site.goDown();
  const response = await worker.respondTo(get(VERSION_PATH));

  expect(response.headers.get(CACHED_RESPONSE_HEADER)).toBe("1");
});

test("a failed read with nothing cached stays a failure", async () => {
  const site = server({ "/api/boards/abc/version": () => live({ version: "7" }) });
  const worker = startWorker(site.network);

  site.goDown();

  await expect(worker.respondTo(get(VERSION_PATH))).rejects.toThrow();
});

test("a reachable server takes over again, and its answer is unmarked", async () => {
  // Reconnecting has to be enough on its own: nothing clears a stale marker but
  // the server answering for itself.
  let version = "7";
  const site = server({ "/api/boards/abc/version": () => live({ version }) });
  const worker = startWorker(site.network);
  await worker.respondTo(get(VERSION_PATH));

  site.goDown();
  await worker.respondTo(get(VERSION_PATH));

  site.comeBack();
  version = "8";
  const response = await worker.respondTo(get(VERSION_PATH));

  expect(await response.json()).toEqual({ version: "8" });
  expect(response.headers.get(CACHED_RESPONSE_HEADER)).toBe(null);
});

test("a page load that fails opens the cached page rather than a browser error", async () => {
  const site = server({ "/boards/abc": () => page("<html>the board</html>") });
  const worker = startWorker(site.network);
  await worker.respondTo(get(PAGE_PATH, "navigate"));

  site.goDown();
  const response = await worker.respondTo(get(PAGE_PATH, "navigate"));

  // The app opens, and says so: this document did not come from the server.
  expect(await response.text()).toBe("<html>the board</html>");
  expect(response.headers.get(CACHED_RESPONSE_HEADER)).toBe("1");
});

test("a page that was never opened falls back to the offline page", async () => {
  const site = server({
    "/offline": () => page("<html>offline</html>"),
    "/manifest.webmanifest": () => live({ name: "Kanban" }),
  });
  const worker = startWorker(site.network);
  await worker.install();

  site.goDown();
  const response = await worker.respondTo(get("/boards/never-seen", "navigate"));

  expect(await response.text()).toBe("<html>offline</html>");
});
