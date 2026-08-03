/**
 * Telling the app's other tabs that the device is being cleared (ticket 19).
 *
 * Sign-out empties this device, and every open tab is holding a copy of what it's
 * emptying: a live query cache in memory, a persister that rewrites that cache to
 * IndexedDB after every change, and a board on screen. Clearing without saying so
 * clears nothing for long — the next tab's poll settles, its persister flushes,
 * and the boards are back on the device seconds after the sign-out said they were
 * gone. Worse, the board is still legible on that tab's screen.
 *
 * So the clearing tab announces first and does the work second. The others stop
 * persisting, drop what they hold in memory, and put the board away.
 *
 * `BroadcastChannel` is same-origin and needs no server; a browser without it
 * simply doesn't get the coordination, and the read-back in `clearDevice` is what
 * notices.
 */

/** The channel name. Same-origin, so no other app can be listening. */
export const SIGN_OUT_CHANNEL = "kanban:sign-out";

/** The one message it carries. */
const SIGNED_OUT = "kanban:signed-out";

type Announcement = { type: typeof SIGNED_OUT; from: string };

/** What a tab posts when it starts clearing the device. */
export function signOutAnnouncement(from: string): Announcement {
  return { type: SIGNED_OUT, from };
}

/**
 * This tab's id.
 *
 * A channel delivers to every *other* channel object on the origin — including
 * the ones in the tab that posted, which is not another tab. Without an id to
 * recognise itself by, the clearing tab would hear its own announcement, put its
 * own board away and stop half-way through emptying the device.
 *
 * Assigned lazily rather than at module scope: this module is also evaluated on
 * the server, where there are no tabs and one id would be shared by every render.
 */
let id: string | null = null;
function thisTabId(): string {
  id ??= `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return id;
}

/**
 * Whether a message is another tab announcing a sign-out.
 *
 * Anything on the origin can open a channel by that name, so the payload is
 * checked rather than assumed — a tab that dropped its cache because a stray
 * message arrived would look, to the person using it, exactly like being signed
 * out for no reason.
 */
export function isSignOutFromAnotherTab(data: unknown, thisTab: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  const { type, from } = data as { type?: unknown; from?: unknown };
  return type === SIGNED_OUT && typeof from === "string" && from !== thisTab;
}

/** Tell the other tabs to let go of this account's data. */
export function announceSignOut(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
    channel.postMessage(signOutAnnouncement(thisTabId()));
    channel.close();
  } catch {
    // No channel is a coordination failure, not a clearing failure: this tab still
    // empties the device, and the read-back reports anything another tab put back.
  }
}

/** Listen for *another* tab signing out. Returns the unsubscribe. */
export function onSignOut(handle: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
  } catch {
    return () => {};
  }

  const thisTab = thisTabId();
  const listener = (event: MessageEvent) => {
    if (isSignOutFromAnotherTab(event.data, thisTab)) handle();
  };
  channel.addEventListener("message", listener);

  return () => {
    channel.removeEventListener("message", listener);
    channel.close();
  };
}
