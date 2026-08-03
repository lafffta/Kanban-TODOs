import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { expect, test } from "vitest";
import {
  createPersister,
  indexedDbCacheStore,
  shouldPersistQuery,
  type PersistedCacheStore,
} from "./query-persistence";

// What gets written to the device (D8). The persisted cache is what an offline
// launch opens the board from, so the rule has to be exact in both directions: too
// little and the app opens empty, too much and a failed read is stored as though
// it were the board.

/** A cache entry shaped the way TanStack Query hands it to the dehydrate filter. */
function query(queryKey: readonly unknown[], data: unknown, status = "success") {
  return { queryKey, state: { status, data } };
}

const board = { board: { id: "b1" }, columns: [], cards: [], members: [], version: "7" };

test("a successful board read is persisted — it's what an offline launch opens", () => {
  expect(shouldPersistQuery(query(["board", "b1"], board))).toBe(true);
});

test("a card's thread is persisted, so an offline card still shows its discussion", () => {
  expect(shouldPersistQuery(query(["comments", "c1"], []))).toBe(true);
});

test("the board's version token is persisted alongside the payload it describes", () => {
  // Restored together they agree, so a reconnect refetches on the first token that
  // actually moved rather than immediately on the first poll.
  expect(shouldPersistQuery(query(["board", "b1", "version"], "7"))).toBe(true);
});

test("a read that has never produced data is never persisted", () => {
  // Otherwise the board a user is shown offline is whatever their connection was
  // already failing to load.
  expect(shouldPersistQuery(query(["board", "b1"], undefined, "error"))).toBe(false);
  expect(shouldPersistQuery(query(["board", "b1"], undefined, "pending"))).toBe(false);
});

test("a board whose latest refresh failed keeps the copy it already had", () => {
  // The regression this guards: the persisted snapshot is rewritten on every cache
  // change, so dropping a query whose *latest* fetch failed would delete the
  // device's offline copy during the very outage it exists for — and since a poll
  // the service worker answered from its cache is now an error rather than a
  // cached 200 (ticket 18), that outage is exactly when it would happen.
  expect(shouldPersistQuery(query(["board", "b1"], board, "error"))).toBe(true);
});

// ---------------------------------------------------------------------------
// Switching the writing off (ticket 19)
// ---------------------------------------------------------------------------

/** The device-side store, in memory. */
function fakeStore() {
  const state: { client: PersistedClient | undefined; writes: number } = {
    client: undefined,
    writes: 0,
  };
  const store: PersistedCacheStore = {
    read: async () => state.client,
    write: async (client) => {
      state.writes += 1;
      state.client = client;
    },
    clear: async () => void (state.client = undefined),
  };
  return { store, state };
}

const snapshot = { timestamp: 0, buster: "board-v1", clientState: {} } as unknown as PersistedClient;

test("a stopped persister writes nothing more to the device", async () => {
  // The race sign-out would otherwise lose: the whole cache is rewritten after
  // every change, so one query settling — or one component unmounting — while the
  // device is being emptied puts the boards straight back onto it.
  const { store, state } = fakeStore();
  const persister = createPersister(store);

  await persister.persistClient(snapshot);
  expect(state.writes).toBe(1);

  persister.stop();
  await persister.persistClient(snapshot);
  await persister.persistClient(snapshot);
  expect(state.writes).toBe(1);
});

test("a stopped persister has nothing to restore either", async () => {
  const { store } = fakeStore();
  await store.write(snapshot);
  const persister = createPersister(store);

  expect(await persister.restoreClient()).toEqual(snapshot);
  persister.stop();
  expect(await persister.restoreClient()).toBeUndefined();
});

test("a browser with no IndexedDB has no persisted cache to clear", async () => {
  // Node stands in for one: there's no `indexedDB` here either. It matters because
  // sign-out refuses to complete over a store it can't prove is empty, and a store
  // that was never writable holds nothing — signing out of a private window must
  // not be impossible.
  const store = indexedDbCacheStore();

  await expect(store.write(snapshot)).resolves.toBeUndefined();
  await expect(store.read()).resolves.toBeUndefined();
  await expect(store.clear()).resolves.toBeUndefined();
});

test("a store that refuses doesn't take the render down with it", async () => {
  // Unlike the sign-out clearing, which has to report its failures, the persister
  // swallows its own: IndexedDB is unavailable in some private windows and can be
  // evicted at any moment, and the cost of that is only that this launch has no
  // offline copy.
  const hostile: PersistedCacheStore = {
    read: async () => {
      throw new Error("denied");
    },
    write: async () => {
      throw new Error("denied");
    },
    clear: async () => {
      throw new Error("denied");
    },
  };
  const persister = createPersister(hostile);

  await expect(persister.persistClient(snapshot)).resolves.toBeUndefined();
  await expect(persister.restoreClient()).resolves.toBeUndefined();
  await expect(persister.removeClient()).resolves.toBeUndefined();
});

test("only board-scoped reads are stored on the device", () => {
  // Persistence is opt-in by key: a future query is not quietly written to a
  // user's phone because it happened to be in the cache.
  expect(shouldPersistQuery(query(["boards"], [{ id: "b1" }]))).toBe(false);
  expect(shouldPersistQuery(query(["session"], { email: "a@b.c" }))).toBe(false);
  expect(shouldPersistQuery(query([], 1))).toBe(false);
});
