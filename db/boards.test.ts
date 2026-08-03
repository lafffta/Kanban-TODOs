import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardInvites, boardMembers, users } from "./schema";
import {
  BoardAccessError,
  boardNameSchema,
  changeMemberRole,
  createBoard,
  deleteBoard,
  getBoard,
  listBoardMembers,
  listBoardsForUser,
  removeMember,
  renameBoard,
  requireBoardMember,
} from "./boards";
import { createColumn, listColumns } from "./columns";
import { assignCard, createCard, listCards } from "./cards";
import { addComment, listComments } from "./comments";
import { createInvite } from "./invites";

// Boards + membership integration test: proves creating a board makes the creator
// an `owner` member, that board listing is scoped to membership (two users each
// see only their own), that the `requireBoardMember` access-control seam admits
// members, refuses non-members, and enforces `minRole`, and that owner-only
// membership management (remove, change role) holds the board's creator in place.
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

/**
 * Invites still on a board, read straight from the table. The public read
 * (`listPendingInvites`) is owner-gated, and the deletion cascade under test takes
 * the owner's membership with it — so proving the rows are gone has to bypass it.
 */
async function listInviteRows(boardId: string) {
  return db.select().from(boardInvites).where(eq(boardInvites.boardId, boardId));
}

test("creating a board makes the creator an owner member", async () => {
  const owner = await makeUser();

  const board = await createBoard({ name: "Roadmap", ownerId: owner.id });
  expect(board.id).toBeTruthy();
  expect(board.name).toBe("Roadmap");
  expect(board.ownerId).toBe(owner.id);

  // The creator can be required as a member, at owner role, via the seam.
  const membership = await requireBoardMember(board.id, owner.id, "owner");
  expect(membership.role).toBe("owner");
});

test("listBoardsForUser returns only boards the user is a member of", async () => {
  const alice = await makeUser();
  const bob = await makeUser();

  const aliceBoard = await createBoard({ name: "Alice board", ownerId: alice.id });
  const bobBoard = await createBoard({ name: "Bob board", ownerId: bob.id });

  const aliceBoards = await listBoardsForUser(alice.id);
  const bobBoards = await listBoardsForUser(bob.id);

  expect(aliceBoards.map((b) => b.id)).toContain(aliceBoard.id);
  expect(aliceBoards.map((b) => b.id)).not.toContain(bobBoard.id);

  expect(bobBoards.map((b) => b.id)).toContain(bobBoard.id);
  expect(bobBoards.map((b) => b.id)).not.toContain(aliceBoard.id);
});

test("requireBoardMember refuses a non-member and enforces minRole", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const board = await createBoard({ name: "Private", ownerId: owner.id });

  // Non-member → not-a-member.
  await expect(requireBoardMember(board.id, outsider.id)).rejects.toMatchObject({
    name: "BoardAccessError",
    reason: "not-a-member",
  });

  // Missing board id is likewise a refusal, not a crash.
  await expect(requireBoardMember("no-such-board", owner.id)).rejects.toBeInstanceOf(
    BoardAccessError,
  );

  // Owner satisfies the default (member) and the owner minRole.
  expect((await requireBoardMember(board.id, owner.id)).role).toBe("owner");
  expect((await requireBoardMember(board.id, owner.id, "owner")).role).toBe("owner");
});

test("a plain member does not satisfy an owner-only requirement", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });

  // Simulate a second, non-owner membership (invites arrive in ticket 08).
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  // Member passes the default check but fails the owner gate.
  expect((await requireBoardMember(board.id, member.id)).role).toBe("member");
  await expect(
    requireBoardMember(board.id, member.id, "owner"),
  ).rejects.toMatchObject({ reason: "insufficient-role" });
});

