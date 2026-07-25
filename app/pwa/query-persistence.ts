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

/** The database holding the dehydrated cache. Deleted on sign-out. */
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
  state: { status: string; data: unknown };
};

/** Query keys whose data may be stored on the device — see `boardKeys`. */
const PERSISTED_KEY_ROOTS = ["board", "comments"];

/**
 * Whether a cached read is written to IndexedDB.
 *
 * Persistence is opt-in by key root, so a query added later isn't silently stored
 * on someone's phone, and only settled reads that actually carry data qualify — a
 * failure must never be restored as though it were the board.
 */
export function shouldPersistQuery(query: PersistableQuery): boolean {
  if (query.state.status !== "success" || query.state.data === undefined) return false;
  const root = query.queryKey[0];
  return typeof root === "string" && PERSISTED_KEY_ROOTS.includes(root);
}

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
 * The persister TanStack Query drives: it reads once on mount and writes after
 * every settled change.
 *
 * Every operation swallows its own failure. IndexedDB is unavailable in a private
 * window on some browsers and can be evicted under storage pressure at any moment;
 * none of that is worth failing a render over, since the consequence is only that
 * this launch has no offline copy.
 */
export function createIndexedDbPersister(): Persister {
  return {
    async persistClient(client: PersistedClient) {
      try {
        await withStore("readwrite", (store) => store.put(client, ENTRY_KEY));
      } catch {
        // Storage refused or full — this change just isn't available offline.
      }
    },
    async restoreClient() {
      try {
        return await withStore<PersistedClient | undefined>("readonly", (store) =>
          store.get(ENTRY_KEY),
        );
      } catch {
        return undefined;
      }
    },
    async removeClient() {
      try {
        await withStore("readwrite", (store) => store.delete(ENTRY_KEY));
      } catch {
        // Nothing to remove, or nowhere to remove it from.
      }
    },
  };
}

/**
 * Drop the whole persisted cache. Called on sign-out: the boards it holds belong
 * to whoever was signed in, and on a shared device the next person must not be
 * able to open the app offline and read them.
 */
export function deletePersistedQueries(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(QUERY_CACHE_DB);
      // Resolve either way: a blocked delete (another tab still has it open) is
      // not something the sign-out should wait on.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
