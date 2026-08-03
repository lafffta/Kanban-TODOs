import { afterEach, expect, test, vi } from "vitest";
import { CACHED_RESPONSE_HEADER, fetchBoard, fetchBoardVersion } from "./board-data";

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

/** Answer each path as the network — or the service worker — would. */
function answering(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const answer = routes[url];
    if (!answer) throw new Error(`nothing is serving ${url}`);
    // A fresh response per call: a body can only be read once.
    return answer();
  });
}

/** A response the service worker served from its cache instead of the network. */
function cached(body: unknown): Response {
  return Response.json(body, { headers: { [CACHED_RESPONSE_HEADER]: "1" } });
}

const VERSION_URL = "/api/boards/b1/version";
const BOARD_URL = "/api/boards/b1";

const BOARD = { board: { id: "b1" }, columns: [], cards: [], members: [], version: "7" };

test("a live poll reads the server's token from the cheap endpoint", async () => {
  // Not the board payload: the poll runs every 4s for everyone with the board
  // open, so it reads one row of aggregates (D4).
  answering({
    [VERSION_URL]: () => Response.json({ version: "7" }),
    [BOARD_URL]: () => Response.json({ ...BOARD, version: "the whole board" }),
  });

  await expect(fetchBoardVersion("b1")).resolves.toBe("7");
});

test("a live read reads the server's board", async () => {
  answering({ [BOARD_URL]: () => Response.json(BOARD) });

  await expect(fetchBoard("b1")).resolves.toEqual(BOARD);
});

test("a poll answered from the offline cache is a failed poll, not an unchanged one", async () => {
  // The case this exists for: the browser reports online, the server is
  // unreachable, and the worker answers with the last token it saw. Taken at face
  // value the board would sit there looking current forever.
  answering({ [VERSION_URL]: () => cached({ version: "7" }) });

  await expect(fetchBoardVersion("b1")).rejects.toThrow(/offline cache/);
});

test("a board read answered from the offline cache is a failed read", async () => {
  // The payload stays on screen regardless — the query keeps the data it has when
  // a read fails. What it must not do is accept a cached copy as the current board
  // and stop showing that anything is wrong.
  answering({ [BOARD_URL]: () => cached(BOARD) });

  await expect(fetchBoard("b1")).rejects.toThrow(/offline cache/);
});

test("a refused read is a failed read", async () => {
  // Access revoked mid-session: the poll starts answering 403 and the board says
  // it is no longer syncing.
  answering({ [VERSION_URL]: () => Response.json({ error: "Forbidden" }, { status: 403 }) });

  await expect(fetchBoardVersion("b1")).rejects.toThrow(/403/);
});
