# 08 — Sharing / invites

**What to build:** An owner can invite a teammate to a board and manage membership.
The owner enters an email + role, which mints a `board_invites` row with a
crypto-random single-use `token` and a 7-day `expiresAt`; the owner shares the link
out-of-band (no email infra). Opening the link while logged out routes through
sign-up/sign-in carrying the token, then to an accept screen; on accept the logged-in
user's email must match the invite (case-insensitive), and acceptance is idempotent
and single-use. Owners can also remove a member and change a member's role. All of
these are owner-only, enforced via `requireBoardMember(..., minRole: 'owner')`.

**Blocked by:** 07 — Comments.

**Status:** ready-for-agent

- [ ] Owner mints an invite (email + role) → `board_invites` row with crypto-random single-use token, 7-day expiry
- [ ] Invite link routes a logged-out user through sign-in/up carrying the token, then to an accept screen
- [ ] Accept requires the logged-in email to match (case-insensitive); token is single-use and expires; accepting is idempotent
- [ ] Accept creates a `board_members` row with the invited role
- [ ] Owner can remove a member and change a role; non-owners are blocked from invite/remove/role actions
- [ ] Invite a teammate; they join and can comment (demo)
