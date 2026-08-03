import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import {
  boardMembers,
  boards,
  users,
  type Board,
  type BoardMember,
  type BoardRole,
  type UserProfile,
} from "./schema";

/**
 * A board member: their display profile (`id` + avatar/label fields) plus the
 * `role` they hold. Feeds the assignee picker and card-face avatars.
 */
export type BoardMemberProfile = UserProfile & { role: BoardRole };

/** Role ranking for `minRole` comparisons: an owner outranks a member. */
const ROLE_RANK: Record<BoardRole, number> = { member: 1, owner: 2 };

/**
 * The rank of a stored role. `role` is a text column, so a value outside the two
 * we know is conceivable (a bad migration, a future role); it ranks below
 * everything rather than passing a `minRole` gate by comparing as `undefined`.
 */
function rankOf(role: BoardRole): number {
  return ROLE_RANK[role] ?? 0;
}

/**
 * Zod shape for a role arriving from a client — the boundary check for the invite
 * and role-change actions, which would otherwise write an arbitrary string into
 * the `role` text column.
 */
export const boardRoleSchema = z.enum(["owner", "member"]);

/** The "this user's row on this board" predicate every membership query needs. */
export function membershipOf(boardId: string, userId: string): SQL | undefined {
  return and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId));
}

export type BoardAccessReason = "not-a-member" | "insufficient-role";

/**
 * Thrown by `requireBoardMember` when access is denied. It carries *why* and
 * *who/what* so each surface can translate it: route handlers → 403, pages and
 * server actions → redirect. The seam itself stays response-agnostic.
 */
export class BoardAccessError extends Error {
  constructor(
    readonly reason: BoardAccessReason,
    readonly boardId: string,
    readonly userId: string,
  ) {
    super(`Board access denied (${reason}) for user ${userId} on board ${boardId}`);
    this.name = "BoardAccessError";
  }
}

/**
 * Zod shape for a board name — the boundary check shared by create and rename, so
 * a board can't be renamed to something it could never have been created as.
 */
export const boardNameSchema = z.object({
  name: z.string().trim().min(1, "Board name is required.").max(100),
});

/**
 * Create a board and, in the same transaction, make the creator its `owner`
 * member. The `board_members` row — not `boards.ownerId` — is the source of
 * truth consulted by `requireBoardMember`, so the two must never diverge; the
 * transaction guarantees a board is never created without its owner membership.
 */
export async function createBoard(input: {
  name: string;
  ownerId: string;
}): Promise<Board> {
  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({ name: input.name, ownerId: input.ownerId })
      .returning();
    await tx
      .insert(boardMembers)
      .values({ boardId: board.id, userId: input.ownerId, role: "owner" });
    return board;
  });
}

/** A board by id, or null if it doesn't exist. Access is gated separately by
 * `requireBoardMember`; this is the plain row lookup callers use after that. */
export async function getBoard(boardId: string): Promise<Board | null> {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  return board ?? null;
}

/** Boards the user is a member of, newest first. */
export async function listBoardsForUser(userId: string): Promise<Board[]> {
  const rows = await db
    .select({ board: boards })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(eq(boardMembers.userId, userId))
    .orderBy(desc(boards.createdAt));
  return rows.map((r) => r.board);
}

/**
 * A board's members with their display profiles, owners first then by join time.
 * Feeds the assignee picker and card avatars; call after the caller's own
 * membership has been verified with `requireBoardMember`.
 */
export async function listBoardMembers(boardId: string): Promise<BoardMemberProfile[]> {
  const rows = await db
    .select({
      id: users.id,
      role: boardMembers.role,
      name: users.name,
      email: users.email,
      image: users.image,
      createdAt: boardMembers.createdAt,
    })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(desc(boardMembers.role), asc(boardMembers.createdAt));
  return rows.map(({ createdAt: _createdAt, ...profile }) => profile);
}

/**
 * The single access-control seam for board-scoped reads and mutations. Returns
 * the caller's membership on success; throws `BoardAccessError` if they are not a
 * member, or hold a role below `minRole`. Every board server action and route
 * handler funnels through here so a non-member can never touch a board.
 */
