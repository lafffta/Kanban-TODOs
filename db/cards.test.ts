import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers, cards, users } from "./schema";
import { createBoard } from "./boards";
import { createColumn, deleteColumn } from "./columns";
import {
  AssigneeNotBoardMemberError,
  CardNotFoundError,
  assignCard,
  createCard,
  deleteCard,
  listCards,
  moveCard,
  updateCard,
} from "./cards";
import { keyBetween } from "./ordering";

// Cards integration test: proves a member can create / edit / delete a card in a
// column, that each card gets a fractional `position` within its column on create,
// that a card can be assigned to a board member (and only a board member), that a
// removed user's cards survive with a null `createdById`, that deleting a column
// cascades its cards (D5), and that every mutation is refused for a non-member.
// Requires the Docker Postgres from docker-compose.yml.

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await closeDb();
});

function uniqueEmail() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function makeUser() {
  return registerUser({ email: uniqueEmail(), password: "correct horse battery" });
}

async function addMember(boardId: string) {
  const member = await makeUser();
  await db.insert(boardMembers).values({ boardId, userId: member.id, role: "member" });
  return member;
}

async function makeBoardWithColumn() {
  const owner = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  const column = await createColumn({ boardId: board.id, name: "To Do", userId: owner.id });
  return { owner, board, column };
}

test("createCard appends cards and lists them in position order within a column", async () => {
  const { owner, board, column } = await makeBoardWithColumn();

  const a = await createCard({ boardId: board.id, columnId: column.id, title: "A", userId: owner.id });
  const b = await createCard({ boardId: board.id, columnId: column.id, title: "B", userId: owner.id });
  const c = await createCard({ boardId: board.id, columnId: column.id, title: "C", userId: owner.id });

  // Positions strictly ascending in creation order, and the creator is recorded.
  expect(a.position < b.position && b.position < c.position).toBe(true);
  expect(a.createdById).toBe(owner.id);
  expect(a.description).toBe("");

  const listed = await listCards(board.id);
  expect(listed.map((card) => card.title)).toEqual(["A", "B", "C"]);
});

test("card positions are scoped per column, not per board", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const other = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });

  const mk = (columnId: string, title: string) =>
    createCard({ boardId: board.id, columnId, title, userId: owner.id });

  const t1 = await mk(column.id, "Todo-1");
  const t2 = await mk(column.id, "Todo-2");
  const d1 = await mk(other.id, "Doing-1");
  const d2 = await mk(other.id, "Doing-2");

  // Each column appends within its own cards: positions ascend independently, and
  // the second column's first card is not chained onto the first column's tail.
  expect(t1.position < t2.position).toBe(true);
  expect(d1.position < d2.position).toBe(true);

  const listed = await listCards(board.id);
  const inColumn = (id: string) => listed.filter((c) => c.columnId === id).map((c) => c.title);
  expect(inColumn(column.id)).toEqual(["Todo-1", "Todo-2"]);
  expect(inColumn(other.id)).toEqual(["Doing-1", "Doing-2"]);
});

test("listCards is scoped to its board and carries assignee profiles", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const otherBoard = await createBoard({ name: "Other", ownerId: owner.id });
  const otherColumn = await createColumn({ boardId: otherBoard.id, name: "X", userId: owner.id });

  const here = await createCard({ boardId: board.id, columnId: column.id, title: "Here", userId: owner.id });
  await createCard({ boardId: otherBoard.id, columnId: otherColumn.id, title: "There", userId: owner.id });
  await assignCard({ cardId: here.id, assigneeId: owner.id, userId: owner.id });

  const listed = await listCards(board.id);
  expect(listed.map((c) => c.title)).toEqual(["Here"]);
  expect(listed[0].assignee?.id).toBe(owner.id);
  expect(listed[0].assignee?.email).toBe(owner.email);
});

test("a plain member can create, edit and delete a card", async () => {
  const { board, column } = await makeBoardWithColumn();
  const member = await addMember(board.id);

  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Draft",
    userId: member.id,
  });
  const edited = await updateCard({
    cardId: card.id,
    title: "Ship it",
    description: "line one\nline two",
    userId: member.id,
  });
  expect(edited.title).toBe("Ship it");
  expect(edited.description).toBe("line one\nline two");

  await deleteCard({ cardId: card.id, userId: member.id });
  expect(await listCards(board.id)).toEqual([]);
});

test("assignCard accepts a board member and can unassign", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const member = await addMember(board.id);
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });

  const assigned = await assignCard({ cardId: card.id, assigneeId: member.id, userId: owner.id });
  expect(assigned.assigneeId).toBe(member.id);

  const cleared = await assignCard({ cardId: card.id, assigneeId: null, userId: owner.id });
  expect(cleared.assigneeId).toBeNull();
});

test("assignCard rejects an assignee who is not a member of the board", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const outsider = await makeUser();
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });

  await expect(
    assignCard({ cardId: card.id, assigneeId: outsider.id, userId: owner.id }),
  ).rejects.toBeInstanceOf(AssigneeNotBoardMemberError);

  // And the card was left unassigned.
  const [still] = await db.select().from(cards).where(eq(cards.id, card.id));
  expect(still.assigneeId).toBeNull();
});

