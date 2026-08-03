-- Version role changes (ticket 17). A board's change token is built from a row
-- count plus the latest touch per entity, and a promotion or demotion moves
-- neither for `board_members`: the same people are on the board, and `created_at`
-- is when they joined. So the one change that alters what a viewer is *allowed to
-- do* was the one change their poll could not see. `updated_at` is the touch the
-- token reads (see `boardVersion`), bumped by every role change.
ALTER TABLE "board_members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The column default stamps every existing membership with the moment of this
-- migration, which would claim the whole table was just re-roled. Backfilling from
-- `created_at` says what is actually true — nobody's role has changed since they
-- joined — and keeps the deploy from moving every open board's token at once.
UPDATE "board_members" SET "updated_at" = "created_at";
