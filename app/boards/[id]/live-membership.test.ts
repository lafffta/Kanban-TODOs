import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "@/db/index";
import { registerUser } from "@/db/auth";
import { boardMembers } from "@/db/schema";
import { changeMemberRole, createBoard } from "@/db/boards";
import { boardVersion, getBoardSnapshot } from "@/db/board-snapshot";
import { serializeBoard } from "./board-data";
import { canDeleteComment, canManageMember, projectMembership } from "./membership";

// The whole of ticket 17 in one place: a role changed in the database, carried by
// the version token, arriving as a capability on another user's screen.
//
// `membership.test.ts` covers the projection against hand-built lists; this covers
// the chain those lists come from — the write, `boardVersion`, `getBoardSnapshot`,
// `serializeBoard`, `projectMembership` — which is where the bug this ticket fixes
// lived. A capability captured once at server render would still pass the unit
// tests; it cannot pass these. The only step not exercised is React re-rendering on
// the new payload, which `BoardProvider` gets from `useQuery` holding it as state.
//
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

/** A board with its creator and one plain member — the two-person case D1 is about. */
async function makeSharedBoard() {
  const creator = await makeUser();
  const teammate = await makeUser();
  const board = await createBoard({ name: "Roadmap", ownerId: creator.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: teammate.id, role: "member" });
  return { creator, teammate, board };
}

/**
 * What one user's next poll would hand their UI: the payload the board API serves,
 * projected into the viewer's standing. Exactly the path `BoardProvider` takes.
 */
async function poll(boardId: string, viewerId: string) {
  const snapshot = await getBoardSnapshot(boardId);
  const payload = serializeBoard(snapshot!);
  return projectMembership(payload.members, viewerId, payload.board.ownerId);
}

test("a promoted member's own next poll hands them owner capabilities", async () => {
  const { creator, teammate, board } = await makeSharedBoard();

  const before = await poll(board.id, teammate.id);
  expect(before.isOwner).toBe(false);
  // Nothing governance-shaped on offer: no board rename/delete, no member controls,
  // and only their own comments to remove.
  expect(canManageMember(before, creator.id)).toBe(false);
  expect(canDeleteComment(before, creator.id)).toBe(false);

  const versionSeen = (await getBoardSnapshot(board.id))!.version;
  await changeMemberRole({
    boardId: board.id,
    userId: teammate.id,
    role: "owner",
    actorId: creator.id,
  });

  // The cheap poll is what triggers the refetch — without this the payload below is
  // one the client would never go and ask for.
  expect(await boardVersion(board.id)).not.toBe(versionSeen);

  const after = await poll(board.id, teammate.id);
  expect(after.isOwner).toBe(true);
  expect(canDeleteComment(after, creator.id)).toBe(true);
  // …but still not over the creator, whose row keeps the board governed (D5).
  expect(canManageMember(after, creator.id)).toBe(false);
});

test("a demoted owner's own next poll takes those capabilities away again", async () => {
  const { creator, teammate, board } = await makeSharedBoard();
  await changeMemberRole({
    boardId: board.id,
    userId: teammate.id,
    role: "owner",
    actorId: creator.id,
  });

  const promoted = await poll(board.id, teammate.id);
  expect(promoted.isOwner).toBe(true);

  const versionSeen = (await getBoardSnapshot(board.id))!.version;
  await changeMemberRole({
    boardId: board.id,
    userId: teammate.id,
    role: "member",
    actorId: creator.id,
  });

  expect(await boardVersion(board.id)).not.toBe(versionSeen);

  const demoted = await poll(board.id, teammate.id);
  expect(demoted.isOwner).toBe(false);
  expect(canDeleteComment(demoted, creator.id)).toBe(false);
});

test("everyone else's poll sees the promotion too, with nobody joining or leaving", async () => {
  const { creator, teammate, board } = await makeSharedBoard();

  await changeMemberRole({
    boardId: board.id,
    userId: teammate.id,
    role: "owner",
    actorId: creator.id,
  });

  // The creator's own view of the board: the same list of people, one of them now
  // a co-owner. This is the case a member *count* cannot see.
  const asCreator = await poll(board.id, creator.id);
  expect(asCreator.members).toHaveLength(2);
  expect(asCreator.members.find((m) => m.id === teammate.id)?.role).toBe("owner");
});

test("the members list the panel renders is the list the assignee picker offers", async () => {
  const { creator, teammate, board } = await makeSharedBoard();

  // One projection, one list — the members panel, the card sheet's assignee picker
  // and the card-face avatars all read `membership.members`.
  const projection = await poll(board.id, creator.id);
  expect(projection.members.map((m) => m.id).sort()).toEqual(
    [creator.id, teammate.id].sort(),
  );
  expect(projection.self?.id).toBe(creator.id);
  expect(projection.creatorId).toBe(creator.id);
});
