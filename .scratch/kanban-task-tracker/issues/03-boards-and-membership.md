# 03 — Boards + membership

**What to build:** A logged-in user can create a board and see a list of the boards
they're a member of; creating a board makes the creator an `owner` member. Every
board-scoped read and mutation passes through a single access-control seam,
`requireBoardMember(boardId, userId, minRole?)`, so non-members are refused. Adds
the `boards` and `board_members` tables (PK `boardId + userId`, `role` =
`owner | member`).

**Blocked by:** 02 — Auth.

**Status:** done (commit a239e21)

- [x] Create a board → creator row in `board_members` with role `owner`
- [x] `GET /api/boards` returns only boards the current user is a member of
- [x] `requireBoardMember(boardId, userId, minRole?)` seam exists and gates board access; a non-member gets 403/redirect
      — seam + BoardAccessError built and integration-tested; no live caller yet (no single-board route until ticket 04), so the 403/redirect path is proven in tests, dormant in the app until columns/cards consume it.
- [x] Two accounts each see only their own boards (demo)
- [x] Mutations Zod-validated and membership-checked
