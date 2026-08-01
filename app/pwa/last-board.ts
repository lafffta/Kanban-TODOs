/**
 * The board an offline launch opens (D8).
 *
 * A home-screen launch starts at the boards list, which needs the network to
 * render anything useful. So each board page leaves a note of itself here, and a
 * launch that finds itself offline follows it straight through to that board,
 * which the persisted query cache and the service worker can both answer for.
 *
 * It's a hint, not state: anything unreadable means "no board", and the boards
 * list is shown as normal.
 */

export type LastBoard = { id: string; name: string };

/** The subset of `Storage` this needs — so the rules are testable without a DOM. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const KEY = "kanban:last-board";

/** Note which board is being looked at, replacing any earlier note. */
export function rememberLastBoard(storage: StorageLike, board: LastBoard): void {
  try {
    storage.setItem(KEY, JSON.stringify({ id: board.id, name: board.name }));
  } catch {
    // A browser that refuses storage just doesn't get the offline shortcut.
  }
}

/** The board to open offline, or null when there isn't one to trust. */
export function readLastBoard(storage: StorageLike): LastBoard | null {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { id, name } = parsed as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || id === "") return null;
    return { id, name: typeof name === "string" ? name : "" };
  } catch {
    return null;
  }
}

/**
 * Drop the note if it points at this board — for when the board is deleted. Left
 * in place, an offline launch would follow it to a board that no longer exists and
 * open the copy the device happens to be holding.
 */
export function forgetBoardIfLast(storage: StorageLike, boardId: string): void {
  if (readLastBoard(storage)?.id === boardId) forgetLastBoard(storage);
}

/** Drop the note — on sign-out, so the next person doesn't land on it. */
export function forgetLastBoard(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing to forget, or nowhere to forget it.
  }
}
