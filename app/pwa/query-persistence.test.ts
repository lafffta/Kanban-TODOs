import { expect, test } from "vitest";
import { shouldPersistQuery } from "./query-persistence";

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

test("only board-scoped reads are stored on the device", () => {
  // Persistence is opt-in by key: a future query is not quietly written to a
  // user's phone because it happened to be in the cache.
  expect(shouldPersistQuery(query(["boards"], [{ id: "b1" }]))).toBe(false);
  expect(shouldPersistQuery(query(["session"], { email: "a@b.c" }))).toBe(false);
  expect(shouldPersistQuery(query([], 1))).toBe(false);
});
