# 12 — Owner board rename + delete

**What to build:** Complete the board lifecycle required by D1/D5. An owner can
rename a board and permanently delete it after confirmation; a member cannot do
either. Both mutations use the existing `requireBoardMember(..., "owner")` seam,
validate input with Zod, and keep the board list/detail UI in sync. Deletion relies
on the existing database cascades for columns, cards, comments, memberships, and
invites.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Owner can rename a board to a trimmed, non-empty name of at most 100 characters
- [ ] Owner can delete a board only after an explicit confirmation
- [ ] Members and non-members are refused by the server-side authorization seam
- [ ] Deleting a board cascades all board-owned rows and returns the owner to `/boards`
- [ ] Rename/delete update or invalidate every relevant server and client cache
- [ ] Integration tests cover owner success, member refusal, validation, and deletion cascades
