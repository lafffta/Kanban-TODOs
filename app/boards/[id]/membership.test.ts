import { expect, test } from "vitest";
import type { BoardMemberProfile } from "@/db/boards";
import type { BoardRole } from "@/db/schema";
import { canDeleteComment, projectMembership } from "./membership";

// The live membership projection (ticket 17). Every board surface — the members
// panel, the assignee picker, the heading's owner controls, the comment thread —
// asks these two functions what the viewer may do, so a role that changed under
// them changes the UI on the next poll rather than on the next reload. Server-side
// authorization is unchanged and remains the source of truth; this decides what to
// *offer*.

function member(id: string, role: BoardRole): BoardMemberProfile {
  return { id, role, name: id, email: `${id}@example.com`, image: null };
}

const ada = member("ada", "owner");
const bob = member("bob", "member");

test("the viewer's role comes from the member list, not from a prop set at render", () => {
  const asBob = projectMembership([ada, bob], "bob");
  expect(asBob.role).toBe("member");
  expect(asBob.isOwner).toBe(false);

  // The same viewer, one poll later, after the owner promoted them. Nothing about
  // the viewer changed — only the list they were projected against.
  const promoted = projectMembership([ada, member("bob", "owner")], "bob");
  expect(promoted.role).toBe("owner");
  expect(promoted.isOwner).toBe(true);

  // …and back down again.
  const demoted = projectMembership([ada, bob], "bob");
  expect(demoted.isOwner).toBe(false);
});

test("the projection carries the whole member list, so every surface renders one thing", () => {
  const projection = projectMembership([ada, bob], "ada");
  expect(projection.members).toEqual([ada, bob]);
  expect(projection.self).toEqual(ada);
});

test("a viewer who is no longer a member holds no role and no controls", () => {
  const removed = projectMembership([ada, bob], "cleo");
  expect(removed.self).toBeNull();
  expect(removed.role).toBeNull();
  expect(removed.isOwner).toBe(false);
});

test("a member deletes their own comments; an owner deletes anyone's (D1)", () => {
  const asBob = projectMembership([ada, bob], "bob");
  expect(canDeleteComment(asBob, "bob")).toBe(true);
  expect(canDeleteComment(asBob, "ada")).toBe(false);

  const asAda = projectMembership([ada, bob], "ada");
  expect(canDeleteComment(asAda, "bob")).toBe(true);
  expect(canDeleteComment(asAda, "ada")).toBe(true);
});

test("only an owner deletes a former member's comment, which has no author left", () => {
  expect(canDeleteComment(projectMembership([ada, bob], "bob"), null)).toBe(false);
  expect(canDeleteComment(projectMembership([ada, bob], "ada"), null)).toBe(true);
});

test("a viewer off the board deletes nothing, not even what they wrote", () => {
  const removed = projectMembership([ada, bob], "cleo");
  expect(canDeleteComment(removed, "cleo")).toBe(false);
});
