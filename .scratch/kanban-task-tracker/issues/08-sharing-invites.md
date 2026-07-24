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

**Status:** code done. The invite-a-teammate demo below is still outstanding — see
`TODO.md`.

- [x] Owner mints an invite (email + role) → `board_invites` row with crypto-random single-use token, 7-day expiry
- [x] Invite link routes a logged-out user through sign-in/up carrying the token, then to an accept screen
- [x] Accept requires the logged-in email to match (case-insensitive); token is single-use and expires; accepting is idempotent
- [x] Accept creates a `board_members` row with the invited role
- [x] Owner can remove a member and change a role; non-owners are blocked from invite/remove/role actions
- [ ] Invite a teammate; they join and can comment (demo)

## Notes on what landed

- **`board_invites`** (migration `0007`): `email` stored lowercased, `token` unique
  (32 CSPRNG bytes, base64url), `role`, `invitedById` `ON DELETE SET NULL`,
  `expiresAt`, `acceptedAt`. Board deletion cascades invites (D5).
- **One place decides acceptance.** `reviewInvite(token, userId)` returns
  `acceptable | already-member | rejected(reason)`, and `acceptInvite` accepts only
  what it blesses — so the accept screen can never offer an accept the mutation
  would refuse. Single use is enforced by the stamp itself: the accept transaction
  inserts the membership only if it wins `UPDATE … WHERE accepted_at IS NULL`, so
  two concurrent accepts can't both mint a member (covered by a racing test).
- **Presenting an already-accepted invite spends it too.** Accepting is idempotent
  (it reports `alreadyMember` and doesn't duplicate the row), but the token is
  stamped either way — otherwise a second, never-clicked link would sit live as a
  way back onto a board the owner later removed you from.
- **An existing member can't be invited** (`already-a-member`): a link that could
  only ever say "you're already in" is a silent no-op of the owner's intent, and
  changing a member's role is the members list's job.
- **Carrying the token through auth** uses `?next=`, filtered by
  `safeRedirectPath` (unit-tested) so the sign-in page can't become an open
  redirect. `requireUser` / `requireUserId` (`app/session.ts`) is the one place
  that decides where a signed-out visitor goes and what brings them back.
- **Roles are parsed, not cast.** `boardRoleSchema` guards the invite and
  role-change actions: `role` is a text column, and an unrecognised value would
  otherwise reach it (and rank as `undefined` against a `minRole` gate — now
  `rankOf` floors an unknown role at 0).
- **Removing a member clears their card assignments** in the same transaction —
  `assignCard` only ever accepts a current member, so a stale assignee would put a
  non-member's avatar on the board. Their cards and comments stay (D5).
- **The board's creator can't be removed or demoted** (`MembershipError`,
  reason `board-creator`), so a board always has an owner — v1 has no ownership
  transfer (D5). Other owners (invited as `owner`) can be demoted or removed.

## Known limitation (not fixed here)

Accounts store `users.email` exactly as typed, under a case-*sensitive* unique
index (ticket 02), so `ada@x.com` and `Ada@x.com` can both exist as separate
accounts — and both satisfy one invite's case-insensitive match. D6 already rates
email binding a guardrail rather than a security boundary ("Security rests on the
token"), so this doesn't weaken the trust boundary, but the 1:1 binding D2 implies
isn't quite what the data allows. The fix belongs with auth: normalize email on
registration and look it up folded, with a backfill migration.
