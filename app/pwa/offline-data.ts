"use client";

import type { QueryClient } from "@tanstack/react-query";
import { boardKeys } from "@/app/boards/[id]/board-data";
import { forgetBoardIfLast, forgetLastBoard } from "./last-board";
import { deletePersistedQueries } from "./query-persistence";

/** How long to wait for the worker to confirm before giving up on it. */
const CLEAR_TIMEOUT_MS = 1_000;

/**
 * Forget everything this device holds about the signed-in user: the persisted
 * board cache, the note of which board to open offline, and the pages and API
 * responses the service worker cached for them.
 *
 * Called on sign-out. Without it, signing out on a shared phone would leave the
 * boards readable to the next person by pulling the plug on the network.
 */
export async function clearOfflineData(): Promise<void> {
  forgetLastBoard(window.localStorage);
  await deletePersistedQueries();
  await clearWorkerCaches();
}

/**
 * Forget one board: the cached payload the device holds for it (persisted to
 * IndexedDB by the same write) and the note an offline launch would follow back
 * to it. The board-scoped twin of `clearOfflineData` — called when a board is
 * deleted, since nothing else will ever correct a copy of a board that is gone.
 */
export function forgetBoard(queryClient: QueryClient, boardId: string): void {
  queryClient.removeQueries({ queryKey: boardKeys.board(boardId) });
  forgetBoardIfLast(window.localStorage, boardId);
}

/** Ask the worker to drop its caches, and wait for it to say that it has. */
async function clearWorkerCaches(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    // `getRegistration` rather than `ready`, which never settles when nothing is
    // registered — sign-out must not hang on a browser that has no worker.
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active;
    if (!worker) return;

    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      worker.postMessage({ type: "CLEAR_CACHES" }, [channel.port2]);
      // A worker that never answers must not strand someone on a page they've
      // asked to leave; the session is dropped either way.
      setTimeout(resolve, CLEAR_TIMEOUT_MS);
    });
  } catch {
    // No worker to tell — there is then nothing it cached either.
  }
}
