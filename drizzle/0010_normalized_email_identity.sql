-- Normalized email identity (ticket 14). An address names a person, so one
-- address must map to exactly one account: `ada@x.com` and `Ada@x.com` are the
-- same identity. Uniqueness moves off the typed text and onto the canonical form
-- (`lower(email)`), and the rows already stored are folded to that form.
--
-- Two accounts that already collide cannot be resolved here. Merging them would
-- mean silently picking one person's boards, memberships, cards and comments over
-- the other's — so the migration refuses, names them, and leaves the data alone.
-- Resolve by hand (reassign or rename one account), then re-run.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(canonical || ' (' || variants || ')', '; ' ORDER BY canonical)
  INTO collisions
  FROM (
    SELECT lower(btrim(email)) AS canonical, string_agg(email, ', ') AS variants
    FROM "users"
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) c;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot normalize email identity: separate accounts share one address — %', collisions
      USING HINT = 'Merge or rename these accounts by hand; this migration will not pick a winner. Then re-run it.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));--> statement-breakpoint
-- Invites have been written canonically since they were introduced; this holds
-- the same invariant for any row that predates or bypassed that.
UPDATE "board_invites" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));--> statement-breakpoint
-- The index expression matches `canonicalEmail` in db/email.ts exactly. Folding
-- only case would leave the whitespace half of the identity unenforced — the very
-- state the UPDATE above just cleaned up.
CREATE UNIQUE INDEX "users_email_canonical_unique" ON "users" USING btree (lower(btrim("email")));
