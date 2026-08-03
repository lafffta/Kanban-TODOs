import type { BoardMemberProfile } from "@/db/boards";
import type { BoardRole } from "@/db/schema";

/**
 * The board's people as they bear on the viewer: the one list every surface
 * renders, and the standing the viewer holds among them.
 *
 * It is derived from the *polled* board payload rather than captured when the page
 * was server-rendered, which is the whole point — a role is not a property of the
 * session, it is a row another owner can change while you are looking at the board
 * (ticket 17). Projecting it fresh on every payload is what makes a promotion or a
 * demotion arrive within a polling interval (D4).
 *
 * This decides what the UI *offers*. What is *permitted* is decided server-side by
 * `requireBoardMember` on every action and route handler, against the row as it
 * stands at that moment — so a client holding a stale projection, or a doctored
 * one, still cannot act outside its role.
 */
export type BoardMembership = {
  /** Everyone on the board, owners first — members panel, avatars, assignee picker. */
  members: BoardMemberProfile[];
  /** The viewer's own row, or null if they no longer hold one. */
  self: BoardMemberProfile | null;
  /** The viewer's role, or null if they are no longer a member. */
  role: BoardRole | null;
  /** Whether the viewer may govern: invite, remove, set roles, rename/delete (D1). */
  isOwner: boolean;
  /** Who created the board — the one membership nobody may remove or demote (D5). */
  creatorId: string;
};

/** Read one viewer's standing out of a board's member list. */
export function projectMembership(
  members: BoardMemberProfile[],
  viewerId: string,
  creatorId: string,
): BoardMembership {
  const self = members.find((member) => member.id === viewerId) ?? null;
  return {
    members,
    self,
    role: self?.role ?? null,
    isOwner: self?.role === "owner",
    creatorId,
  };
}

/**
 * Whether the viewer may remove this member or change their role. The client-side
 * mirror of the db layer's `requireManageableMember`: the viewer must own the
 * board, and the target must not be its creator — that owner row is what keeps the
 * board governed, so it can neither be removed nor demoted (D5, no ownership
 * transfer in v1). The db layer refuses either way; this is what the panel offers.
 */
export function canManageMember(
  membership: BoardMembership,
  memberId: string,
): boolean {
  return membership.isOwner && memberId !== membership.creatorId;
}

/**
 * Whether the viewer may delete a comment: their own, or anyone's if they own the
 * board (D1). `authorId` is null for a former member whose account is gone, so
 * their comments are an owner's to remove. Someone no longer on the board deletes
 * nothing — not even what they wrote — which is what the server would tell them.
 */
export function canDeleteComment(
  membership: BoardMembership,
  authorId: string | null,
): boolean {
  if (!membership.self) return false;
  return membership.isOwner || authorId === membership.self.id;
}
