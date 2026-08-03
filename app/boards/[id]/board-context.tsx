"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnline } from "@/app/pwa/connection";
import { useOfflineWriteGate } from "@/app/pwa/offline-write-gate";
import {
  BOARD_POLL_MS,
  boardKeys,
  fetchBoard,
  fetchBoardVersion,
  type BoardData,
  type PolledBoard,
  type ThreadComment,
} from "./board-data";
import { projectMembership, type BoardMembership } from "./membership";
import { createReconciler, type Reconciler } from "./reconciler";
import {
  runBoardWrite,
  type ActionResult,
  type BoardMutation,
  type CachePatch,
  type WriteCache,
} from "./board-writes";

// The write protocol lives in `board-writes.ts`, but every component reaches it
// through this provider, so its vocabulary is re-exported from here.
export type { ActionResult, BoardMutation, CachePatch };

/** An optimistic edit to the cached board payload. */
export function patchBoard(
  boardId: string,
  update: (board: BoardData) => BoardData,
): CachePatch {
  return {
    queryKey: boardKeys.board(boardId),
    update: (previous) => {
      const held = previous as PolledBoard | undefined;
      // The stamp is deliberately carried over rather than refreshed: this payload
      // is local, not something a poll delivered, and the write that produced it
      // is still in flight.
      return held ? { ...update(held), stampedAt: held.stampedAt } : held;
    },
  };
}

/** An optimistic edit to a card's cached comment thread. */
export function patchComments(
  cardId: string,
  update: (comments: ThreadComment[]) => ThreadComment[],
): CachePatch {
  return {
    queryKey: boardKeys.comments(cardId),
    update: (previous) => {
      const held = previous as ThreadComment[] | undefined;
      return held ? update(held) : held;
    },
  };
}

type BoardControls = {
  boardId: string;
  currentUserId: string;
  /** The live board — server-rendered on first paint, polled from then on. */
  board: BoardData;
  /**
   * Who is on the board and what the viewer may do, projected from that same live
   * payload — so a promotion or demotion reaches every surface on the next poll
   * (ticket 17). Server-side checks remain the authority on what is permitted.
   */
  membership: BoardMembership;
  /** False when the device has no network: the board is stale and read-only (D8). */
  online: boolean;
  /**
   * True while the polling loop is failing — the server is unreachable, or access
   * was just revoked. A poll answered out of the offline cache counts as failing:
   * see `CACHED_RESPONSE_HEADER` in `board-data.ts`.
   */
  outOfSync: boolean;
  /** Run a board write with the optimistic + reconcile protocol. */
  run: (mutation: BoardMutation) => Promise<ActionResult>;
};

const BoardContext = createContext<BoardControls | null>(null);

/** The board a component is rendering inside, with its write protocol. */
export function useBoard(): BoardControls {
  const controls = useContext(BoardContext);
  if (!controls) throw new Error("useBoard must be used inside <BoardProvider>.");
  return controls;
}

/**
 * The board's near-real-time loop (D4) and the write protocol that coexists with
 * it (D3), for every component under one board.
 *
 * **Reads.** A cheap `GET /api/boards/:id/version` polls every 4s and pauses when
 * the tab is hidden (`refetchIntervalInBackground: false`). The heavy board
 * payload is *not* on an interval at all: it refetches only when the polled token
 * differs from the one the held payload carries. So an idle board costs one small
 * aggregate query per client per 4s, and the full read happens exactly when
 * something changed.
 *
 * **Writes.** Every mutation goes through `run`, which applies `runBoardWrite`'s
 * protocol: cancel in-flight reads so none lands on top of the edit, patch the
 * cache so the change is on screen instantly, send the action, roll every patch
 * back if it fails — thrown *or* refused with `{ error }` — and invalidate on
 * settle so the server's version of events replaces the optimistic one.
 *
 * **Where they meet.** A poll that left the server before a local write can't
 * contain it, and applying it would visibly snap the card back. The `Reconciler`
 * is the gate: the board's `queryFn` stamps each fetch with the local version it
 * started at, and a result that no longer matches — or that arrives while a write
 * is in flight — is dropped in favour of what's already cached. Nothing is lost:
 * the write's own invalidate brings a payload that includes it.
 *
 * **Membership.** The payload carries the board's members, so who is on the board
 * and what the viewer may do are projected out of it rather than passed in from the
 * server render (ticket 17) — one `BoardMembership` feeding the members panel, the
 * assignee picker, the heading's owner controls and the comment thread. A viewer
 * promoted or demoted mid-session therefore sees their controls change on the next
 * poll; the server still decides what is actually permitted.
 */
