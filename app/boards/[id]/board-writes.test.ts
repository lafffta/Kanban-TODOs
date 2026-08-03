import { expect, test } from "vitest";
import type { QueryKey } from "@tanstack/react-query";
import { createReconciler } from "./reconciler";
import { runBoardWrite, WRITE_FAILED, type WriteCache } from "./board-writes";

// The rule this file pins down: the screen may only show what actually happened.
// A write that ends any way other than success — thrown, or *resolved* with the
// friendly `{ error }` a server action refuses with — puts every query it touched
// back exactly as it found it, without waiting for a poll to repair the board.

const BOARD_KEY: QueryKey = ["board", "b1"];
const COMMENTS_KEY: QueryKey = ["board", "b1", "comments", "c1"];

/** A cache that records what the protocol asked of it, keyed like the real one. */
function fakeCache(initial: Record<string, unknown> = {}) {
  const held = new Map<string, unknown>(Object.entries(initial));
  const cancelled: string[] = [];
  const invalidated: string[] = [];

  const cache: WriteCache = {
    cancel: async (queryKey) => {
      cancelled.push(JSON.stringify(queryKey));
    },
    read: (queryKey) => held.get(JSON.stringify(queryKey)),
    write: (queryKey, data) => {
      held.set(JSON.stringify(queryKey), data);
    },
    update: (queryKey, updater) => {
      const key = JSON.stringify(queryKey);
      held.set(key, updater(held.get(key)));
    },
    invalidate: (queryKey) => {
      invalidated.push(JSON.stringify(queryKey));
    },
  };

  return {
    cache,
    cancelled,
    invalidated,
    at: (queryKey: QueryKey) => held.get(JSON.stringify(queryKey)),
  };
}

/** The board half of a comment write: the "💬 N" badge on the card face. */
function countPatch(delta: number) {
  return {
    queryKey: BOARD_KEY,
    update: (previous: unknown) => ({ count: (previous as { count: number }).count + delta }),
  };
}

/** The thread half: the comment bodies in the open card sheet. */
function threadPatch(update: (comments: string[]) => string[]) {
  return {
    queryKey: COMMENTS_KEY,
    update: (previous: unknown) => update(previous as string[]),
  };
}

function deps(cache: WriteCache) {
  return { cache, reconciler: createReconciler(), boardKey: BOARD_KEY };
}

test("a resolved refusal rolls every patch back and keeps the action's own message", async () => {
  const store = fakeCache({
    [JSON.stringify(BOARD_KEY)]: { count: 3 },
    [JSON.stringify(COMMENTS_KEY)]: ["hello", "stale"],
  });

  // Deleting a comment someone else already deleted: the action doesn't throw,
  // it answers politely — and that answer is still a failed mutation.
  const result = await runBoardWrite(deps(store.cache), {
    patches: [
      threadPatch((comments) => comments.filter((body) => body !== "stale")),
      countPatch(-1),
    ],
    action: async () => ({ error: "That comment is already gone." }),
  });

  expect(result).toEqual({ error: "That comment is already gone." });
  expect(store.at(COMMENTS_KEY)).toEqual(["hello", "stale"]);
  expect(store.at(BOARD_KEY)).toEqual({ count: 3 });
});

test("a thrown failure rolls back too, under the generic message", async () => {
  const store = fakeCache({ [JSON.stringify(BOARD_KEY)]: { count: 1 } });

  const result = await runBoardWrite(deps(store.cache), {
    patches: [countPatch(1)],
    action: async () => {
      throw new Error("fetch failed");
    },
  });

  // A thrown error carries nothing a user could act on, so it doesn't reach them.
  expect(result).toEqual({ error: WRITE_FAILED });
  expect(store.at(BOARD_KEY)).toEqual({ count: 1 });
});

test("a success keeps its optimistic patches until the invalidate lands", async () => {
  const store = fakeCache({
    [JSON.stringify(BOARD_KEY)]: { count: 1 },
    [JSON.stringify(COMMENTS_KEY)]: ["hello"],
  });

  const result = await runBoardWrite(deps(store.cache), {
    patches: [threadPatch((comments) => [...comments, "new"]), countPatch(1)],
    action: async () => undefined,
  });

  expect(result).toBeUndefined();
  expect(store.at(COMMENTS_KEY)).toEqual(["hello", "new"]);
  expect(store.at(BOARD_KEY)).toEqual({ count: 2 });
  // Both queries are re-read, so the server's version replaces the patched one.
  expect(store.invalidated).toContain(JSON.stringify(BOARD_KEY));
  expect(store.invalidated).toContain(JSON.stringify(COMMENTS_KEY));
});

test("an action that resolves with an empty result is a success, not a refusal", async () => {
  const store = fakeCache({ [JSON.stringify(BOARD_KEY)]: { count: 0 } });

  const result = await runBoardWrite(deps(store.cache), {
    patches: [countPatch(1)],
    action: async () => ({}),
  });

  expect(result).toEqual({});
  expect(store.at(BOARD_KEY)).toEqual({ count: 1 });
});

test("two patches to one query unwind to the value held before either of them", async () => {
  const store = fakeCache({ [JSON.stringify(BOARD_KEY)]: { count: 5 } });

  // One logical write can touch the same query twice — restoring in order would
  // leave the *first* patch applied, which is a number no server ever reported.
  const result = await runBoardWrite(deps(store.cache), {
    patches: [countPatch(-1), countPatch(-1)],
    action: async () => ({ error: "You can't delete those." }),
  });

  expect(result).toEqual({ error: "You can't delete those." });
  expect(store.at(BOARD_KEY)).toEqual({ count: 5 });
});

test("every patched query is cancelled and invalidated, alongside the board itself", async () => {
  const store = fakeCache({
    [JSON.stringify(BOARD_KEY)]: { count: 0 },
    [JSON.stringify(COMMENTS_KEY)]: [],
  });

  await runBoardWrite(deps(store.cache), {
    patches: [threadPatch((comments) => [...comments, "new"])],
    action: async () => undefined,
  });

  // The board key is always in both lists, even when no patch names it: a write
  // that changes anything changes the board's version.
  expect(store.cancelled).toEqual([JSON.stringify(BOARD_KEY), JSON.stringify(COMMENTS_KEY)]);
  expect(store.invalidated).toEqual([JSON.stringify(BOARD_KEY), JSON.stringify(COMMENTS_KEY)]);
});

test("a failure still settles the reconciler, so polling resumes", async () => {
  const store = fakeCache({ [JSON.stringify(BOARD_KEY)]: { count: 0 } });
  const reconciler = createReconciler();

  await runBoardWrite(
    { cache: store.cache, reconciler, boardKey: BOARD_KEY },
    { patches: [countPatch(1)], action: async () => ({ error: "Nope." }) },
  );

  // Left in flight, the gate would suppress every poll from here on (D3/D4).
  expect(reconciler.accepts(reconciler.snapshot())).toBe(true);
});

test("a write with no patches still runs, and its refusal reaches the caller", async () => {
  const store = fakeCache();

  const result = await runBoardWrite(deps(store.cache), {
    action: async () => ({ error: "Only the owner can do that." }),
  });

  expect(result).toEqual({ error: "Only the owner can do that." });
  expect(store.invalidated).toEqual([JSON.stringify(BOARD_KEY)]);
});
