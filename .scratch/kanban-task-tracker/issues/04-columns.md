# 04 — Columns

**What to build:** On a board they belong to, a member can create, rename, reorder,
and delete columns, and the lanes render in order. Ordering uses **fractional-index
string** `position` keys (the `fractional-indexing` npm package): reordering
generates a key between the two new neighbours (with jitter to avoid identical
concurrent keys), touching one row per move. Introduces the shared ordering helper
reused later by cards. Deleting a non-empty column is out of scope here beyond the
column row itself (cascade of cards/comments lands with cards/comments); confirm
dialog on delete.

**Blocked by:** 03 — Boards + membership.

**Status:** ready-for-agent

- [ ] `columns` table with `boardId`, `name`, `position` (TEXT fractional index)
- [ ] Create / rename / delete a column (member-permitted, membership-checked)
- [ ] Reorder a column by generating a fractional key between neighbours with jitter; one row updated per move
- [ ] Board renders columns in `position` order
- [ ] Shared fractional-index helper extracted for reuse
