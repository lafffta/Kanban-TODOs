import type { BoardMemberProfile } from "@/db/boards";
import type { BoardSnapshot } from "@/db/board-snapshot";
import type { Board, Card, Column, UserProfile } from "@/db/schema";

/**
 * How often the open board and the open card's comments are polled (D4). Only the
 * board you're looking at polls, and only while the tab is visible — see
 * `refetchIntervalInBackground: false` in `board-context.tsx` and `comment-thread.tsx`.
 */
export const BOARD_POLL_MS = 4_000;
export const COMMENTS_POLL_MS = 5_000;

/**
 * A row as JSON delivers it: `Date` columns arrive as ISO strings. The board is
 * read two ways — server-rendered on first paint and polled over `fetch` after —
 * and both must produce the *same* shape, or a poll would quietly change the type
 * of a field under the components. `serializeBoard` is what guarantees it.
 */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

export type BoardColumn = Serialized<Column>;
export type BoardCard = Serialized<Card> & {
  assignee: UserProfile | null;
  commentCount: number;
};

/** The board payload the client holds: the snapshot, JSON-shaped. */
export type BoardData = {
  board: Serialized<Board>;
  columns: BoardColumn[];
  cards: BoardCard[];
  members: BoardMemberProfile[];
  /** The server's change token this payload was read at (see `boardVersion`). */
  version: string;
};

/**
 * The board payload plus the local version it was fetched at — the stamp the
 * reconciler checks before letting a poll overwrite what the user just did. It is
 * client-only bookkeeping and never crosses the wire.
 */
export type PolledBoard = BoardData & { stampedAt: number };

/**
 * A comment as the read API serves it: dates arrive JSON-serialized as ISO
 * strings, and the author is null for a former member whose account was removed.
 */
export type ThreadComment = {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  author: UserProfile | null;
};

/** Query keys. The version key sits *under* the board key, so invalidating the
 * board re-checks its token in the same sweep and the two never drift apart. */
export const boardKeys = {
  board: (boardId: string) => ["board", boardId] as const,
  version: (boardId: string) => ["board", boardId, "version"] as const,
  comments: (cardId: string) => ["comments", cardId] as const,
};

/** JSON-shape a server-read snapshot so SSR and polling hand components one type. */
export function serializeBoard(snapshot: BoardSnapshot): BoardData {
  return {
    board: { ...snapshot.board, createdAt: snapshot.board.createdAt.toISOString() },
    columns: snapshot.columns.map((column) => ({
      ...column,
      createdAt: column.createdAt.toISOString(),
      updatedAt: column.updatedAt.toISOString(),
    })),
    cards: snapshot.cards.map((card) => ({
      ...card,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    })),
    members: snapshot.members,
    version: snapshot.version,
  };
}

/**
 * The header the service worker sets on a response it answered out of its own
 * cache rather than from the network.
 *
 * A cached copy is not evidence the server was reached, and the board's freshness
 * rests entirely on that: an unchanged version token means nothing changed *only*
 * if the server is the one that said so. So a read carrying this marker is a
 * failed read — which is what raises the board's "Not syncing" notice instead of
 * leaving a stale payload looking current (ticket 18).
 *
 * This is the canonical spelling of the name. `public/sw.js` ships as a plain
 * script to the browser and so cannot import it — it repeats the literal, and the
 * worker's tests import this constant to hold the two ends together.
 */
export const CACHED_RESPONSE_HEADER = "X-Kanban-Cached";

/**
 * Read a JSON endpoint, turning anything that isn't a live 2xx — a refusal, or a
 * copy the offline cache answered with — into a throw the query can surface.
 */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  let failure: string | null = null;
  if (!response.ok) failure = `Request failed: ${response.status}`;
  else if (response.headers.has(CACHED_RESPONSE_HEADER)) {
    failure = `Not live: ${url} was answered from the offline cache`;
  }

  if (failure !== null) {
    // Nothing is going to read this body. Release it rather than leave the stream
    // open until it is collected — a poll that keeps failing runs every 4s.
    void response.body?.cancel();
    throw new Error(failure);
  }

  return (await response.json()) as T;
}

/** The heavy read — fetched only when the version guard says something changed. */
export function fetchBoard(boardId: string, signal?: AbortSignal): Promise<BoardData> {
  return getJson<BoardData>(`/api/boards/${boardId}`, signal);
}

/** The cheap read — one row of aggregates, polled every `BOARD_POLL_MS`. */
export async function fetchBoardVersion(
  boardId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { version } = await getJson<{ version: string }>(
    `/api/boards/${boardId}/version`,
    signal,
  );
  return version;
}

/** An open card's thread, polled every `COMMENTS_POLL_MS` while it's open. */
export async function fetchComments(
  cardId: string,
  signal?: AbortSignal,
): Promise<ThreadComment[]> {
  const { comments } = await getJson<{ comments: ThreadComment[] }>(
    `/api/cards/${cardId}/comments`,
    signal,
  );
  return comments;
}
