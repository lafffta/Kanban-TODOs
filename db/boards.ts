import { and, asc, desc, eq } from "drizzle-orm";
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

/** Zod shape for creating a board — the boundary check for the create mutation. */
export const createBoardSchema = z.object({
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
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    throw new BoardAccessError("not-a-member", boardId, userId);
  }
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new BoardAccessError("insufficient-role", boardId, userId);
  }
  return membership;
}
