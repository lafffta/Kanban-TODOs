import { afterEach, expect, test } from "vitest";
import {
  SIGN_OUT_CHANNEL,
  announceSignOut,
  isSignOutFromAnotherTab,
  onSignOut,
  signOutAnnouncement,
} from "./sign-out-broadcast";

// Coordinating the app's other tabs on sign-out (ticket 19). Clearing the device
// from one tab achieves nothing while another is still holding the same boards in
// memory and flushing them back to IndexedDB every few seconds, so the clearing
// tab announces itself first.
//
// Two things have to be true of what comes back off that channel. It must not be
// trusted — anything on the origin can post, and a tab that dropped its cache
// because a stray message came past would be indistinguishable, to the person
// using it, from being signed out for no reason. And a tab must not hear *itself*:
// a channel delivers to every other channel object on the origin, which includes
// the ones in the tab that posted.

const openChannels: BroadcastChannel[] = [];

/** A stand-in for a second tab, since this test is only ever one document. */
function otherTab() {
  const channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
  openChannels.push(channel);
  return { signsOut: () => channel.postMessage(signOutAnnouncement("another-tab")) };
}

afterEach(() => {
  openChannels.splice(0).forEach((channel) => channel.close());
});

/** Fail loudly rather than hang if the message never arrives. */
function within(ms: number, promise: Promise<void>, what: string): Promise<void> {
  return Promise.race([
    promise,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error(what)), ms)),
  ]);
}

/** A beat long enough for a message to have arrived, for asserting one didn't. */
function aBeat(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("a tab hears another tab signing out", async () => {
  let told = 0;
  let arrived = () => {};
  const delivery = new Promise<void>((resolve) => (arrived = resolve));
  const stopListening = onSignOut(() => {
    told += 1;
    arrived();
  });

  otherTab().signsOut();
  await within(1_000, delivery, "the other tab was never told to let go of its copy");
  expect(told).toBe(1);

  // And a tab that has gone is no longer listening — its channel closed with it.
  stopListening();
  otherTab().signsOut();
  await aBeat();
  expect(told).toBe(1);
});

test("the tab doing the clearing does not hear itself", async () => {
  // It would otherwise put its own board away and stop half-way through emptying
  // the device — the announcement is meant for the tabs that aren't signing out.
  let told = 0;
  const stopListening = onSignOut(() => (told += 1));

  announceSignOut();
  await aBeat();

  expect(told).toBe(0);
  stopListening();
});

test("anything else on the channel is ignored", () => {
  expect(isSignOutFromAnotherTab(signOutAnnouncement("another-tab"), "this-tab")).toBe(true);
  expect(isSignOutFromAnotherTab(signOutAnnouncement("this-tab"), "this-tab")).toBe(false);
  expect(isSignOutFromAnotherTab({ type: "sign-out", from: "x" }, "this-tab")).toBe(false);
  expect(isSignOutFromAnotherTab({ type: "kanban:signed-out" }, "this-tab")).toBe(false);
  expect(isSignOutFromAnotherTab("kanban:signed-out", "this-tab")).toBe(false);
  expect(isSignOutFromAnotherTab(null, "this-tab")).toBe(false);
  expect(isSignOutFromAnotherTab([], "this-tab")).toBe(false);
});

test("a browser with no BroadcastChannel neither announces nor listens", () => {
  // Coordination is best-effort; the clearing tab still empties the device, and
  // the read-back is what notices anything another tab put back. Sign-out must not
  // fall over because the browser is old.
  const channel = globalThis.BroadcastChannel;
  // @ts-expect-error — deleting a global to stand in for a browser without it.
  delete globalThis.BroadcastChannel;
  try {
    expect(() => announceSignOut()).not.toThrow();
    expect(() => onSignOut(() => {})()).not.toThrow();
  } finally {
    globalThis.BroadcastChannel = channel;
  }
});
