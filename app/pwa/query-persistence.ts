import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/**
 * The other half of offline (D8): the service worker answers for the app shell,
 * this keeps the *board* on the device. The query cache is written to IndexedDB
 * after every change and restored before the first render, so an installed app
 * launched with no network opens on the board it last saw — clearly stale, and
 * read-only, because writes are refused while offline (`useOnline`).
 *
 * IndexedDB rather than `localStorage`: a board payload is easily past the ~5MB
 * string budget, and the write is off the main thread.
 */

/** The database holding the dehydrated cache. Emptied on sign-out (ticket 19). */
export const QUERY_CACHE_DB = "kanban-query-cache";
const STORE_NAME = "cache";
const ENTRY_KEY = "client";

/**
 * How stale a restored cache may be. A day-old board is still worth opening to —
 * it's labelled offline and can't be edited — but a fortnight-old one is more
 * misleading than useful, and past this the app opens empty instead.
 */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Bump when the persisted shape changes. A cache written by an older build is
 * discarded rather than hydrated into components that no longer understand it.
 */
export const PERSIST_BUSTER = "board-v1";

/** A cache entry, shaped the way TanStack Query hands it to the dehydrate filter. */
type PersistableQuery = {
  queryKey: readonly unknown[];
  /** `status` is the *last fetch's* outcome — deliberately not consulted below. */
  state: { status: string; data: unknown };
};

/** Query keys whose data may be stored on the device — see `boardKeys`. */
const PERSISTED_KEY_ROOTS = ["board", "comments"];

/**
 * Whether a cached read is written to IndexedDB.
 *
 * Persistence is opt-in by key root, so a query added later isn't silently stored
 * on someone's phone, and only reads that actually carry data qualify — a failure
 * must never be restored as though it were the board.
 *
 * The test is the data, not the *last* fetch's outcome. A query holds the payload
 * it last read successfully even while a newer fetch is failing, and that payload
 * is precisely what an offline launch needs. Keying on `status` instead would
 * delete the device's copy at the worst possible moment: the whole snapshot is
 * rewritten on every cache change, so a board unreachable for a few polls — which
 * is now an error rather than a cached 200 (ticket 18) — would drop out of storage
 * while the outage was still going on.
 */
export function shouldPersistQuery(query: PersistableQuery): boolean {
  if (query.state.data === undefined) return false;
  const root = query.queryKey[0];
  return typeof root === "string" && PERSISTED_KEY_ROOTS.includes(root);
}

/**
 * The device-side store the persisted cache lives in — the only part of this that
 * needs a browser, and so the seam everything else is written against.
 *
 * Unlike the persister built on top of it, these operations *report*: sign-out has
 * to know whether the board data is really gone (ticket 19), and a store that
 * swallowed its own failures could only ever say "yes".
 */
export type PersistedCacheStore = {
  read(): Promise<PersistedClient | undefined>;
  write(client: PersistedClient): Promise<void>;
  /** Empty the store, throwing if it couldn't be emptied. */
  clear(): Promise<void>;
};

/** Open (or create) the cache database. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUERY_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run one transaction against the cache store, resolving with its result. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/**
 * The real store, on IndexedDB.
 *
 * Every call opens and closes its own connection. That looks wasteful and is the
 * point: a connection held open blocks other tabs, and sign-out's clearing has to
 * be able to run while several tabs are still up.
 */
export function indexedDbCacheStore(): PersistedCacheStore {
  // A browser with no IndexedDB — or a server render, where this is evaluated
  // too — never stored a board here, so there is nothing to read back and nothing
  // to clear. That is not the same as a store that *errors*, which sign-out has to
  // report: this one can be proven empty, because it was never written to.
  if (typeof indexedDB === "undefined") {
    return { read: async () => undefined, write: async () => {}, clear: async () => {} };
  }

  return {
    read: () =>
      withStore<PersistedClient | undefined>("readonly", (store) => store.get(ENTRY_KEY)),
    write: async (client) => {
      await withStore("readwrite", (store) => store.put(client, ENTRY_KEY));
    },
    clear: async () => {
      await withStore("readwrite", (store) => store.clear());
    },
  };
}

/**
 * A persister that can be switched off — see `stop`.
 */
export type StoppablePersister = Persister & { stop(): void };

/**
 * The persister TanStack Query drives: it reads once on mount and writes after
 * every settled change.
 *
 * Every operation swallows its own failure. IndexedDB is unavailable in a private
 * window on some browsers and can be evicted under storage pressure at any moment;
 * none of that is worth failing a render over, since the consequence is only that
 * this launch has no offline copy.
 *
 * `stop()` makes it inert, permanently. Sign-out calls it before it starts
 * clearing, because this is the thing that would undo the clearing: the whole
 * cache is rewritten after every change, so a query settling — or a component
 * unmounting — while the device is being emptied would put the board straight
 * back on it. There is no restart, since the only reason to stop is that this
 * document's session is ending.
 */
export function createPersister(store: PersistedCacheStore): StoppablePersister {
  let stopped = false;

  return {
    stop() {
      stopped = true;
    },
    async persistClient(client: PersistedClient) {
      if (stopped) return;
      try {
        await store.write(client);
      } catch {
        // Storage refused or full — this change just isn't available offline.
      }
    },
    async restoreClient() {
      if (stopped) return undefined;
      try {
        return await store.read();
      } catch {
        return undefined;
      }
    },
    async removeClient() {
      try {
        await store.clear();
      } catch {
        // Nothing to remove, or nowhere to remove it from.
      }
    },
  };
}
