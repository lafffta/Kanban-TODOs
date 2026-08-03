import { expect, test } from "vitest";
import {
  clearDevice,
  lastBoardArea,
  persistedQueriesArea,
  releaseDevice,
  signOutOnceCleared,
  workerCachesArea,
  type Clearable,
} from "./device-clearing";

// Ticket 19: signing out has to actually empty the device, and has to know whether
// it did. Everything here turns on one rule — an attempt is not a result. Storage
// that refused, a tab that wrote back, a delete another tab is blocking and an area
// that can't even be inspected all look identical from the call that asked for the
// clearing, and every one of them leaves the previous account's boards readable by
// killing the network and relaunching. So each area is *read back* after it's
// cleared, and anything that can't be proven gone is reported to the caller, which
// keeps the session alive rather than signing out over the top of it.

/** Never waits: the retry pause is real in the browser, pointless in a test. */
const immediately = { pause: () => Promise.resolve() };

/**
 * An area holding `contents`, with a `clear` that empties it — plus counters, so a
 * test can tell "it worked" from "it was asked more than once".
 */
function area(name: string, options: { survives?: boolean; refuses?: boolean } = {}) {
  const state = { populated: true, clears: 0 };
  return {
    name,
    state,
    async clear() {
      state.clears += 1;
      if (options.refuses) throw new Error(`${name} refused`);
      if (!options.survives) state.populated = false;
    },
    async remains() {
      return state.populated;
    },
  } satisfies Clearable & { state: typeof state };
}

test("a device with nothing left on it lets the sign-out through", async () => {
  const areas = [area("cached boards"), area("cached pages"), area("last board")];

  expect(await clearDevice(areas, immediately)).toEqual({ cleared: true });
  expect(areas.map((a) => a.state.clears)).toEqual([1, 1, 1]);
});

test("what survived is named, so the sign-out can say what it couldn't clear", async () => {
  const areas = [area("cached boards"), area("cached pages", { survives: true })];

  expect(await clearDevice(areas, immediately)).toEqual({
    cleared: false,
    remaining: ["cached pages"],
  });
});

test("storage that refuses is a failure, not a shrug", async () => {
  // The old sign-out swallowed exactly this: a delete that errored resolved the
  // same as one that worked, and the boards stayed on the phone.
  expect(await clearDevice([area("cached boards", { refuses: true })], immediately)).toEqual({
    cleared: false,
    remaining: ["cached boards"],
  });
});

test("one area refusing doesn't leave the others on the device", async () => {
  const stubborn = area("cached pages", { refuses: true });
  const rest = [area("cached boards"), area("last board")];

  expect(await clearDevice([rest[0], stubborn, rest[1]], immediately)).toEqual({
    cleared: false,
    remaining: ["cached pages"],
  });
  // As much as possible is gone: a device that can't be fully cleared is still
  // better off without the parts that could be.
  expect(rest.every((a) => !a.state.populated)).toBe(true);
});

test("an area written back by another tab is cleared again rather than reported", async () => {
  // The case this exists for: a second tab's query cache flushes to IndexedDB
  // moments after the first tab emptied it. The write lands, the read-back sees
  // it, and the retry takes it away once that tab has stopped.
  const cache = area("cached boards");
  let refilled = false;
  const written: Clearable = {
    ...cache,
    async clear() {
      await cache.clear();
      if (!refilled) {
        refilled = true;
        cache.state.populated = true;
      }
    },
  };

  expect(await clearDevice([written], immediately)).toEqual({ cleared: true });
  expect(cache.state.clears).toBe(2);
});

test("an area that can't be inspected counts as still holding data", async () => {
  // Not being able to look is not the same as there being nothing there, and only
  // one of those two readings is safe on a shared device.
  const blind: Clearable = {
    name: "cached boards",
    clear: async () => {},
    remains: async () => {
      throw new Error("storage unavailable");
    },
  };

  expect(await clearDevice([blind], immediately)).toEqual({
    cleared: false,
    remaining: ["cached boards"],
  });
});

test("a device that keeps refilling is reported instead of retried forever", async () => {
  const relentless = area("cached boards", { survives: true });

  expect(await clearDevice([relentless], { ...immediately, attempts: 3 })).toEqual({
    cleared: false,
    remaining: ["cached boards"],
  });
  expect(relentless.state.clears).toBe(3);
});

// ---------------------------------------------------------------------------
// Letting go, and what it gates
// ---------------------------------------------------------------------------

