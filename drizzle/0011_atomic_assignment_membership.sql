-- Atomic assignment + membership removal (ticket 16). "A card's assignee is a
-- current member of that card's board" was previously held by application
-- sequencing alone: assignment checked membership before writing, removal cleared
-- assignments before deleting the membership. Both are check-then-write, so the
-- two could interleave and commit a removed user as a live assignee. This moves
-- the invariant into the database, where the row locks the constraint takes
-- serialize the operations no matter which order they arrive in.
--
-- Any row that already broke the rule has to go before the constraint can be
-- validated. Clearing the assignment is the same repair `removeMember` was always
-- meant to perform, so this restores the intended state rather than choosing a new
-- one — the card, its history and its comments are untouched.
UPDATE "cards" SET "assignee_id" = NULL
WHERE "assignee_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "board_members"
    WHERE "board_members"."board_id" = "cards"."board_id"
      AND "board_members"."user_id" = "cards"."assignee_id"
  );--> statement-breakpoint
-- The referencing side of the constraint below. Without it every membership
-- delete seq scans `cards` to find the assignments it has to null out.
CREATE INDEX "cards_board_id_assignee_id_idx" ON "cards" USING btree ("board_id","assignee_id");--> statement-breakpoint
-- `ON DELETE SET NULL ("assignee_id")` is the column-list form (Postgres 15+):
-- removing a membership nulls the assignee and leaves `board_id` — which is NOT
-- NULL — alone. drizzle-kit cannot express that column list and emits a bare
-- `ON DELETE set null` over both referencing columns, which would fail on
-- `board_id`; the list is applied here by hand. See the note on the constraint in
-- db/schema.ts if this is ever regenerated.
--
-- MATCH SIMPLE (the default) is what keeps an unassigned card legal: with
-- `assignee_id` NULL the constraint isn't checked, so `board_id` alone never has
-- to match a membership.
ALTER TABLE "cards" ADD CONSTRAINT "cards_assignee_board_member_fk" FOREIGN KEY ("board_id","assignee_id") REFERENCES "public"."board_members"("board_id","user_id") ON DELETE SET NULL ("assignee_id") ON UPDATE NO ACTION;--> statement-breakpoint
-- The old direct reference to `users` is now redundant, and being redundant is
-- what makes it harmful: it can refuse an assignment before the membership
-- constraint gets to, so the same bad input comes back as a different error. Every
-- claim it made is implied — an assignee must name a `board_members` row, which
-- itself references `users` ON DELETE CASCADE, so deleting a user still drops the
-- membership and the membership constraint above still nulls the assignment.
ALTER TABLE "cards" DROP CONSTRAINT "cards_assignee_id_users_id_fk";
