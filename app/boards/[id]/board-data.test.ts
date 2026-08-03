import { afterEach, expect, test, vi } from "vitest";
import { fetchBoard, fetchBoardVersion } from "./board-data";

// What counts as having read the board (D4, ticket 18).
//
// The board's whole freshness story is the 4s version poll: a token that hasn't
// moved means nothing has changed. That inference is only sound if a poll that
// *succeeded* proves the server answered it — so a response the service worker
// served out of its own cache has to arrive here as a failure, not as a 200
// carrying a token that could not possibly have moved. The board's "Not syncing"
// notice is exactly `versionQuery.isError`, so this is where it comes from.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The marker `public/sw.js` puts on anything it answered from a cache. */
const CACHED_HEADER = "X-Kanban-Cached";

/** Answer every request with `response`, as the network (or the worker) would. */
function answering(response: Response) {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const BOARD = { board: { id: "b1" }, columns: [], cards: [], members: [], version: "7" };

test("a live poll reads the server's token", async () => {
  answering(Response.json({ version: "7" }));

  await expect(fetchBoardVersion("b1")).resolves.toBe("7");
});

test("a live read reads the server's board", async () => {
  answering(Response.json(BOARD));

  await expect(fetchBoard("b1")).resolves.toEqual(BOARD);
});

test("a poll answered from the offline cache is a failed poll, not an unchanged one", async () => {
  // The case this exists for: the browser reports online, the server is
  // unreachable, and the worker answers with the last token it saw. Taken at face
  // value the board would sit there looking current forever.
  answering(Response.json({ version: "7" }, { headers: { [CACHED_HEADER]: "1" } }));

  await expect(fetchBoardVersion("b1")).rejects.toThrow(/offline cache/);
});

test("a board read answered from the offline cache is a failed read", async () => {
  // The payload stays on screen regardless — the query keeps the data it has when
  // a read fails. What it must not do is accept a cached copy as the current board
  // and stop showing that anything is wrong.
  answering(Response.json(BOARD, { headers: { [CACHED_HEADER]: "1" } }));

  await expect(fetchBoard("b1")).rejects.toThrow(/offline cache/);
});

test("a refused read is a failed read", async () => {
  // Access revoked mid-session: the poll starts answering 403 and the board says
  // it is no longer syncing.
  answering(Response.json({ error: "Forbidden" }, { status: 403 }));

  await expect(fetchBoardVersion("b1")).rejects.toThrow(/403/);
});

test("the poll asks for the cheap endpoint, not the whole board", async () => {
  const fetch = answering(Response.json({ version: "7" }));

  await fetchBoardVersion("b1");

  expect(fetch).toHaveBeenCalledWith("/api/boards/b1/version", { signal: undefined });
});
