-- Collision-safe fractional ordering (D3). Two rows in the same lane must never
-- share a `position`: `generateKeyBetween` cannot produce a key between two equal
-- ones, so a duplicate poisons that gap for every later insert.
--
-- If either index fails to build, the database has already-colliding rows and will
-- name the exact duplicate. That is deliberately NOT auto-repaired here: picking a
-- winner would silently reorder someone's board. Resolve it by giving one of the
-- named rows a key between its own and the next one up (appending `V` to it is a
-- valid fractional key that sorts immediately after), then re-run the migration.
CREATE UNIQUE INDEX "cards_column_id_position_unique" ON "cards" USING btree ("column_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "columns_board_id_position_unique" ON "columns" USING btree ("board_id","position");