# 17 — Live role-change polling

**What to build:** Make promotions and demotions visible to every open board within
the D4 polling window. Membership versioning currently uses only row count and
`createdAt`, so changing `role` does not move the board token; owner capability is
also captured once during the server render. Version role changes and derive
permission UI from the live board membership data while retaining server-side
authorization as the source of truth.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] `board_members` records a timestamp/version change whenever its role changes
- [ ] The board version token changes for promotions and demotions without changing member count
- [ ] A promoted user gains owner controls within one polling interval without reloading
- [ ] A demoted user loses owner controls within one polling interval without reloading
- [ ] Members, assignee choices, and governance UI share one live membership projection
- [ ] Integration/unit tests cover version changes and client capability updates
