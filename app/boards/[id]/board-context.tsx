"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { BoardMemberProfile } from "@/db/boards";
import {
  BOARD_POLL_MS,
  boardKeys,
  fetchBoard,
  fetchBoardVersion,
  type BoardData,
  type PolledBoard,
  type ThreadComment,
} from "./board-data";
import { createReconciler, type Reconciler } from "./reconciler";

/** What a board server action answers with: nothing, or why it refused. */
export type ActionResult = { error?: string } | void | undefined;

/** An optimistic edit to one cached query, applied before its write is sent. */
export type CachePatch = {
  queryKey: QueryKey;
  update: (previous: unknown) => unknown;
};

/** A board write: what to show immediately, and the server action to send. */
export type BoardMutation = {
  patches?: CachePatch[];
  action: () => Promise<ActionResult>;
};

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
  isOwner: boolean;
  /** The live board — server-rendered on first paint, polled from then on. */
  board: BoardData;
  members: BoardMemberProfile[];
  /** True while the polling loop is failing (offline, or access just revoked). */
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
 * **Writes.** Every mutation goes through `run`: cancel in-flight reads so none
 * lands on top of the edit, patch the cache so the change is on screen instantly,
 * send the action, roll the patch back if it throws, and invalidate on settle so
 * the server's version of events replaces the optimistic one.
 *
 * **Where they meet.** A poll that left the server before a local write can't
 * contain it, and applying it would visibly snap the card back. The `Reconciler`
 * is the gate: the board's `queryFn` stamps each fetch with the local version it
 * started at, and a result that no longer matches — or that arrives while a write
 * is in flight — is dropped in favour of what's already cached. Nothing is lost:
 * the write's own invalidate brings a payload that includes it.
 */
export function BoardProvider({
  boardId,
  currentUserId,
  isOwner,
  initialBoard,
  children,
}: {
  boardId: string;
  currentUserId: string;
  isOwner: boolean;
  /** The server-rendered payload, so the first paint needs no fetch. */
  initialBoard: BoardData;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [reconciler] = useState<Reconciler>(createReconciler);

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

  // The version guard: the only trigger for refetching the heavy payload.
  useEffect(() => {
    if (polledVersion === undefined || polledVersion === board.version) return;
    queryClient.invalidateQueries({ queryKey: boardKeys.board(boardId), exact: true });
  }, [polledVersion, board.version, boardId, queryClient]);

  const mutation = useMutation({
    mutationFn: (write: BoardMutation) => write.action(),
    onMutate: async (write) => {
      reconciler.begin();
      const patches = write.patches ?? [];
      // Stop reads that are already on the wire from landing on top of the patch.
      await Promise.all(
        [boardKeys.board(boardId), ...patches.map((patch) => patch.queryKey)].map((key) =>
          queryClient.cancelQueries({ queryKey: key }),
        ),
      );
      const previous = patches.map((patch) => ({
        queryKey: patch.queryKey,
        data: queryClient.getQueryData(patch.queryKey),
      }));
      for (const patch of patches) {
        queryClient.setQueryData(patch.queryKey, patch.update);
      }
      return { previous };
    },
    onError: (_error, _write, context) => {
      for (const entry of context?.previous ?? []) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    },
    onSettled: (_data, _error, write) => {
      reconciler.end();
      // The board key is a prefix of the version key, so this re-reads both and
      // they can't drift apart.
      queryClient.invalidateQueries({ queryKey: boardKeys.board(boardId) });
      for (const patch of write.patches ?? []) {
        queryClient.invalidateQueries({ queryKey: patch.queryKey });
      }
    },
  });

  const { mutateAsync } = mutation;
  const run = useCallback(
    async (write: BoardMutation): Promise<ActionResult> => {
      try {
        return await mutateAsync(write);
      } catch {
        // A rejected action has already been rolled back; tell the caller so it
        // can say so where the user is looking.
        return { error: "That didn't save. Check your connection and try again." };
      }
    },
    [mutateAsync],
  );

  return (
    <BoardContext.Provider
      value={{
        boardId,
        currentUserId,
        isOwner,
        board,
        members: board.members,
        outOfSync: versionQuery.isError,
        run,
      }}
    >
      {children}
    </BoardContext.Provider>
  );
}