export async function requireBoardMember(
  boardId: string,
  userId: string,
  minRole: BoardRole = "member",
): Promise<BoardMember> {
  const [membership] = await db
    .select()
    .from(boardMembers)
    .where(membershipOf(boardId, userId))
    .limit(1);

  if (!membership) {
    throw new BoardAccessError("not-a-member", boardId, userId);
  }
  if (rankOf(membership.role) < rankOf(minRole)) {
    throw new BoardAccessError("insufficient-role", boardId, userId);
  }
  return membership;
}

/**
 * Rename a board (owner-only, D1 — a member does all *content* work but no
 * governance). The name is validated at the action boundary with
 * `boardNameSchema`; this layer's job is the owner gate and the write.
 */
export async function renameBoard(input: {
  boardId: string;
  name: string;
  actorId: string;
}): Promise<Board> {
  await requireBoardMember(input.boardId, input.actorId, "owner");

  const [updated] = await db
    .update(boards)
    .set({ name: input.name })
    .where(eq(boards.id, input.boardId))
    .returning();
  return updated;
}

/**
 * Delete a board permanently (owner-only, D1). Everything the board owns —
 * memberships, invites, columns, cards, comments — goes with it through the
 * schema's `ON DELETE CASCADE` chain (D5), so this is one statement rather than a
 * hand-rolled teardown that could drift from the schema. The confirmation the
 * deletion needs is the UI's job.
 */
export async function deleteBoard(input: {
  boardId: string;
  actorId: string;
}): Promise<void> {
  await requireBoardMember(input.boardId, input.actorId, "owner");
  await db.delete(boards).where(eq(boards.id, input.boardId));
}

/** Why a membership change was refused — distinct from *who* may make it. */
export type MembershipRejection = "not-a-member" | "board-creator";

/**
 * Thrown when an owner's membership change can't be applied to its target: the
 * target isn't a member, or it's the board's creator, whose owner row is what
 * guarantees the board always has someone who can govern it (D5 — no ownership
 * transfer in v1). Distinct from `BoardAccessError`, which is about the *caller*.
 */
export class MembershipError extends Error {
  constructor(
    readonly reason: MembershipRejection,
    readonly boardId: string,
    readonly userId: string,
  ) {
    super(`Membership change refused (${reason}) for user ${userId} on board ${boardId}`);
    this.name = "MembershipError";
  }
}

/**
 * Confirm an owner-only membership change may target this user: the caller must
 * own the board, the target must currently be a member, and the target must not be
 * the board's creator. Shared by remove and role-change so the two can't drift.
 */
async function requireManageableMember(input: {
  boardId: string;
  userId: string;
  actorId: string;
}): Promise<void> {
  await requireBoardMember(input.boardId, input.actorId, "owner");

  const board = await getBoard(input.boardId);
  if (board?.ownerId === input.userId) {
    throw new MembershipError("board-creator", input.boardId, input.userId);
  }

  const [target] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(membershipOf(input.boardId, input.userId))
    .limit(1);
  if (!target) throw new MembershipError("not-a-member", input.boardId, input.userId);
}

/**
 * Remove a member from a board (owner-only, D1). Their cards and comments stay —
 * the board keeps its history (D5) — but their card *assignments* go, since a stale
 * assignee would show a non-member's avatar on the board.
 *
 * Clearing those assignments is the one statement's own doing:
 * `cards_assignee_board_member_fk` is `ON DELETE SET NULL (assignee_id)`, so the
 * delete and the unassignment are the same atomic act. Clearing them here first
 * would look equivalent but wouldn't be — an assignment committing between the two
 * statements would survive the removal, which is exactly the race this replaced.
 */
export async function removeMember(input: {
  boardId: string;
  userId: string;
  actorId: string;
}): Promise<void> {
  await requireManageableMember(input);

  await db.delete(boardMembers).where(membershipOf(input.boardId, input.userId));
}

/**
 * Change a member's role (owner-only, D1) — promote a member to co-owner or demote
 * one back. The board's creator is not a valid target, so a board can never be left
 * without an owner.
 */
export async function changeMemberRole(input: {
  boardId: string;
  userId: string;
  role: BoardRole;
  actorId: string;
}): Promise<void> {
  await requireManageableMember(input);

  await db
    .update(boardMembers)
    .set({ role: input.role })
    .where(membershipOf(input.boardId, input.userId));
}
