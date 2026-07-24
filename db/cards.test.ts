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
  updateCard,
} from "./cards";

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
