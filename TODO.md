# TODO

Outstanding work that isn't code — things a person has to do on a real device or
with a second account, which no test in `vitest run` can cover.

## Manual demo steps

These three acceptance criteria are the only ones left unchecked across tickets
01–08. All three tickets are code-complete; these are hands-on verification gates.

### 1. Ticket 06 — move a task on a phone

> `- [ ] Move a task on a phone (demo)` — `.scratch/kanban-task-tracker/issues/06-drag-and-drop.md`

Drag a card on a real touch device (not a desktop browser's device emulator — it
doesn't reproduce real touch timing).

What to check:

- **Long-press starts a drag.** The `TouchSensor` activates after 250ms with a 5px
  tolerance, so a deliberate press-and-hold should lift the card.
- **An ordinary swipe still scrolls the page.** This is the reason a `PointerSensor`
  is deliberately not used — it would fire on touch too and start a drag mid-swipe.
  A quick vertical swipe must scroll, never drag.
- **A tap still opens the card editor** rather than starting a drag.
- **Reorder within a lane and across lanes both persist** after a reload.
- **The card no longer snaps back** on drop. This was a real bug (the re-sync effect
  was keyed on the drag rather than the in-flight move); it's fixed, but a phone is
  the only place to confirm it feels right end to end.

### 2. Ticket 07 — two users discuss a card

> `- [ ] Two users discuss a card (demo)` — `.scratch/kanban-task-tracker/issues/07-comments.md`

Needs two accounts that are both members of the same board — a second browser
profile or a private window is enough.

What to check:

- Both members can post plain-text comments on the same card, and each sees the
  other's after a reload.
- The card face's comment count reflects both.
- **Each user can delete their own comment but not the other's.** The delete control
  is hidden for comments you can't remove; the server-side backstop now returns
  "You can only delete your own comments." instead of a 500 if a stale thread tries.
- A **board owner** can delete either member's comment.
- Removing a member leaves their comments in place, attributed to "former member"
  (`authorId` is `ON DELETE SET NULL`).

### 3. Ticket 08 — invite a teammate

> `- [ ] Invite a teammate; they join and can comment (demo)` — `.scratch/kanban-task-tracker/issues/08-sharing-invites.md`

Needs a second account (or a fresh email you can sign up with) in another browser
profile. The flow was exercised end to end against a running server, but not by two
people on two devices.

What to check:

- As owner, open **Members** on a board, enter the teammate's email + role, and copy
  the minted link. Send it out-of-band — there's no email infrastructure (D2).
- Opening the link **while signed out** lands on sign-in with the invite carried in
  `?next=`; creating a brand-new account from there comes straight back to the
  accept screen. Signing in as the invited address and accepting joins the board.
- **Accepting on the wrong account is refused** with "This invite was sent to a
  different email address" — the invite is email-bound (D2).
- The **link is single-use and expires in 7 days**; re-opening it after accepting
  says "You're already in" rather than erroring (idempotent).
- The teammate can then open a card and **comment** — which is also the second
  account ticket 07's demo needs.
- As owner, **change their role and remove them**. Removing clears any cards they
  were assigned; their comments stay.

## Notes

- There is no live deployment to run these against right now. The app targets
  **Vercel + Neon** in production (see `.env.example`); a local run needs a Postgres
  on `DATABASE_URL` and `npm run db:migrate` before `npm run dev`.
- Once all three demos pass, tick the boxes in the ticket files above and this file
  can go away.