export function BoardProvider({
  boardId,
  currentUserId,
  initialBoard,
  renderedAt,
  children,
}: {
  boardId: string;
  currentUserId: string;
  /** The server-rendered payload, so the first paint needs no fetch. */
  initialBoard: BoardData;
  /** When the server read that payload — see `initialDataUpdatedAt` below. */
  renderedAt: number;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [reconciler] = useState<Reconciler>(createReconciler);
  const online = useOnline();
  const refuseWhileOffline = useOfflineWriteGate();

  const boardQuery = useQuery({
    queryKey: boardKeys.board(boardId),
    queryFn: async ({ signal }): Promise<PolledBoard> => {
      const stampedAt = reconciler.snapshot();
      const fetched = await fetchBoard(boardId, signal);
      const held = queryClient.getQueryData<PolledBoard>(boardKeys.board(boardId));
      // The gate: a payload that raced a local write is dropped, keeping what we
      // have (which already shows the write). The write's invalidate refetches.
      if (held && !reconciler.accepts(stampedAt)) return held;
      return { ...fetched, stampedAt };
    },
    initialData: () => ({ ...initialBoard, stampedAt: 0 }),
    // Offline, this page came out of the service worker's cache, so the payload
    // it carries can be older than the one persisted to IndexedDB. Dating it by
    // when the server actually read it lets the restored cache win when it is in
    // fact newer, instead of every launch resetting the board to the cached HTML.
    initialDataUpdatedAt: renderedAt,
    // Never stale on its own: the version guard below is the only thing that
    // decides this payload needs re-reading.
    staleTime: Infinity,
  });

  const versionQuery = useQuery({
    queryKey: boardKeys.version(boardId),
    queryFn: ({ signal }) => fetchBoardVersion(boardId, signal),
    initialData: initialBoard.version,
    refetchInterval: BOARD_POLL_MS,
    // A hidden tab polls nothing — the board is re-checked when it comes back.
    refetchIntervalInBackground: false,
  });

  const board = boardQuery.data;
  const polledVersion = versionQuery.data;

  // Re-read on every payload, never captured at render: the viewer's role is a row
  // another owner can change while they watch (ticket 17).
  const membership = useMemo(
    () => projectMembership(board.members, currentUserId, board.board.ownerId),
    [board.members, board.board.ownerId, currentUserId],
  );

  // The version guard: the only trigger for refetching the heavy payload.
  useEffect(() => {
    if (polledVersion === undefined || polledVersion === board.version) return;
    queryClient.invalidateQueries({ queryKey: boardKeys.board(boardId), exact: true });
  }, [polledVersion, board.version, boardId, queryClient]);

  // The protocol's view of the cache — see `runBoardWrite` for what it does with it.
  const cache = useMemo<WriteCache>(
    () => ({
      // Stop reads that are already on the wire from landing on top of a patch.
      cancel: (queryKey) => queryClient.cancelQueries({ queryKey }),
      read: (queryKey) => queryClient.getQueryData(queryKey),
      write: (queryKey, data) => {
        queryClient.setQueryData(queryKey, data);
      },
      update: (queryKey, updater) => {
        queryClient.setQueryData(queryKey, updater);
      },
      invalidate: (queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      },
    }),
    [queryClient],
  );

  const run = useCallback(
    async (write: BoardMutation): Promise<ActionResult> => {
      // Offline is read-only (D8): refused before the optimistic patch is even
      // applied, so nothing is ever shown as saved that wasn't.
      const refused = refuseWhileOffline();
      if (refused) return { error: refused };

      return runBoardWrite({ cache, reconciler, boardKey: boardKeys.board(boardId) }, write);
    },
    [boardId, cache, reconciler, refuseWhileOffline],
  );

  return (
    <BoardContext.Provider
      value={{
        boardId,
        currentUserId,
        board,
        membership,
        online,
        // Offline has its own banner saying the same thing more precisely; this
        // notice is for the case the network is up but the board isn't reachable —
        // which the query can only see because a poll the service worker answered
        // from its cache arrives here as an error rather than as an unchanged token.
        outOfSync: versionQuery.isError && online,
        run,
      }}
    >
      {children}
    </BoardContext.Provider>
  );
}
