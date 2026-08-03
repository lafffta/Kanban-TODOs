"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { boardKeys } from "@/app/boards/[id]/board-data";
import {
  lastBoardArea,
  persistedQueriesArea,
  releaseDevice,
  workerCachesArea,
  type Clearable,
  type ClearOutcome,
} from "./device-clearing";
import { forgetBoardIfLast, type StorageLike } from "./last-board";
import { indexedDbCacheStore, type StoppablePersister } from "./query-persistence";
import { announceSignOut, onSignOut } from "./sign-out-broadcast";

/**
 * Wiring the device's copy of the signed-in user's data to the browser it's
 * actually held in.
 *
 * The rules live next door — what has to be cleared and how it's proven gone is
 * `device-clearing.ts`, what the other tabs are told is `sign-out-broadcast.ts`.
 * This is the part that knows about `window`.
 */

/**
 * `window.localStorage`, reached inside the calls rather than captured here: this
 * module is evaluated on the server too, where there is no `window` to touch.
 */
const deviceStorage: StorageLike = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};

/**
 * Everywhere on this device that holds something of the signed-in user's.
 *
 * Built per call, not once: each one is a handle to browser storage, and building
 * them at module scope would mean touching that storage during a server render.
 */
export function deviceAreas(): Clearable[] {
  return [
    persistedQueriesArea(indexedDbCacheStore()),
    lastBoardArea(deviceStorage),
    // Cache Storage and the service worker that fills it both need a secure
    // context, so a browser without the one cached nothing through the other.
    workerCachesArea(typeof caches === "undefined" ? null : caches),
  ];
}

/**
 * The persister this document is using, so sign-out can switch it off before it
 * empties the device. Held in context rather than at module scope because it is
 * per-document state, and this module is also evaluated on the server.
 */
const PersisterContext = createContext<StoppablePersister | null>(null);

export const PersisterProvider = PersisterContext.Provider;

function usePersister(): StoppablePersister {
  const persister = useContext(PersisterContext);
  if (!persister) throw new Error("The query persister must be provided by <Providers>.");
  return persister;
}

/**
 * Clear everything this device holds about the signed-in user, and say whether it
 * worked. The order this happens in, and why, is `releaseDevice`.
 *
 * Whatever it couldn't clear comes back by name — see `SignOutButton`, which holds
 * the session open rather than signing out over the top of a device that still has
 * the boards on it.
 */
export function useClearDevice(): () => Promise<ClearOutcome> {
  const letGo = useLetGo();

  return useCallback(
    () => releaseDevice({ announce: announceSignOut, letGo, areas: deviceAreas() }),
    [letGo],
  );
}

/**
 * Let go of the copy this document is holding: stop writing it to the device, and
 * drop it out of memory.
 *
 * Permanent, deliberately. There is no resuming: either the session is ending, or
 * the clearing that follows has just failed — and a device we couldn't empty is
 * the last one that should be handed more to hold. A reload starts a fresh
 * persister when there's a session to justify one.
 */
function useLetGo(): () => void {
  const queryClient = useQueryClient();
  const persister = usePersister();

  return useCallback(() => {
    persister.stop();
    queryClient.clear();
  }, [persister, queryClient]);
}

/**
 * Whether another tab has signed this account out — and, the first time it does,
 * letting go of everything this tab was holding.
 *
 * The tab doing the clearing can only empty storage. The copy in *this* tab's
 * memory is ours to drop, and it is the copy that would undo the clearing: one
 * settled poll and the persister writes the boards back.
 *
 * Deliberately not a navigation, which was the obvious move and the wrong one:
 * loading a page mid-clearing sends a request the service worker caches, putting
 * an entry back into the very cache being swept and failing the sign-out over
 * nothing. Nothing is fetched here at all — `SignedOutGate` takes the board off
 * the screen, and the person decides when to go anywhere.
 */
export function useSignedOutElsewhere(): boolean {
  const letGo = useLetGo();
  const [signedOut, setSignedOut] = useState(false);

  useEffect(
    () =>
      onSignOut(() => {
        letGo();
        setSignedOut(true);
      }),
    [letGo],
  );

  return signedOut;
}

/**
 * Forget one board: the cached payload the device holds for it (persisted to
 * IndexedDB by the same write) and the note an offline launch would follow back
 * to it. The board-scoped twin of the sign-out clearing — called when a board is
 * deleted, since nothing else will ever correct a copy of a board that is gone.
 */
export function forgetBoard(queryClient: QueryClient, boardId: string): void {
  queryClient.removeQueries({ queryKey: boardKeys.board(boardId) });
  forgetBoardIfLast(deviceStorage, boardId);
}