test("assignCard rejects an assignee who is not a user at all", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });

  // An id belonging to nobody is refused the same way a non-member is — the
  // caller learns the assignee isn't on the board, not which of the two.
  await expect(
    assignCard({ cardId: card.id, assigneeId: crypto.randomUUID(), userId: owner.id }),
  ).rejects.toBeInstanceOf(AssigneeNotBoardMemberError);
});

test("a removed user's cards survive with a null createdById (former member)", async () => {
  const { board, column } = await makeBoardWithColumn();
  const member = await addMember(board.id);
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Legacy",
    userId: member.id,
  });

  // Deleting the user account clears createdById but keeps the card on the board.
  await db.delete(users).where(eq(users.id, member.id));

  const [survivor] = await db.select().from(cards).where(eq(cards.id, card.id));
  expect(survivor).toBeDefined();
  expect(survivor.createdById).toBeNull();
});

test("deleting a column cascades its cards (D5)", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  await createCard({ boardId: board.id, columnId: column.id, title: "Doomed", userId: owner.id });

  await deleteColumn({ columnId: column.id, userId: owner.id });
  expect(await listCards(board.id)).toEqual([]);
});

test("card mutations are refused for a non-member", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const outsider = await makeUser();
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Secret", userId: owner.id });

  const denied = { name: "BoardAccessError", reason: "not-a-member" };
  await expect(
    createCard({ boardId: board.id, columnId: column.id, title: "Nope", userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    updateCard({ cardId: card.id, title: "Nope", description: "", userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    assignCard({ cardId: card.id, assigneeId: owner.id, userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    deleteCard({ cardId: card.id, userId: outsider.id }),
  ).rejects.toMatchObject(denied);

  const [still] = await db.select().from(cards).where(eq(cards.id, card.id));
  expect(still.title).toBe("Secret");
});

test("acting on a missing card raises CardNotFoundError", async () => {
  const { owner } = await makeBoardWithColumn();
  await expect(
    updateCard({ cardId: "no-such-card", title: "X", description: "", userId: owner.id }),
  ).rejects.toBeInstanceOf(CardNotFoundError);
});

test("moveCard reorders a card within its column, touching one row", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const mk = (title: string) =>
    createCard({ boardId: board.id, columnId: column.id, title, userId: owner.id });
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");

  // Drop C between A and B → order becomes A, C, B.
  const moved = await moveCard({
    cardId: c.id,
    columnId: column.id,
    beforeId: a.id,
    afterId: b.id,
    userId: owner.id,
  });
  expect(moved.columnId).toBe(column.id);
  expect(a.position < moved.position && moved.position < b.position).toBe(true);

  const order = (await listCards(board.id)).map((card) => card.title);
  expect(order).toEqual(["A", "C", "B"]);

  // A and B were untouched — only the moved row changed position.
  const rows = await db.select().from(cards).where(eq(cards.boardId, board.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  expect(byId.get(a.id)!.position).toBe(a.position);
  expect(byId.get(b.id)!.position).toBe(b.position);
});

test("moveCard across columns rewrites columnId and position", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const doing = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });
  const anchor = await createCard({ boardId: board.id, columnId: doing.id, title: "Anchor", userId: owner.id });

  // Move Task to the end of the Doing column (after Anchor).
  const moved = await moveCard({
    cardId: card.id,
    columnId: doing.id,
    beforeId: anchor.id,
    afterId: null,
    userId: owner.id,
  });
  expect(moved.columnId).toBe(doing.id);
  expect(moved.position > anchor.position).toBe(true);

  const listed = await listCards(board.id);
  const inDoing = listed.filter((c) => c.columnId === doing.id).map((c) => c.title);
  expect(inDoing).toEqual(["Anchor", "Task"]);
});

test("moveCard rejects a neighbour that isn't in the target column", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const doing = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });
  const strayNeighbour = await createCard({ boardId: board.id, columnId: column.id, title: "Stray", userId: owner.id });

  // The neighbour lives in `column`, but the move targets `doing`.
  await expect(
    moveCard({ cardId: card.id, columnId: doing.id, beforeId: strayNeighbour.id, afterId: null, userId: owner.id }),
  ).rejects.toBeInstanceOf(CardNotFoundError);
});

test("moveCard rejects a target column on another board", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const otherBoard = await createBoard({ name: "Other", ownerId: owner.id });
  const otherColumn = await createColumn({ boardId: otherBoard.id, name: "X", userId: owner.id });
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Task", userId: owner.id });

  await expect(
    moveCard({ cardId: card.id, columnId: otherColumn.id, beforeId: null, afterId: null, userId: owner.id }),
  ).rejects.toThrow("Column does not belong to this board.");

  // The card stayed put in its original lane.
  const [still] = await db.select().from(cards).where(eq(cards.id, card.id));
  expect(still.columnId).toBe(column.id);
});

test("moveCard is refused for a non-member", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const outsider = await makeUser();
  const card = await createCard({ boardId: board.id, columnId: column.id, title: "Secret", userId: owner.id });

  await expect(
    moveCard({ cardId: card.id, columnId: column.id, beforeId: null, afterId: null, userId: outsider.id }),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "not-a-member" });
});

