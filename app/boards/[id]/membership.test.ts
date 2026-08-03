import { expect, test } from "vitest";
import type { BoardMemberProfile } from "@/db/boards";
import type { BoardRole } from "@/db/schema";
import { canDeleteComment, canManageMember, projectMembership } from "./membership";

// The live membership projection (ticket 17). Every board surface — the members
// panel, the assignee picker, the heading's owner controls, the comment thread —
// asks these two functions what the viewer may do, so a role that changed under
// them changes the UI on the next poll rather than on the next reload. Server-side
// authorization is unchanged and remains the source of truth; this decides what to
// *offer*.

function member(id: string, role: BoardRole): BoardMemberProfile {
  return { id, role, name: id, email: `${id}@example.com`, image: null };
}

// Ada created the board, so her owner row is the one nobody may touch (D5).
const ada = member("ada", "owner");
const bob = member("bob", "member");

/** The board's people as `viewerId` sees them, with Ada as the board's creator. */
function seenBy(members: BoardMemberProfile[], viewerId: string) {
  return projectMembership(members, viewerId, ada.id);
}

test("the viewer's role comes from the member list, not from a prop set at render", () => {
  const asBob = seenBy([ada, bob], "bob");
  expect(asBob.role).toBe("member");
  expect(asBob.isOwner).toBe(false);

  // The same viewer, one poll later, after the owner promoted them. Nothing about
  // the viewer changed — only the list they were projected against.
  const promoted = seenBy([ada, member("bob", "owner")], "bob");
  expect(promoted.role).toBe("owner");
  expect(promoted.isOwner).toBe(true);

  // …and back down again.
  const demoted = seenBy([ada, bob], "bob");
  expect(demoted.isOwner).toBe(false);
});

test("the projection carries the whole member list, so every surface renders one thing", () => {
  const projection = seenBy([ada, bob], "ada");
  expect(projection.members).toEqual([ada, bob]);
  expect(projection.self).toEqual(ada);
});

test("a viewer who is no longer a member holds no role and no controls", () => {
  const removed = seenBy([ada, bob], "cleo");
  expect(removed.self).toBeNull();
  expect(removed.role).toBeNull();
  expect(removed.isOwner).toBe(false);
});

test("a member deletes their own comments; an owner deletes anyone's (D1)", () => {
  const asBob = seenBy([ada, bob], "bob");
  expect(canDeleteComment(asBob, "bob")).toBe(true);
  expect(canDeleteComment(asBob, "ada")).toBe(false);

  const asAda = seenBy([ada, bob], "ada");
  expect(canDeleteComment(asAda, "bob")).toBe(true);
  expect(canDeleteComment(asAda, "ada")).toBe(true);
});

test("only an owner deletes a former member's comment, which has no author left", () => {
  expect(canDeleteComment(seenBy([ada, bob], "bob"), null)).toBe(false);
  expect(canDeleteComment(seenBy([ada, bob], "ada"), null)).toBe(true);
});

test("a viewer off the board deletes nothing, not even what they wrote", () => {
  const removed = seenBy([ada, bob], "cleo");
  expect(canDeleteComment(removed, "cleo")).toBe(false);
});

test("only an owner may remove or re-role a member (D1)", () => {
  const cleo = member("cleo", "member");
  expect(canManageMember(seenBy([ada, bob, cleo], "bob"), "cleo")).toBe(false);
  expect(canManageMember(seenBy([ada, bob, cleo], "ada"), "cleo")).toBe(true);

  // Promoting Bob hands him the controls over Cleo on his next poll.
  const bobPromoted = [ada, member("bob", "owner"), cleo];
  expect(canManageMember(seenBy(bobPromoted, "bob"), "cleo")).toBe(true);
});

test("nobody may remove or demote the board's creator (D5 — no ownership transfer)", () => {
  // Not even the creator themselves, and not a co-owner they promoted.
  expect(canManageMember(seenBy([ada, bob], "ada"), "ada")).toBe(false);
  expect(
    canManageMember(seenBy([ada, member("bob", "owner")], "bob"), "ada"),
  ).toBe(false);
});
