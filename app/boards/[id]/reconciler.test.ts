import { expect, test } from "vitest";
import { createReconciler } from "./reconciler";

// The rule the board's polling rests on (D3/D4): a poll's payload may only be
// applied to local state when it can't undo something the user just did. Two
// hazards, one gate — a mutation still in flight, and a payload that left the
// server before a local mutation was even made.

test("a payload stamped at the current version applies when nothing is in flight", () => {
  const reconciler = createReconciler();
  const stamp = reconciler.snapshot();
  expect(reconciler.accepts(stamp)).toBe(true);
});

test("a payload is suppressed while a mutation is in flight", () => {
  const reconciler = createReconciler();
  reconciler.begin();
  // Even a payload fetched *after* the mutation started is suppressed: it can't
  // contain the write, so applying it would flicker the card back.
  expect(reconciler.accepts(reconciler.snapshot())).toBe(false);
});

test("a payload that left before a local mutation is stale once the mutation settles", () => {
  const reconciler = createReconciler();
  const inflightPoll = reconciler.snapshot();

  reconciler.begin();
  reconciler.end();

  // The poll raced the mutation: it started first, so it predates the write.
  expect(reconciler.accepts(inflightPoll)).toBe(false);
  // The next poll, started after the mutation, is the one that may land.
  expect(reconciler.accepts(reconciler.snapshot())).toBe(true);
});

test("overlapping mutations stay suppressed until the last one settles", () => {
  const reconciler = createReconciler();
  reconciler.begin();
  reconciler.begin();
  reconciler.end();

  const stamp = reconciler.snapshot();
  expect(reconciler.accepts(stamp)).toBe(false);

  reconciler.end();
  expect(reconciler.accepts(stamp)).toBe(true);
});

test("versions are monotonic, so an old stamp never becomes valid again", () => {
  const reconciler = createReconciler();
  const first = reconciler.snapshot();

  for (let i = 0; i < 3; i++) {
    reconciler.begin();
    reconciler.end();
  }

  expect(reconciler.accepts(first)).toBe(false);
  expect(reconciler.snapshot()).toBeGreaterThan(first);
});

test("a settle that outlives its start can't push the in-flight count negative", () => {
  const reconciler = createReconciler();
  // A component unmounting mid-mutation, or a double-settle, must not leave the
  // gate stuck open on a *later* mutation.
  reconciler.end();
  reconciler.begin();
  expect(reconciler.accepts(reconciler.snapshot())).toBe(false);
});
