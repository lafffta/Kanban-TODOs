import { expect, test } from "vitest";
import { shouldPersistQuery } from "./query-persistence";

// What gets written to the device (D8). The persisted cache is what an offline
// launch opens the board from, so the rule has to be exact in both directions: too
// little and the app opens empty, too much and a failed read is stored as though
// it were the board.

/** A cache entry shaped the way TanStack Query hands it to the dehydrate filter. */
function query(queryKey: readonly unknown[], status: string, data: unknown) {
  return { queryKey, state: { status, data } };
}

const board = { board: { id: "b1" }, columns: [], cards: [], members: [], version: "7" };

test("a successful board read is persisted — it's what an offline launch opens", () => {
  expect(shouldPersistQuery(query(["board", "b1"], "success", board))).toBe(true);
});

test("a card's thread is persisted, so an offline card still shows its discussion", () => {
  expect(shouldPersistQuery(query(["comments", "c1"], "success", []))).toBe(true);
});

test("the board's version token is persisted alongside the payload it describes", () => {
  // Restored together they agree, so a reconnect refetches on the first token that
  // actually moved rather than immediately on the first poll.
  expect(shouldPersistQuery(query(["board", "b1", "version"], "success", "7"))).toBe(true);
});

test("a failed read is never persisted", () => {
  // Otherwise the board a user is shown offline is whatever their connection was
  // already failing to load.
  expect(shouldPersistQuery(query(["board", "b1"], "error", undefined))).toBe(false);
  expect(shouldPersistQuery(query(["board", "b1"], "pending", undefined))).toBe(false);
});

test("a successful read that carries no data is never persisted", () => {
  expect(shouldPersistQuery(query(["board", "b1"], "success", undefined))).toBe(false);
});

test("only board-scoped reads are stored on the device", () => {
  // Persistence is opt-in by key: a future query is not quietly written to a
  // user's phone because it happened to be in the cache.
  expect(shouldPersistQuery(query(["boards"], "success", [{ id: "b1" }]))).toBe(false);
  expect(shouldPersistQuery(query(["session"], "success", { email: "a@b.c" }))).toBe(false);
  expect(shouldPersistQuery(query([], "success", 1))).toBe(false);
});
