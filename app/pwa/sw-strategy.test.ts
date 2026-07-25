import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The rule the offline app rests on (D8): which requests the service worker may
// answer from a cache, and which must always reach the network. Getting this wrong
// is not a cosmetic bug — caching a sign-in response would hand one account's
// session to the next, and caching a write would "succeed" a mutation that never
// happened.
//
// `public/sw.js` ships as a plain script the browser runs, so it can't be imported
// here. Its source is evaluated against a stub `self` — the top level only
// registers listeners — and the pure classifier it defines is exercised directly.

type Strategy = "passthrough" | "navigation" | "data" | "asset";
type RequestLike = { method: string; url: string; mode?: string };

const ORIGIN = "https://kanban.example";

function loadClassifier(): (request: RequestLike, origin: string) => Strategy {
  const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  const stub = { addEventListener() {}, location: { origin: ORIGIN } };
  return new Function("self", `${source}\nreturn classifyRequest;`)(stub);
}

const classify = loadClassifier();

/** A same-origin GET for `path`, as the browser would issue it. */
function get(path: string, mode = "cors"): RequestLike {
  return { method: "GET", url: `${ORIGIN}${path}`, mode };
}

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