test("an owner removes a member, and their assignments are cleared", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  const column = await createColumn({ boardId: board.id, name: "To Do", userId: owner.id });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Theirs",
    userId: owner.id,
  });
  await assignCard({ cardId: card.id, assigneeId: member.id, userId: owner.id });

  await removeMember({ boardId: board.id, userId: member.id, actorId: owner.id });

  await expect(requireBoardMember(board.id, member.id)).rejects.toMatchObject({
    reason: "not-a-member",
  });
  expect((await listBoardMembers(board.id)).map((m) => m.id)).toEqual([owner.id]);
  // A non-member can't stay assigned to the board's work.
  const [remaining] = await listCards(board.id);
  expect(remaining.assigneeId).toBeNull();
});

test("an owner changes a member's role", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  await changeMemberRole({
    boardId: board.id,
    userId: member.id,
    role: "owner",
    actorId: owner.id,
  });
  expect((await requireBoardMember(board.id, member.id, "owner")).role).toBe("owner");

  await changeMemberRole({
    boardId: board.id,
    userId: member.id,
    role: "member",
    actorId: owner.id,
  });
  expect((await requireBoardMember(board.id, member.id)).role).toBe("member");
});

test("a member cannot remove anyone or change a role", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const other = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });
  for (const user of [member, other]) {
    await db
      .insert(boardMembers)
      .values({ boardId: board.id, userId: user.id, role: "member" });
  }

  const denied = { name: "BoardAccessError", reason: "insufficient-role" };
  await expect(
    removeMember({ boardId: board.id, userId: other.id, actorId: member.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    changeMemberRole({
      boardId: board.id,
      userId: other.id,
      role: "owner",
      actorId: member.id,
    }),
  ).rejects.toMatchObject(denied);
  expect(await listBoardMembers(board.id)).toHaveLength(3);
});

test("the board's creator can be neither removed nor demoted", async () => {
  const owner = await makeUser();
  const coOwner = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: coOwner.id, role: "owner" });

  const refused = { name: "MembershipError", reason: "board-creator" };
  await expect(
    removeMember({ boardId: board.id, userId: owner.id, actorId: coOwner.id }),
  ).rejects.toMatchObject(refused);
  await expect(
    changeMemberRole({
      boardId: board.id,
      userId: owner.id,
      role: "member",
      actorId: owner.id,
    }),
  ).rejects.toMatchObject(refused);
  expect((await requireBoardMember(board.id, owner.id, "owner")).role).toBe("owner");
});

test("an owner renames a board; a member and a non-member cannot", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const outsider = await makeUser();
  const board = await createBoard({ name: "Roadmap", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  const renamed = await renameBoard({
    boardId: board.id,
    name: "Q3 roadmap",
    actorId: owner.id,
  });
  expect(renamed.name).toBe("Q3 roadmap");
  expect((await getBoard(board.id))?.name).toBe("Q3 roadmap");

  await expect(
    renameBoard({ boardId: board.id, name: "Mine now", actorId: member.id }),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "insufficient-role" });
  await expect(
    renameBoard({ boardId: board.id, name: "Mine now", actorId: outsider.id }),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "not-a-member" });

  expect((await getBoard(board.id))?.name).toBe("Q3 roadmap");
});

test("a board name is trimmed, non-empty and at most 100 characters", () => {
  expect(boardNameSchema.safeParse({ name: "  Roadmap  " }).data?.name).toBe("Roadmap");
  expect(boardNameSchema.safeParse({ name: "   " }).success).toBe(false);
  expect(boardNameSchema.safeParse({ name: "n".repeat(100) }).success).toBe(true);
  expect(boardNameSchema.safeParse({ name: "n".repeat(101) }).success).toBe(false);
});

test("an owner deletes a board and everything it owns goes with it", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const board = await createBoard({ name: "Doomed", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  const column = await createColumn({
    boardId: board.id,
    name: "To Do",
    userId: owner.id,
  });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Work",
    userId: owner.id,
  });
  await addComment({ cardId: card.id, body: "On it", userId: member.id });
  await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });

  await deleteBoard({ boardId: board.id, actorId: owner.id });

  expect(await getBoard(board.id)).toBeNull();
  expect(await listColumns(board.id)).toHaveLength(0);
  expect(await listCards(board.id)).toHaveLength(0);
  expect(await listComments(card.id)).toHaveLength(0);
  expect(await listBoardMembers(board.id)).toHaveLength(0);
  expect(await listInviteRows(board.id)).toHaveLength(0);
  // It is gone from both members' boards lists, not just the owner's.
  expect(await listBoardsForUser(owner.id)).toHaveLength(0);
  expect(await listBoardsForUser(member.id)).toHaveLength(0);
});

