import type { PersistedCacheStore } from "./query-persistence";
import { forgetLastBoard, peekLastBoardNote, type StorageLike } from "./last-board";

/**
 * What signing out has to take off the device, and how it knows that it did
 * (ticket 19).
 *
 * The offline work (D8) is the reason this file exists: an installed app opens
 * with no network, which means one account's boards are sitting on the phone in
 * three places — the persisted query cache, the pages and API responses the
 * service worker kept, and the note saying which board to open. Sign-out that
 * leaves any of them behind hands the next person on a shared device a readable
 * copy: turn the network off, launch the app, and the board is there.
 *
 * The rule this is built around: **an attempt is not a result.** Every way the
 * clearing can fail looks the same from the call that asked for it — storage that
 * refused, an IndexedDB delete another tab is blocking (which never errors, it
 * just never happens), a worker that never answers, a second tab flushing its
 * cache back a moment later. So nothing here trusts the operation it just ran.
 * Each area is read back afterwards, and an area that can't be proven empty —
 * including one that can't be inspected at all — is reported to the caller by
 * name. `SignOutButton` keeps the session alive when that happens, because a
 * sign-out that leaves the data behind is worse than one that visibly didn't
 * finish.
 */

/** One thing on the device that must be gone before a sign-out may complete. */
export type Clearable = {
  /** How it's named to the user if it survives. */
  name: string;
  /** Take it away. May throw — the result is read back either way. */
  clear(): Promise<void>;
  /** Whether anything restorable is still there. The proof, not the attempt. */
  remains(): Promise<boolean>;
};

/** Either the device is empty, or these are the parts of it that aren't. */
export type ClearOutcome = { cleared: true } | { cleared: false; remaining: string[] };

/**
 * How many times an area is emptied before its contents are called permanent.
 *
 * More than one because of the failures that aren't permanent — all of them
 * writes already in flight when the clearing started. Another tab's persister
 * flushing the query cache back; the service worker filing the response to a poll
 * that was issued a moment before its tab was told to stop. Both have been told
 * (see `announceSignOut`), and the retries are the time they're given to act on
 * it. The pauses widen so the total window is most of a second, which is long
 * enough for a request that was already on the wire to land.
 */
export const CLEAR_ATTEMPTS = 4;

/** Grows with each attempt: 100ms, 200ms, 300ms. */
const RETRY_PAUSE_MS = 100;

type ClearOptions = {
  /** Injected so tests don't wait; the browser gets a real pause. */
  pause?: (attempt: number) => Promise<void>;
};

/**
 * Empty every area, then report which — if any — still holds something.
 *
 * Areas are independent: one that refuses must not leave the others populated,
 * since a device that can't be fully cleared is still better off without the parts
 * that could be.
 */
export async function clearDevice(
  areas: readonly Clearable[],
  options: ClearOptions = {},
): Promise<ClearOutcome> {
  const pause = options.pause ?? ((attempt) => sleep(attempt * RETRY_PAUSE_MS));

  const survivors = await Promise.all(
    areas.map(async (area) => ((await emptied(area, pause)) ? null : area.name)),
  );

  const remaining = survivors.filter((name): name is string => name !== null);
  return remaining.length === 0 ? { cleared: true } : { cleared: false, remaining };
}

/** What a sign-out has to let go of, in the order it has to let go of it. */
export type Release = {
  /** Tell the other tabs to stop holding this account's data. */
  announce: () => void;
  /** Stop this document writing the cache back, and drop what it holds in memory. */
  letGo: () => void;
  areas: readonly Clearable[];
};

/**
 * Let go of the device, and say whether it's empty.
 *
 * The order is the whole point, and it is why this is a function rather than three
 * calls at the call site. Announcing comes first, so the other tabs have stopped
 * writing before there's anything to undo. This document lets go of its own copy
 * next, because a live cache is one settled poll away from being back on disk —
 * clearing storage underneath one only empties the device for as long as it takes
 * a query to finish. Emptying the device itself and reading it back is last, once
 * nothing is left that could refill it.
 */
export async function releaseDevice(
  release: Release,
  options: ClearOptions = {},
): Promise<ClearOutcome> {
  release.announce();
  release.letGo();
  return clearDevice(release.areas, options);
}

/**
 * Drop the session only once the device is empty.
 *
 * The inversion ticket 19 is about: signing out over a device that still holds the
 * boards is worse than a sign-out that visibly didn't finish, because it *looks*
 * like the data is gone and the person who finds out otherwise is whoever picks
 * the phone up next. So what survived is returned instead, for the caller to say
 * out loud; the session stays up.
 */
