import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers, comments, users } from "./schema";
import { createBoard } from "./boards";
import { createColumn, deleteColumn } from "./columns";
import { createCard, deleteCard, listCards } from "./cards";
import {
  CommentNotFoundError,
  CommentPermissionError,
  addComment,
  deleteComment,
  listComments,
} from "./comments";

// Comments integration test: proves a member can add a plain-text comment and read
// a card's thread in order, that the author can delete their own comment and an
// owner can delete any while a plain member cannot delete others', that a removed
// author's comments survive with a null `authorId` (former member, D5), that
// deleting a card (or its column) cascades its comments (D5), that card faces carry
// a comment count, and that every mutation is refused for a non-member.
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

async function makeBoardWithCard() {
  const owner = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  const column = await createColumn({ boardId: board.id, name: "To Do", userId: owner.id });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Task",
    userId: owner.id,
  });
  return { owner, board, column, card };
}

test("a member can add comments and read the thread in createdAt order", async () => {
  const { board, card } = await makeBoardWithCard();
  const member = await addMember(board.id);

  const first = await addComment({ cardId: card.id, body: "First", userId: member.id });
  const second = await addComment({ cardId: card.id, body: "Second", userId: member.id });

  expect(first.authorId).toBe(member.id);
  expect(first.body).toBe("First");

  const thread = await listComments(card.id);
  expect(thread.map((c) => c.body)).toEqual(["First", "Second"]);
  // The author profile is resolved for rendering.
  expect(thread[0].author?.id).toBe(member.id);
  expect(thread[0].author?.email).toBe(member.email);
  expect(first.createdAt <= second.createdAt).toBe(true);
});

test("listComments is scoped to its card", async () => {
  const { owner, board, column, card } = await makeBoardWithCard();
  const other = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Other",
    userId: owner.id,
  });

  await addComment({ cardId: card.id, body: "Here", userId: owner.id });
  await addComment({ cardId: other.id, body: "There", userId: owner.id });

  expect((await listComments(card.id)).map((c) => c.body)).toEqual(["Here"]);
  expect((await listComments(other.id)).map((c) => c.body)).toEqual(["There"]);
});

test("card faces carry a comment count", async () => {
  const { owner, board, card } = await makeBoardWithCard();
  await addComment({ cardId: card.id, body: "One", userId: owner.id });
  await addComment({ cardId: card.id, body: "Two", userId: owner.id });

  const [listed] = await listCards(board.id);
  expect(listed.id).toBe(card.id);
  expect(listed.commentCount).toBe(2);
});

test("a card with no comments reports a zero count", async () => {
  const { board } = await makeBoardWithCard();
  const [listed] = await listCards(board.id);
  expect(listed.commentCount).toBe(0);
});

test("the author can delete their own comment", async () => {
  const { board, card } = await makeBoardWithCard();
  const member = await addMember(board.id);
  const comment = await addComment({ cardId: card.id, body: "Mine", userId: member.id });

  await deleteComment({ commentId: comment.id, userId: member.id });
  expect(await listComments(card.id)).toEqual([]);
});

test("an owner can delete any member's comment", async () => {
  const { owner, board, card } = await makeBoardWithCard();
  const member = await addMember(board.id);
  const comment = await addComment({ cardId: card.id, body: "Theirs", userId: member.id });

  await deleteComment({ commentId: comment.id, userId: owner.id });
  expect(await listComments(card.id)).toEqual([]);
});

test("a member cannot delete another member's comment", async () => {
  const { board, card } = await makeBoardWithCard();
  const author = await addMember(board.id);
  const other = await addMember(board.id);
  const comment = await addComment({ cardId: card.id, body: "Author's", userId: author.id });

  await expect(
    deleteComment({ commentId: comment.id, userId: other.id }),
  ).rejects.toBeInstanceOf(CommentPermissionError);

  // The comment was left in place.
  expect((await listComments(card.id)).map((c) => c.body)).toEqual(["Author's"]);
});

test("a removed author's comments survive with a null authorId (former member)", async () => {
  const { board, card } = await makeBoardWithCard();
  const member = await addMember(board.id);
  const comment = await addComment({ cardId: card.id, body: "Legacy", userId: member.id });

  // Deleting the account clears authorId but keeps the comment on the card.
  await db.delete(users).where(eq(users.id, member.id));

  const [survivor] = await listComments(card.id);
  expect(survivor.id).toBe(comment.id);
  expect(survivor.body).toBe("Legacy");
  expect(survivor.authorId).toBeNull();
  expect(survivor.author).toBeNull();
});

test("deleting a card cascades its comments (D5)", async () => {
  const { owner, card } = await makeBoardWithCard();
  await addComment({ cardId: card.id, body: "Doomed", userId: owner.id });

  await deleteCard({ cardId: card.id, userId: owner.id });
  expect(await db.select().from(comments).where(eq(comments.cardId, card.id))).toEqual([]);
});

test("deleting a column cascades its cards' comments (D5)", async () => {
  const { owner, column, card } = await makeBoardWithCard();
  await addComment({ cardId: card.id, body: "Doomed", userId: owner.id });

  await deleteColumn({ columnId: column.id, userId: owner.id });
  expect(await db.select().from(comments).where(eq(comments.cardId, card.id))).toEqual([]);
});

test("comment mutations are refused for a non-member", async () => {
  const { owner, card } = await makeBoardWithCard();
  const outsider = await makeUser();
  const comment = await addComment({ cardId: card.id, body: "Secret", userId: owner.id });

  const denied = { name: "BoardAccessError", reason: "not-a-member" };
  await expect(
    addComment({ cardId: card.id, body: "Nope", userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    deleteComment({ commentId: comment.id, userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(listComments(card.id)).resolves.toHaveLength(1);
});

test("deleting a missing comment raises CommentNotFoundError", async () => {
  const { owner } = await makeBoardWithCard();
  await expect(
    deleteComment({ commentId: "no-such-comment", userId: owner.id }),
  ).rejects.toBeInstanceOf(CommentNotFoundError);
});