test("nothing is holding the device by the time it's emptied", async () => {
  // The order is the guarantee. Clear storage while this tab's cache is still live
  // and still persisting — or while another tab's is — and the device is empty
  // only until the next poll settles.
  const done: string[] = [];
  const watched = (name: string) => ({
    name,
    clear: async () => void done.push(`cleared ${name}`),
    remains: async () => false,
  });

  await releaseDevice(
    {
      announce: () => done.push("announced"),
      stopPersisting: () => done.push("stopped persisting"),
      dropMemory: () => done.push("dropped memory"),
      areas: [watched("cached boards")],
    },
    immediately,
  );

  expect(done).toEqual([
    "announced",
    "stopped persisting",
    "dropped memory",
    "cleared cached boards",
  ]);
});

test("the session is dropped only once the device is empty", async () => {
  let signedOut = 0;

  expect(await signOutOnceCleared(async () => ({ cleared: true }), async () => void signedOut++))
    .toBeNull();
  expect(signedOut).toBe(1);
});

test("a device that still holds boards keeps the user signed in", async () => {
  // Signing out anyway would be the worst outcome available: it looks like the
  // data is gone, and the next person on the device is who finds out it isn't.
  let signedOut = 0;
  const remaining = await signOutOnceCleared(
    async () => ({ cleared: false, remaining: ["cached boards"] }),
    async () => void signedOut++,
  );

  expect(remaining).toEqual(["cached boards"]);
  expect(signedOut).toBe(0);
});

// ---------------------------------------------------------------------------
// The areas themselves
// ---------------------------------------------------------------------------

/** A `Storage` stand-in, as in `last-board.test.ts`. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

/** Enough of `CacheStorage` to sweep, keyed by name. */
function fakeCaches(names: string[]) {
  const open = new Set(names);
  return {
    names: open,
    keys: async () => [...open],
    delete: async (name: string) => open.delete(name),
  };
}

test("the last-board note is gone, and is read back to prove it", async () => {
  const storage = fakeStorage({ "kanban:last-board": '{"id":"b1","name":"Roadmap"}' });
  const note = lastBoardArea(storage);

  expect(await note.remains()).toBe(true);
  await note.clear();
  expect(await note.remains()).toBe(false);
});

test("a storage that silently keeps the note leaves it reported", async () => {
  // Some browsers accept a write and discard it; a `removeItem` that returns
  // without removing anything must not read as a cleared device.
  const stuck = { ...fakeStorage({ "kanban:last-board": '{"id":"b1"}' }), removeItem: () => {} };

  expect(await clearDevice([lastBoardArea(stuck)], immediately)).toEqual({
    cleared: false,
    remaining: [lastBoardArea(stuck).name],
  });
});

test("the persisted query cache is emptied and read back, not deleted and hoped for", async () => {
  // Emptying the store is a transaction, which queues behind other tabs' work;
  // deleting the *database* is blocked outright while another tab holds it open —
  // and a blocked delete never fires an error, so waiting on it either hangs the
  // sign-out or (as it did) reports a success that didn't happen.
  let stored: unknown = { clientState: { queries: [{ queryKey: ["board", "b1"] }], mutations: [] } };
  const cache = persistedQueriesArea({
    read: async () => stored as never,
    clear: async () => void (stored = undefined),
  });

  expect(await cache.remains()).toBe(true);
  await cache.clear();
  expect(await cache.remains()).toBe(false);
});

test("an empty snapshot is nothing to restore", async () => {
  // A persister flush that lands after the clearing writes an empty client. There
  // is no board in it, so it isn't grounds for refusing the sign-out.
  const cache = persistedQueriesArea({
    read: async () => ({ clientState: { queries: [], mutations: [] } }) as never,
    clear: async () => {},
  });

  expect(await cache.remains()).toBe(false);
});

test("the pages and API responses cached for the signed-in user are swept", async () => {
  const caches = fakeCaches([
    "kanban-pages-v1",
    "kanban-data-v1",
    "kanban-shell-v1",
    "workbox-precache",
  ]);

  const swept = workerCachesArea(caches);
  expect(await swept.remains()).toBe(true);
  await swept.clear();
  expect(await swept.remains()).toBe(false);

  // The shell is the same for everyone — dropping it would only mean the next
  // person's first launch has no offline page. Another origin's caches aren't ours.
  expect([...caches.names]).toEqual(["kanban-shell-v1", "workbox-precache"]);
});

test("a browser with no Cache Storage has no cached pages to answer for", async () => {
  // Cache Storage needs a secure context, and so does the worker that fills it: if
  // there's no `caches` here, nothing was ever cached to be restored.
  const swept = workerCachesArea(null);

  expect(await swept.remains()).toBe(false);
  expect(await clearDevice([swept], immediately)).toEqual({ cleared: true });
});

test("a cache that refuses to be deleted is not reported as cleared", async () => {
  const caches = fakeCaches(["kanban-pages-v1"]);
  const hostile = { keys: caches.keys, delete: async () => false };

  expect(await clearDevice([workerCachesArea(hostile)], immediately)).toEqual({
    cleared: false,
    remaining: [workerCachesArea(hostile).name],
  });
});
