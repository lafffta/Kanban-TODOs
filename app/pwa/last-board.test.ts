import { expect, test } from "vitest";
import { forgetLastBoard, readLastBoard, rememberLastBoard } from "./last-board";

// "Launched offline, the app opens straight to the last-seen board" (D8) rests on
// this note-to-self. It is read at launch to decide where to send someone, so a
// value written by an older build — or by anything else on the origin — has to
// come back as "no board" rather than as a broken navigation.

/** A `Storage` stand-in, so the rules can be exercised without a browser. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

test("the board most recently opened is the one read back", () => {
  const storage = fakeStorage();
  rememberLastBoard(storage, { id: "b1", name: "Roadmap" });
  rememberLastBoard(storage, { id: "b2", name: "Bugs" });
  expect(readLastBoard(storage)).toEqual({ id: "b2", name: "Bugs" });
});

test("nothing remembered reads as no board", () => {
  expect(readLastBoard(fakeStorage())).toBeNull();
});

test("a value that isn't a board reads as no board", () => {
  expect(readLastBoard(fakeStorage({ "kanban:last-board": "not json" }))).toBeNull();
  expect(readLastBoard(fakeStorage({ "kanban:last-board": '"b1"' }))).toBeNull();
  expect(readLastBoard(fakeStorage({ "kanban:last-board": '{"id":7,"name":"x"}' }))).toBeNull();
  expect(readLastBoard(fakeStorage({ "kanban:last-board": '{"name":"x"}' }))).toBeNull();
});

test("a board with no name is still somewhere to go", () => {
  // The name is only for the "opening your last board" line; the id is the part
  // the redirect needs.
  expect(readLastBoard(fakeStorage({ "kanban:last-board": '{"id":"b1"}' }))).toEqual({
    id: "b1",
    name: "",
  });
});

test("forgetting leaves no board to open", () => {
  const storage = fakeStorage();
  rememberLastBoard(storage, { id: "b1", name: "Roadmap" });
  forgetLastBoard(storage);
  expect(readLastBoard(storage)).toBeNull();
});

test("storage that refuses to answer reads as no board", () => {
  // Private-mode browsers throw on access rather than returning null.
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  expect(readLastBoard(hostile)).toBeNull();
  // And remembering a board must not take the board page down with it.
  expect(() => rememberLastBoard(hostile, { id: "b1", name: "Roadmap" })).not.toThrow();
  expect(() => forgetLastBoard(hostile)).not.toThrow();
});
