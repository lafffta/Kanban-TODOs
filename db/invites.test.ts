import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardInvites, boardMembers, boards } from "./schema";
import {
  createBoard,
  listBoardMembers,
  removeMember,
  requireBoardMember,
} from "./boards";
import { acceptInvite, createInvite, listPendingInvites, reviewInvite } from "./invites";

// Invites integration test: proves an owner can mint an email-bound single-use
// invite, that a member cannot, and that accepting one grants membership exactly
// once — the token being the trust boundary (D6: crypto-random, single-use, 7-day
// expiry). Requires the Docker Postgres from docker-compose.yml.

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await closeDb();
});

function uniqueEmail() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function makeUser(email = uniqueEmail()) {
  return registerUser({ email, password: "correct horse battery" });
}

async function makeBoard() {
  const owner = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  return { owner, board };
}

test("an owner mints an invite with a crypto-random token and a 7-day expiry", async () => {
  const { owner, board } = await makeBoard();

  const before = Date.now();
  const invite = await createInvite({
    boardId: board.id,
    email: "Teammate@Example.com",
    role: "member",
    userId: owner.id,
  });

  expect(invite.boardId).toBe(board.id);
  expect(invite.role).toBe("member");
  expect(invite.invitedById).toBe(owner.id);
  expect(invite.acceptedAt).toBeNull();
  // Stored lowercased so the accept-time match is case-insensitive.
  expect(invite.email).toBe("teammate@example.com");
  // Unguessable: 32 random bytes, base64url-encoded.
  expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  expect(invite.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDays - 5_000);
  expect(invite.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + sevenDays);
});

test("two invites never share a token", async () => {
  const { owner, board } = await makeBoard();
  const first = await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });
  const second = await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });
  expect(first.token).not.toBe(second.token);
});

test("a plain member cannot mint an invite", async () => {
  const { board } = await makeBoard();
  const member = await makeUser();
  await db.insert(boardMembers).values({
    boardId: board.id,
    userId: member.id,
    role: "member",
  });

  await expect(
    createInvite({
      boardId: board.id,
      email: uniqueEmail(),
      role: "member",
      userId: member.id,
    }),
  ).rejects.toMatchObject({ name: "BoardAccessError" });
});

test("accepting an invite makes the invitee a member with the invited role", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    // Cased differently from the account's address: the match is case-insensitive.
    email: invitee.email.toUpperCase(),
    role: "member",
    userId: owner.id,
  });

  const result = await acceptInvite({ token: invite.token, userId: invitee.id });

  expect(result).toEqual({ boardId: board.id, alreadyMember: false });
  const membership = await requireBoardMember(board.id, invitee.id);
  expect(membership.role).toBe("member");
  // The token is spent.
  const [spent] = await db
    .select()
    .from(boardInvites)
    .where(eq(boardInvites.id, invite.id));
  expect(spent.acceptedAt).not.toBeNull();
});

test("an account signed up in mixed case still matches its invite", async () => {
  const { owner, board } = await makeBoard();
  // The invitee typed their address with capitals at sign-up; the owner typed it
  // in lowercase. Both sides canonicalize to the same identity (ticket 14).
  const typedAtSignUp = uniqueEmail().toUpperCase();
  const invitee = await makeUser(typedAtSignUp);
  const invite = await createInvite({
    boardId: board.id,
    email: typedAtSignUp.toLowerCase(),
    role: "member",
    userId: owner.id,
  });

  expect((await reviewInvite(invite.token, invitee.id)).state).toBe("acceptable");
  const result = await acceptInvite({ token: invite.token, userId: invitee.id });
  expect(result.alreadyMember).toBe(false);
  expect((await requireBoardMember(board.id, invitee.id)).role).toBe("member");

  // And the owner can't re-invite them under yet another casing.
  await expect(
    createInvite({
      boardId: board.id,
      email: ` ${typedAtSignUp} `,
      role: "member",
      userId: owner.id,
    }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "already-a-member" });
});

test("an invite can mint a co-owner", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "owner",
    userId: owner.id,
  });

  await acceptInvite({ token: invite.token, userId: invitee.id });

  expect((await requireBoardMember(board.id, invitee.id, "owner")).role).toBe("owner");
});

test("accepting twice is idempotent — no duplicate membership, no error", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });

  await acceptInvite({ token: invite.token, userId: invitee.id });
  const second = await acceptInvite({ token: invite.token, userId: invitee.id });

  expect(second).toEqual({ boardId: board.id, alreadyMember: true });
  expect(await listBoardMembers(board.id)).toHaveLength(2);
  expect((await requireBoardMember(board.id, invitee.id)).role).toBe("member");
});

test("a removed member can't walk back in on the spent link", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });
  await acceptInvite({ token: invite.token, userId: invitee.id });

  await removeMember({ boardId: board.id, userId: invitee.id, actorId: owner.id });

  await expect(
    acceptInvite({ token: invite.token, userId: invitee.id }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "already-used" });
  await expect(requireBoardMember(board.id, invitee.id)).rejects.toMatchObject({
    name: "BoardAccessError",
  });
});

