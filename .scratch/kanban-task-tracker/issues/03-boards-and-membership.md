# 03 — Boards + membership

**What to build:** A logged-in user can create a board and see a list of the boards
they're a member of; creating a board makes the creator an `owner` member. Every
board-scoped read and mutation passes through a single access-control seam,
`requireBoardMember(boardId, userId, minRole?)`, so non-members are refused. Adds
the `boards` and `board_members` tables (PK `boardId + userId`, `role` =
`owner | member`).

**Blocked by:** 02 — Auth.

**Status:** ready-for-agent

- [ ] Create a board → creator row in `board_members` with role `owner`
- [ ] `GET /api/boards` returns only boards the current user is a member of
- [ ] `requireBoardMember(boardId, userId, minRole?)` seam exists and gates board access; a non-member gets 403/redirect
- [ ] Two accounts each see only their own boards (demo)
- [ ] Mutations Zod-validated and membership-checked
