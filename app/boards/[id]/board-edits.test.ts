import { expect, test } from "vitest";
import type { BoardCard, BoardColumn, BoardData } from "./board-data";
import {
  groupByColumn,
  isProvisional,
  orderedColumns,
  withCardPatch,
  withColumnRenamed,
  withCommentCount,
  withMovedCard,
  withMovedColumn,
  withNewCard,
  withNewColumn,
  withoutCard,
  withoutColumn,
} from "./board-edits";

// The optimistic half of polling (D3): every board mutation patches the cached
// payload the instant the user acts, so the UI never waits a round trip, and the
// patch is shaped so the next poll lands on the same arrangement rather than
// fighting it. These are pure functions over the payload — the reconciler decides
// *when* a poll may replace them, these decide *what* the user sees meanwhile.

function column(id: string, position: string, name = id): BoardColumn {
  return {
    id,
    boardId: "board",
    name,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function card(id: string, columnId: string, position: string): BoardCard {
  return {
    id,
    boardId: "board",
    columnId,
    title: id,
    description: "",
    position,
    assigneeId: null,
    createdById: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assignee: null,
    commentCount: 0,
  };
}

/** Two lanes: "todo" holds a, b, c; "doing" is empty. */
function board(): BoardData {
  return {
    board: {
      id: "board",
      name: "Board",
      ownerId: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    columns: [column("todo", "a0"), column("doing", "a1")],
    cards: [card("a", "todo", "a0"), card("b", "todo", "a1"), card("c", "todo", "a2")],
    members: [{ id: "user", name: "A", email: "a@example.com", image: null, role: "owner" }],
    version: "v1",
  };
}

/** The ids in one lane, in the order the board view would render them. */
function lane(data: BoardData, columnId: string): string[] {
  return groupByColumn(data.columns, data.cards)[columnId].map((c) => c.id);
}

test("lanes are ordered by position, not by the order the payload happened to arrive", () => {
  const data = board();
  data.cards = [data.cards[2], data.cards[0], data.cards[1]];
  expect(lane(data, "todo")).toEqual(["a", "b", "c"]);
  expect(lane(data, "doing")).toEqual([]);
});

test("cards sharing a position are broken by id, the same tiebreak the server reads with", () => {
  const data = board();
  data.cards = [card("z", "todo", "a0"), card("a", "todo", "a0")];
  expect(lane(data, "todo")).toEqual(["a", "z"]);
});

test("a card moved within its lane lands between the neighbours it was dropped between", () => {
  const moved = withMovedCard(board(), {
    cardId: "a",
    columnId: "todo",
    beforeId: "b",
    afterId: "c",
  });
  expect(lane(moved, "todo")).toEqual(["b", "a", "c"]);
});

test("a card moved to another lane leaves the first and lands in the second", () => {
  const moved = withMovedCard(board(), {
    cardId: "b",
    columnId: "doing",
    beforeId: null,
    afterId: null,
  });
  expect(lane(moved, "todo")).toEqual(["a", "c"]);
  expect(lane(moved, "doing")).toEqual(["b"]);
  expect(moved.cards.find((c) => c.id === "b")?.columnId).toBe("doing");
});

test("a card dropped at the head of a lane sorts before everything already there", () => {
  const moved = withMovedCard(board(), {
    cardId: "c",
    columnId: "todo",
    beforeId: null,
    afterId: "a",
  });
  expect(lane(moved, "todo")).toEqual(["c", "a", "b"]);
});

test("moving a card that is no longer on the board leaves the payload alone", () => {
  const data = board();
  expect(
    withMovedCard(data, {
      cardId: "gone",
      columnId: "todo",
      beforeId: null,
      afterId: null,
    }),
  ).toEqual(data);
});

test("editing a card patches only that card", () => {
  const patched = withCardPatch(board(), "b", { title: "Renamed", description: "Why" });
  const target = patched.cards.find((c) => c.id === "b");
  expect(target?.title).toBe("Renamed");
  expect(target?.description).toBe("Why");
  expect(patched.cards.find((c) => c.id === "a")?.title).toBe("a");
});

test("assigning a card shows the assignee's avatar before the write lands", () => {
  const member = board().members[0];
  const patched = withCardPatch(board(), "a", {
    assigneeId: member.id,
    assignee: member,
  });
  expect(patched.cards.find((c) => c.id === "a")?.assignee?.email).toBe(member.email);

  const cleared = withCardPatch(patched, "a", { assigneeId: null, assignee: null });
  expect(cleared.cards.find((c) => c.id === "a")?.assignee).toBeNull();
});

test("a deleted card disappears from its lane", () => {
  const without = withoutCard(board(), "b");
  expect(lane(without, "todo")).toEqual(["a", "c"]);
});

test("a new card appears at the end of its lane, provisional until the write returns", () => {
  const added = withNewCard(board(), { columnId: "todo", title: "New", createdById: "user" });
  expect(lane(added, "todo")).toEqual(["a", "b", "c", added.cards.at(-1)!.id]);

  const provisional = added.cards.at(-1)!;
  expect(isProvisional(provisional.id)).toBe(true);
  expect(provisional.title).toBe("New");
  expect(provisional.commentCount).toBe(0);
  // A row the server hasn't seen has no id anyone else can act on — the board view
  // renders it inert until the refetch swaps in the real one.
  expect(isProvisional("a")).toBe(false);
});

test("a new column appears at the end of the board, empty and provisional", () => {
  const added = withNewColumn(board(), { name: "Done" });
  const provisional = added.columns.at(-1)!;
  expect(orderedColumns(added.columns).map((c) => c.name)).toEqual(["todo", "doing", "Done"]);
  expect(isProvisional(provisional.id)).toBe(true);
  expect(lane(added, provisional.id)).toEqual([]);
});

test("a renamed column shows its new name immediately", () => {
  const renamed = withColumnRenamed(board(), "todo", "Backlog");
  expect(renamed.columns.find((c) => c.id === "todo")?.name).toBe("Backlog");
});

test("a reordered column lands between its new neighbours", () => {
  const data = withNewColumn(board(), { name: "Done" });
  const done = data.columns.at(-1)!;
  const moved = withMovedColumn(data, {
    columnId: done.id,
    beforeId: null,
    afterId: "todo",
  });
  expect(orderedColumns(moved.columns).map((c) => c.id)).toEqual([done.id, "todo", "doing"]);
});

test("a deleted column takes its cards with it (D5 cascade, shown immediately)", () => {
  const without = withoutColumn(board(), "todo");
  expect(without.columns.map((c) => c.id)).toEqual(["doing"]);
  expect(without.cards).toEqual([]);
});

test("commenting bumps the card face's count, and never below zero", () => {
  const added = withCommentCount(board(), "a", 1);
  expect(added.cards.find((c) => c.id === "a")?.commentCount).toBe(1);

  const removed = withCommentCount(added, "a", -1);
  expect(removed.cards.find((c) => c.id === "a")?.commentCount).toBe(0);
  expect(withCommentCount(removed, "a", -1).cards.find((c) => c.id === "a")?.commentCount).toBe(0);
});

test("every edit leaves the payload it was given untouched", () => {
  const data = board();
  const before = JSON.stringify(data);
  withMovedCard(data, { cardId: "a", columnId: "doing", beforeId: null, afterId: null });
  withCardPatch(data, "a", { title: "x" });
  withoutCard(data, "a");
  withNewCard(data, { columnId: "todo", title: "New", createdById: "user" });
  withoutColumn(data, "todo");
  withCommentCount(data, "a", 1);
  expect(JSON.stringify(data)).toBe(before);
});