test("presenting an invite you've already accepted spends it", async () => {
  // Otherwise a second, never-clicked link stays live as a way back onto a board
  // the owner later removed you from.
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const first = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });
  await acceptInvite({ token: first.token, userId: invitee.id });

  // A second link, minted before the first was accepted, presented afterwards.
  const [second] = await db
    .insert(boardInvites)
    .values({
      boardId: board.id,
      email: invitee.email.toLowerCase(),
      token: `second-link-${crypto.randomUUID()}`,
      role: "member",
      invitedById: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();

  expect((await acceptInvite({ token: second.token, userId: invitee.id })).alreadyMember).toBe(true);

  await removeMember({ boardId: board.id, userId: invitee.id, actorId: owner.id });
  await expect(
    acceptInvite({ token: second.token, userId: invitee.id }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "already-used" });
});

test("two accepts racing for one token admit exactly one member", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });

  const results = await Promise.allSettled([
    acceptInvite({ token: invite.token, userId: invitee.id }),
    acceptInvite({ token: invite.token, userId: invitee.id }),
  ]);

  // Exactly one call mints the membership. The other either loses the race for the
  // `acceptedAt` stamp (refused) or arrives after it (a no-op reporting
  // `alreadyMember`) — which of the two depends on timing, but never both minting.
  const admitted = results.filter(
    (r) => r.status === "fulfilled" && !r.value.alreadyMember,
  );
  expect(admitted).toHaveLength(1);
  expect(await listBoardMembers(board.id)).toHaveLength(2);
});

test("an owner can't invite someone who is already a member", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });
  await acceptInvite({ token: invite.token, userId: invitee.id });

  // Including under a different casing — the same account either way (D2).
  await expect(
    createInvite({
      boardId: board.id,
      email: invitee.email.toUpperCase(),
      role: "owner",
      userId: owner.id,
    }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "already-a-member" });
});

test("an invite is refused when the signed-in email doesn't match", async () => {
  const { owner, board } = await makeBoard();
  const stranger = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });

  await expect(
    acceptInvite({ token: invite.token, userId: stranger.id }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "email-mismatch" });
  await expect(requireBoardMember(board.id, stranger.id)).rejects.toMatchObject({
    name: "BoardAccessError",
  });
});

test("an expired invite is refused", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });
  await db
    .update(boardInvites)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(boardInvites.id, invite.id));

  await expect(
    acceptInvite({ token: invite.token, userId: invitee.id }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "expired" });
});

test("an unknown token is refused", async () => {
  const invitee = await makeUser();
  await expect(
    acceptInvite({ token: "no-such-token", userId: invitee.id }),
  ).rejects.toMatchObject({ name: "InviteError", reason: "not-found" });
});

test("reviewing an invite reports what the accept screen should show", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const stranger = await makeUser();
  const invite = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });

  const acceptable = await reviewInvite(invite.token, invitee.id);
  expect(acceptable.state).toBe("acceptable");
  expect(acceptable.invite?.boardName).toBe(board.name);
  expect(acceptable.invite?.role).toBe("member");

  expect(await reviewInvite(invite.token, stranger.id)).toMatchObject({
    state: "rejected",
    reason: "email-mismatch",
  });
  expect(await reviewInvite("no-such-token", invitee.id)).toMatchObject({
    state: "rejected",
    reason: "not-found",
    invite: null,
  });

  await acceptInvite({ token: invite.token, userId: invitee.id });
  expect(await reviewInvite(invite.token, invitee.id)).toMatchObject({
    state: "already-member",
  });
});

test("an owner sees their live invites and no spent or expired ones", async () => {
  const { owner, board } = await makeBoard();
  const invitee = await makeUser();
  const live = await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });
  const spent = await createInvite({
    boardId: board.id,
    email: invitee.email,
    role: "member",
    userId: owner.id,
  });
  const stale = await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });

  await acceptInvite({ token: spent.token, userId: invitee.id });
  await db
    .update(boardInvites)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(boardInvites.id, stale.id));

  expect((await listPendingInvites(board.id, owner.id)).map((i) => i.id)).toEqual([
    live.id,
  ]);
  // The tokens are owner-only: a member can't list them.
  await expect(
    listPendingInvites(board.id, invitee.id),
  ).rejects.toMatchObject({ name: "BoardAccessError", reason: "insufficient-role" });
});

test("deleting a board cascades its invites (D5)", async () => {
  const { owner, board } = await makeBoard();
  await createInvite({
    boardId: board.id,
    email: uniqueEmail(),
    role: "member",
    userId: owner.id,
  });

  await db.delete(boards).where(eq(boards.id, board.id));
  expect(
    await db.select().from(boardInvites).where(eq(boardInvites.boardId, board.id)),
  ).toEqual([]);
});
