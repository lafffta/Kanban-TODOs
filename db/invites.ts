import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { boardRoleSchema, membershipOf, requireBoardMember } from "./boards";
import { canonicalEmail, canonicalEmailSql } from "./email";
import {
  boardInvites,
  boards,
  boardMembers,
  users,
  type BoardInvite,
  type BoardRole,
} from "./schema";

/** How long a minted invite stays acceptable (D2/D6). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Zod shape for minting an invite — the boundary check for the owner's form. */
export const createInviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: boardRoleSchema,
});

/**
 * A crypto-random invite token — the trust boundary (D6). 32 bytes from the
 * CSPRNG, base64url-encoded so it survives a URL path segment untouched.
 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Mint an invite to a board. Owner-only (D1) — enforced through the
 * `requireBoardMember` seam with `minRole: 'owner'`, so a plain member is refused
 * with `BoardAccessError`. The caller shares the resulting token out-of-band; there
 * is no email infrastructure in v1 (D2).
 *
 * Someone already on the board is refused (`already-a-member`) rather than sent a
 * link that could only ever say "you're already in": an invite grants membership,
 * and changing an existing member's role is the members list's job, not a link's.
 */
export async function createInvite(input: {
  boardId: string;
  email: string;
  role: BoardRole;
  userId: string;
}): Promise<BoardInvite> {
  await requireBoardMember(input.boardId, input.userId, "owner");

  const email = canonicalEmail(input.email);
  const [existing] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(
      and(
        eq(boardMembers.boardId, input.boardId),
        eq(canonicalEmailSql(users.email), email),
      ),
    )
    .limit(1);
  if (existing) throw new InviteError("already-a-member");

  const [invite] = await db
    .insert(boardInvites)
    .values({
      boardId: input.boardId,
      email,
      token: mintToken(),
      role: input.role,
      invitedById: input.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  return invite;
}

/**
 * A board's invites that are still live — neither accepted nor expired — oldest
 * first, so the owner can re-copy a link they've already minted. Owner-only, for
 * the same reason minting is: the rows carry the tokens.
 */
export async function listPendingInvites(
  boardId: string,
  userId: string,
): Promise<BoardInvite[]> {
  await requireBoardMember(boardId, userId, "owner");
  return db
    .select()
    .from(boardInvites)
    .where(
      and(
        eq(boardInvites.boardId, boardId),
        isNull(boardInvites.acceptedAt),
        gt(boardInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(boardInvites.createdAt));
}

/**
 * Why an invite was refused — at mint time (`already-a-member`) or at accept time
 * (the rest). Each maps to a message in `INVITE_REJECTION_MESSAGE`. The token
 * itself is deliberately not carried anywhere near these: a rejection is logged,
 * and a secret in a log is a secret leaked.
 */
export type InviteRejection =
  | "not-found"
  | "expired"
  | "already-used"
  | "email-mismatch"
  | "already-a-member";

/**
 * Thrown when an invite can't be minted or accepted. Carries the `reason` so each
 * surface can say *why* — a wrong-account mismatch reads very differently from an
 * expired link.
 */
export class InviteError extends Error {
  constructor(readonly reason: InviteRejection) {
    super(`Invite refused (${reason})`);
    this.name = "InviteError";
  }
}

/** What each refusal means to the person it's shown to. */
export const INVITE_REJECTION_MESSAGE: Record<InviteRejection, string> = {
  "not-found": "That invite link isn't valid. Ask the board owner for a new one.",
  expired: "That invite has expired. Ask the board owner for a new link.",
  "already-used": "That invite has already been used.",
  "email-mismatch":
    "This invite was sent to a different email address. Sign in as the invited account to accept it.",
  "already-a-member":
    "They're already a member of this board — change their role from the members list instead.",
};

/** An invite plus the board's name — enough to render the accept screen. */
export type InviteView = BoardInvite & { boardName: string };

/**
 * What the accept screen should show a given signed-in user: the invite is
 * acceptable, they are already a member (so accepting is a no-op — D2's
 * idempotency), or it is rejected with a reason. `acceptInvite` decides through
 * this same review, so the screen never offers an accept the mutation would refuse.
 */
export type InviteReview =
  | { state: "acceptable"; invite: InviteView }
  | { state: "already-member"; invite: InviteView }
  | { state: "rejected"; reason: InviteRejection; invite: InviteView | null };

/** An invite by its token, with the board's name, or null if the token is unknown. */
async function findInvite(token: string): Promise<InviteView | null> {
  const [row] = await db
    .select({ invite: boardInvites, boardName: boards.name })
    .from(boardInvites)
    .innerJoin(boards, eq(boards.id, boardInvites.boardId))
    .where(eq(boardInvites.token, token))
    .limit(1);
  return row ? { ...row.invite, boardName: row.boardName } : null;
}

/**
 * Review an invite for a signed-in user — the single place the acceptance rules
 * live (D2/D6), shared by the accept screen and `acceptInvite`.
 *
 * Membership is checked before the token's own state, so an invitee who already
 * joined is told so rather than being shown a scary "already used" — that's what
 * makes accepting idempotent. Email binding is checked first of all: it's the
 * guardrail against joining on the wrong account, and it's the one rejection the
 * user can act on (sign in as the invited address).
 */
export async function reviewInvite(token: string, userId: string): Promise<InviteReview> {
  const invite = await findInvite(token);
  if (!invite) return { state: "rejected", reason: "not-found", invite: null };

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || canonicalEmail(user.email) !== invite.email) {
    return { state: "rejected", reason: "email-mismatch", invite };
  }

  const [membership] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(membershipOf(invite.boardId, userId))
    .limit(1);
  if (membership) return { state: "already-member", invite };

  if (invite.acceptedAt) return { state: "rejected", reason: "already-used", invite };
  if (invite.expiresAt.getTime() <= Date.now()) {
    return { state: "rejected", reason: "expired", invite };
  }
  return { state: "acceptable", invite };
}

/** Stamp an invite spent, reporting whether this call is the one that spent it. */
async function spend(
  tx: Pick<typeof db, "update">,
  inviteId: string,
): Promise<boolean> {
  const stamped = await tx
    .update(boardInvites)
    .set({ acceptedAt: new Date() })
    .where(and(eq(boardInvites.id, inviteId), isNull(boardInvites.acceptedAt)))
    .returning({ id: boardInvites.id });
  return stamped.length > 0;
}

/**
 * Accept an invite, joining the signed-in user to the board with the invited role.
 * Refused with an `InviteError` unless `reviewInvite` says it's acceptable.
 *
 * Single-use is enforced by the stamp itself, not by the earlier read: the
 * transaction inserts the membership only if it wins the race to set `acceptedAt`
 * (`WHERE accepted_at IS NULL`), so two concurrent accepts of one token can never
 * both mint a member.
 *
 * Presenting an invite you've already accepted is a no-op that reports
 * `alreadyMember` (D2's idempotency) — but it *still* spends the token, so a link
 * can't sit unspent as a way back onto a board the owner later removed you from.
 */
export async function acceptInvite(input: {
  token: string;
  userId: string;
}): Promise<{ boardId: string; alreadyMember: boolean }> {
  const review = await reviewInvite(input.token, input.userId);
  if (review.state === "rejected") throw new InviteError(review.reason);

  const { invite } = review;
  if (review.state === "already-member") {
    await spend(db, invite.id);
    return { boardId: invite.boardId, alreadyMember: true };
  }

  return db.transaction(async (tx) => {
    if (!(await spend(tx, invite.id))) throw new InviteError("already-used");
    await tx
      .insert(boardMembers)
      .values({ boardId: invite.boardId, userId: input.userId, role: invite.role })
      .onConflictDoNothing();
    return { boardId: invite.boardId, alreadyMember: false };
  });
}
