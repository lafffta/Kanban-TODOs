import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers } from "./schema";
import {
  BoardAccessError,
  createBoard,
  listBoardsForUser,
  requireBoardMember,
} from "./boards";

// Boards + membership integration test: proves creating a board makes the creator
// an `owner` member, that board listing is scoped to membership (two users each
// see only their own), and that the `requireBoardMember` access-control seam
// admits members, refuses non-members, and enforces `minRole`. Requires the
// Docker Postgres from docker-compose.yml.

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