test("a member cannot delete a board", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const outsider = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  await expect(
    deleteBoard({ boardId: board.id, actorId: member.id }),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "insufficient-role" });
  await expect(
    deleteBoard({ boardId: board.id, actorId: outsider.id }),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "not-a-member" });

  expect(await getBoard(board.id)).not.toBeNull();
});

test("managing someone who isn't a member is refused", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const board = await createBoard({ name: "Team", ownerId: owner.id });

  const refused = { name: "MembershipError", reason: "not-a-member" };
  await expect(
    removeMember({ boardId: board.id, userId: outsider.id, actorId: owner.id }),
  ).rejects.toMatchObject(refused);
  await expect(
    changeMemberRole({
      boardId: board.id,
      userId: outsider.id,
      role: "member",
      actorId: owner.id,
    }),
  ).rejects.toMatchObject(refused);
});

// --- Former-member attribution on removal (ticket 20) -----------------------

/** A board with an owner, a member, and content the member created on it. */
async function boardWithMemberContent() {
  const owner = await registerUser({ email: uniqueEmail(), password: "correct horse battery" });
  const member = await registerUser({ email: uniqueEmail(), password: "correct horse battery" });
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  await db.insert(boardMembers).values({ boardId: board.id, userId: member.id, role: "member" });

  const column = await createColumn({ boardId: board.id, name: "To Do", userId: owner.id });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Theirs",
    userId: member.id,
  });
  await assignCard({ cardId: card.id, assigneeId: member.id, userId: owner.id });
  const comment = await addComment({ cardId: card.id, body: "Mine", userId: member.id });

  return { owner, member, board, column, card, comment };
}

test("removing a member keeps their content but detaches its attribution", async () => {
  const { owner, member, board, card, comment } = await boardWithMemberContent();

  await removeMember({ boardId: board.id, userId: member.id, actorId: owner.id });

  // The content survives — removal is not deletion (D5).
  const cards = await listCards(board.id);
  expect(cards.map((c) => c.id)).toEqual([card.id]);
  const comments = await listComments(card.id);
  expect(comments.map((c) => c.id)).toEqual([comment.id]);

  // ...but nothing on the board still names them.
  const [storedCard] = cards;
  expect(storedCard.createdById).toBeNull();
  expect(storedCard.assigneeId).toBeNull();
  expect(comments[0].authorId).toBeNull();
  // Which is what makes the thread render them as a former member.
  expect(comments[0].author).toBeNull();
});

test("removal leaves the user account and their work on other boards alone", async () => {
  const { owner, member, board } = await boardWithMemberContent();

  // The same person is a member of a second board, with content there too.
  const other = await createBoard({ name: "Other", ownerId: owner.id });
  await db.insert(boardMembers).values({ boardId: other.id, userId: member.id, role: "member" });
  const otherColumn = await createColumn({ boardId: other.id, name: "To Do", userId: owner.id });
  const otherCard = await createCard({
    boardId: other.id,
    columnId: otherColumn.id,
    title: "Elsewhere",
    userId: member.id,
  });
  const otherComment = await addComment({
    cardId: otherCard.id,
    body: "Also mine",
    userId: member.id,
  });

  await removeMember({ boardId: board.id, userId: member.id, actorId: owner.id });

  // The account itself is untouched — this is a membership removal, not a delete.
  const [stillThere] = await db.select().from(users).where(eq(users.id, member.id));
  expect(stillThere?.id).toBe(member.id);

  // And the other board's attribution is exactly as it was.
  const [elsewhere] = await listCards(other.id);
  expect(elsewhere.createdById).toBe(member.id);
  const [stillMine] = await listComments(otherCard.id);
  expect(stillMine.authorId).toBe(member.id);
  expect(stillMine.id).toBe(otherComment.id);
});
