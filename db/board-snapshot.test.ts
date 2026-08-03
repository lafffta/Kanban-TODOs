import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers } from "./schema";
import { changeMemberRole, createBoard } from "./boards";
import { createColumn, renameColumn, reorderColumn, deleteColumn } from "./columns";
import { assignCard, createCard, deleteCard, moveCard, updateCard } from "./cards";
import { addComment, deleteComment } from "./comments";
import { boardVersion, getBoardSnapshot } from "./board-snapshot";

// Polling integration test (ticket 09, D4): proves the cheap `boardVersion` token
// moves for every change a viewer would need to see — cards, columns, comments and
// membership, created, edited *and* deleted — stays put when nothing happens, and
// is scoped to one board so a busy neighbour doesn't force needless refetches.
// Also proves the full snapshot the version guards carries everything the board
// view renders. Requires the Docker Postgres from docker-compose.yml.

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

async function makeBoard() {
  const owner = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  const column = await createColumn({
    boardId: board.id,
    name: "To Do",
    userId: owner.id,
  });
  return { owner, board, column };
}

/**
 * Run `change` and report whether the board's version token moved. Every
 * assertion below is about exactly this: a poll refetches the heavy payload only
 * when the token differs from the one it holds.
 */
async function versionMovesWhen(boardId: string, change: () => Promise<unknown>) {
  const before = await boardVersion(boardId);
  await change();
  const after = await boardVersion(boardId);
  return before !== after;
}

test("the version is stable while nothing on the board changes", async () => {
  const { board } = await makeBoard();
  const first = await boardVersion(board.id);
  expect(await boardVersion(board.id)).toBe(first);
});

test("every card change moves the version", async () => {
  const { owner, board, column } = await makeBoard();

  let card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Task",
    userId: owner.id,
  });
  const second = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Other",
    userId: owner.id,
  });

  expect(
    await versionMovesWhen(board.id, () =>
      createCard({
        boardId: board.id,
        columnId: column.id,
        title: "Third",
        userId: owner.id,
      }),
    ),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, async () => {
      card = await updateCard({
        cardId: card.id,
        title: "Renamed",
        description: "",
        userId: owner.id,
      });
    }),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      assignCard({ cardId: card.id, assigneeId: owner.id, userId: owner.id }),
    ),
  ).toBe(true);

  // The headline case: A moves a card, B's poll sees a new version within ~4s.
  expect(
    await versionMovesWhen(board.id, () =>
      moveCard({
        cardId: card.id,
        columnId: column.id,
        beforeId: second.id,
        afterId: null,
        userId: owner.id,
      }),
    ),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      deleteCard({ cardId: card.id, userId: owner.id }),
    ),
  ).toBe(true);
});

test("every column change moves the version", async () => {
  const { owner, board, column } = await makeBoard();
  const second = await createColumn({
    boardId: board.id,
    name: "Doing",
    userId: owner.id,
  });

  expect(
    await versionMovesWhen(board.id, () =>
      createColumn({ boardId: board.id, name: "Done", userId: owner.id }),
    ),
  ).toBe(true);

  // A rename touches no timestamp of its own accord — `columns.updatedAt` exists
  // precisely so this reaches the other viewer.
  expect(
    await versionMovesWhen(board.id, () =>
      renameColumn({ columnId: column.id, name: "Backlog", userId: owner.id }),
    ),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      reorderColumn({
        columnId: column.id,
        beforeId: second.id,
        afterId: null,
        userId: owner.id,
      }),
    ),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      deleteColumn({ columnId: second.id, userId: owner.id }),
    ),
  ).toBe(true);
});

test("adding or deleting a comment moves the version (the card face's count changes)", async () => {
  const { owner, board, column } = await makeBoard();
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Task",
    userId: owner.id,
  });

  let commentId = "";
  expect(
    await versionMovesWhen(board.id, async () => {
      const comment = await addComment({
        cardId: card.id,
        body: "First",
        userId: owner.id,
      });
      commentId = comment.id;
    }),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      deleteComment({ commentId, userId: owner.id }),
    ),
  ).toBe(true);
});

test("a joining or leaving member moves the version", async () => {
  const { board } = await makeBoard();
  const joiner = await makeUser();

  expect(
    await versionMovesWhen(board.id, () =>
      db.insert(boardMembers).values({
        boardId: board.id,
        userId: joiner.id,
        role: "member",
      }),
    ),
  ).toBe(true);
});

test("a promotion or demotion moves the version, though nobody joined or left", async () => {
  const { owner, board } = await makeBoard();
  const member = await makeUser();
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  // The case the member *count* cannot see: the same people, one of them now
  // governing. Without it a promoted user keeps a member's UI until they reload.
  expect(
    await versionMovesWhen(board.id, () =>
      changeMemberRole({
        boardId: board.id,
        userId: member.id,
        role: "owner",
        actorId: owner.id,
      }),
    ),
  ).toBe(true);

  expect(
    await versionMovesWhen(board.id, () =>
      changeMemberRole({
        boardId: board.id,
        userId: member.id,
        role: "member",
        actorId: owner.id,
      }),
    ),
  ).toBe(true);
});

test("a change on another board leaves this board's version alone", async () => {
  const mine = await makeBoard();
  const theirs = await makeBoard();

  const before = await boardVersion(mine.board.id);
  await createCard({
    boardId: theirs.board.id,
    columnId: theirs.column.id,
    title: "Not mine",
    userId: theirs.owner.id,
  });
  expect(await boardVersion(mine.board.id)).toBe(before);
});

test("the snapshot carries the board, its lanes, cards and members with its version", async () => {
  const { owner, board, column } = await makeBoard();
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Task",
    userId: owner.id,
  });
  await assignCard({ cardId: card.id, assigneeId: owner.id, userId: owner.id });
  await addComment({ cardId: card.id, body: "Hi", userId: owner.id });

  const snapshot = await getBoardSnapshot(board.id);
  expect(snapshot).not.toBeNull();
  expect(snapshot!.board.name).toBe("Board");
  expect(snapshot!.columns.map((c) => c.id)).toEqual([column.id]);
  expect(snapshot!.cards).toHaveLength(1);
  expect(snapshot!.cards[0].assignee?.id).toBe(owner.id);
  expect(snapshot!.cards[0].commentCount).toBe(1);
  expect(snapshot!.members.map((m) => m.id)).toEqual([owner.id]);
  expect(snapshot!.version).toBe(await boardVersion(board.id));
});

test("a snapshot of a board that isn't there is null", async () => {
  expect(await getBoardSnapshot("00000000-0000-0000-0000-000000000000")).toBeNull();
});