export async function signOutOnceCleared(
  clear: () => Promise<ClearOutcome>,
  signOut: () => Promise<void>,
): Promise<string[] | null> {
  const outcome = await clear();
  if (!outcome.cleared) return outcome.remaining;
  await signOut();
  return null;
}

/** Clear an area until reading it back shows nothing, or until we run out of tries. */
async function emptied(
  area: Clearable,
  pause: (attempt: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 1; attempt <= CLEAR_ATTEMPTS; attempt += 1) {
    try {
      await area.clear();
    } catch {
      // Deliberately not fatal: the read-back below decides. A delete can throw
      // because there was nothing there to delete.
    }

    try {
      if (!(await area.remains())) return true;
    } catch {
      // Storage that can't be inspected is not storage that is known to be empty,
      // and only one of those two readings is safe on a shared device.
      return false;
    }

    if (attempt < CLEAR_ATTEMPTS) await pause(attempt);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// The three areas
// ---------------------------------------------------------------------------

/**
 * The board payloads the device can open offline.
 *
 * Emptied by clearing the object store rather than by deleting the database.
 * `deleteDatabase` is blocked outright while any other tab holds a connection, and
 * a blocked delete neither errors nor completes — waiting on it hangs the sign-out,
 * and not waiting on it (what this used to do) reports a success that never
 * happened. A `readwrite` transaction has no such failure mode: it queues behind
 * the other tab's work and then runs. An empty database left behind holds nothing
 * to restore, which is the whole of what's being promised.
 */
export function persistedQueriesArea(
  store: Pick<PersistedCacheStore, "read" | "clear">,
): Clearable {
  return {
    name: "saved boards",
    clear: () => store.clear(),
    async remains() {
      const client = await store.read();
      const state = client?.clientState;
      // A flush that lands after the clearing writes an empty client; that is a
      // snapshot of nothing and not grounds for refusing the sign-out.
      return Boolean(state && (state.queries.length > 0 || state.mutations.length > 0));
    },
  };
}

/**
 * The note an offline launch follows back to the last board seen.
 *
 * The read-back is the raw key, not `readLastBoard`: that one answers "is there a
 * board to open", swallowing a storage that refuses so a launch can carry on
 * without the shortcut. Here the question is the opposite one — "is there anything
 * left" — and a storage that won't answer it has not answered "no". Whatever is
 * still under the key is also something `clear` failed to remove, parseable or not.
 */
export function lastBoardArea(storage: StorageLike): Clearable {
  return {
    name: "the last board you opened",
    async clear() {
      forgetLastBoard(storage);
    },
    async remains() {
      return peekLastBoardNote(storage) !== null;
    },
  };
}

/**
 * The pages and API responses the service worker cached while signed in.
 *
 * Swept from the page, not by asking the worker to do it. Cache Storage is the
 * same storage from both sides, and doing it here is the difference between a
 * result and a hope: `caches.delete` answers, and the sweep can be read back,
 * whereas a `postMessage` to a worker that is missing, still installing or wedged
 * has no answer at all — which is why the old version gave up after a second and
 * called it done.
 *
 * The shell cache survives. It holds the offline page, the icons and the build
 * output — identical for every account, and dropping it would only mean the next
 * person's first launch has nothing to open.
 *
 * Which caches those are is `public/sw.js`'s to say, and it ships as a plain
 * script that can't share a constant with this file. So the names are matched by
 * the prefixes the worker builds them from, and the test reads them back out of
 * the worker's own source — rename a cache there and this stops sweeping it,
 * silently, which is a leak rather than a bug you'd notice.
 */
export function workerCachesArea(caches: CacheStorageLike | null): Clearable {
  const ours = (name: string) => name.startsWith("kanban-") && !name.startsWith("kanban-shell-");

  return {
    name: "saved pages",
    async clear() {
      // A browser with no Cache Storage also has no service worker — both need a
      // secure context — so there is nothing here that was ever cached.
      if (!caches) return;
      const names = await caches.keys();
      await Promise.all(names.filter(ours).map((name) => caches.delete(name)));
    },
    async remains() {
      if (!caches) return false;
      return (await caches.keys()).some(ours);
    },
  };
}

/** The part of `CacheStorage` the sweep uses — the real one satisfies it. */
export type CacheStorageLike = {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};