// --- Collision-safe ordering (ticket 11) -----------------------------------

test("a card position collision is retried instead of surfacing as an error", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const first = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "A",
    userId: owner.id,
  });

  // Force the taken key once, then defer to the real generator.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return first.position;
    }
    return keyBetween(before, after);
  };

  const second = await createCard(
    { boardId: board.id, columnId: column.id, title: "B", userId: owner.id },
    { generate },
  );

  expect(forced).toBe(true);
  expect(second.position).not.toBe(first.position);
  expect(second.position > first.position).toBe(true);

  const listed = await listCards(board.id);
  expect(listed.map((c) => c.title)).toEqual(["A", "B"]);
});

test("a collision while moving a card is retried and lands in the requested slot", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const a = await createCard({ boardId: board.id, columnId: column.id, title: "A", userId: owner.id });
  const b = await createCard({ boardId: board.id, columnId: column.id, title: "B", userId: owner.id });
  const c = await createCard({ boardId: board.id, columnId: column.id, title: "C", userId: owner.id });

  // Move C between A and B, but force the first attempt onto A's taken key.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return a.position;
    }
    return keyBetween(before, after);
  };

  const moved = await moveCard(
    {
      cardId: c.id,
      columnId: column.id,
      beforeId: a.id,
      afterId: b.id,
      userId: owner.id,
    },
    { generate },
  );

  expect(forced).toBe(true);
  expect(moved.position).not.toBe(a.position);
  // Still strictly between its requested neighbours — the retry didn't relocate it.
  expect(a.position < moved.position && moved.position < b.position).toBe(true);

  const listed = await listCards(board.id);
  expect(listed.map((card) => card.title)).toEqual(["A", "C", "B"]);
});

test("card positions are unique within a lane but may repeat across lanes", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const other = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "A",
    userId: owner.id,
  });

  // The same key in a different lane is fine — that's what a cross-column move relies on.
  await expect(
    db.insert(cards).values({
      boardId: board.id,
      columnId: other.id,
      title: "Same key, other lane",
      position: card.position,
    }),
  ).resolves.toBeDefined();

  // A duplicate inside the same lane is refused by the database.
  await expect(
    db.insert(cards).values({
      boardId: board.id,
      columnId: column.id,
      title: "Dupe",
      position: card.position,
    }),
  ).rejects.toThrow();
});

test("concurrent card creates into one lane all get distinct, still-divisible keys", async () => {
  const { owner, board, column } = await makeBoardWithColumn();

  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createCard({ boardId: board.id, columnId: column.id, title: `C${i}`, userId: owner.id }),
    ),
  );

  const positions = created.map((c) => c.position);
  expect(new Set(positions).size).toBe(positions.length);

  const ordered = [...positions].sort();
  for (let i = 0; i < ordered.length - 1; i++) {
    const between = keyBetween(ordered[i], ordered[i + 1]);
    expect(ordered[i] < between && between < ordered[i + 1]).toBe(true);
  }
});

test("a card move collision narrows into the gap instead of re-rolling", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const mk = (title: string) =>
    createCard({ boardId: board.id, columnId: column.id, title, userId: owner.id });
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  const d = await mk("D");

  // Move A between B and D. C already occupies a key strictly inside that gap, so
  // forcing C's key exercises the narrowing branch, not the re-roll branch that a
  // key equal to `before` would hit.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return c.position;
    }
    return keyBetween(before, after);
  };

  const moved = await moveCard(
    { cardId: a.id, columnId: column.id, beforeId: b.id, afterId: d.id, userId: owner.id },
    { generate },
  );

  expect(forced).toBe(true);
  expect(moved.position).not.toBe(c.position);
  expect(b.position < moved.position && moved.position < c.position).toBe(true);

  const listed = await listCards(board.id);
  expect(listed.map((card) => card.title)).toEqual(["B", "A", "C", "D"]);
});

test("a cross-column move retries a collision in the target lane", async () => {
  const { owner, board, column } = await makeBoardWithColumn();
  const target = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });

  const travelling = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Travelling",
    userId: owner.id,
  });
  const mk = (title: string) =>
    createCard({ boardId: board.id, columnId: target.id, title, userId: owner.id });
  const x = await mk("X");
  const y = await mk("Y");
  const z = await mk("Z");

  // Land it between X and Z in the *other* lane, colliding with Y on the way.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return y.position;
    }
    return keyBetween(before, after);
  };

  const moved = await moveCard(
    { cardId: travelling.id, columnId: target.id, beforeId: x.id, afterId: z.id, userId: owner.id },
    { generate },
  );

  expect(forced).toBe(true);
  expect(moved.columnId).toBe(target.id);
  expect(moved.position).not.toBe(y.position);
  expect(x.position < moved.position && moved.position < y.position).toBe(true);

  const inTarget = (await listCards(board.id)).filter((c) => c.columnId === target.id);
  expect(inTarget.map((c) => c.title)).toEqual(["X", "Travelling", "Y", "Z"]);
});
