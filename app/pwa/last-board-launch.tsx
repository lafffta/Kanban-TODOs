"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readLastBoard, rememberLastBoard } from "./last-board";

/**
 * Notes the board being looked at, so an offline launch knows where to go.
 * Rendered by the board page; writes nothing else and shows nothing.
 */
export function RememberBoard({ boardId, name }: { boardId: string; name: string }) {
  useEffect(() => {
    rememberLastBoard(window.localStorage, { id: boardId, name });
  }, [boardId, name]);

  return null;
}

/**
 * Whether this is the first mount since the document loaded. A launch is a fresh
 * document; tapping "← Boards" from a board is not, and must not be bounced
 * straight back to the board it came from.
 */
let launched = false;

/**
 * The offline launch (D8): the app opens at the boards list, which needs the
 * network to list anything, so a launch with no network hands over to the last
 * board seen instead — which the persisted query cache and the service worker can
 * both answer for.
 *
 * Online, this does nothing at all: the boards list is where a launch belongs.
 */
export function LastBoardLaunch() {
  const router = useRouter();
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);

  useEffect(() => {
    if (launched) return;
    launched = true;

    // `navigator.onLine` read here rather than through `useOnline`: an effect only
    // ever runs in the browser, so this is the real answer. The hook's first
    // render deliberately claims to be online to match the server, and a launch
    // gets exactly one chance to redirect — it must not spend it on that guess.
    if (navigator.onLine) return;

    const board = readLastBoard(window.localStorage);
    if (!board) return;
    setRedirectingTo(board.name || "your last board");
    router.replace(`/boards/${board.id}`);
  }, [router]);

  if (!redirectingTo) return null;

  return (
    <p role="status" className="text-sm opacity-60">
      Opening {redirectingTo}…
    </p>
  );
}
