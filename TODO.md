# TODO

Outstanding work that isn't code — things a person has to do on a real device or
with a second account, which no test in `vitest run` can cover.

## Manual demo steps

These five acceptance criteria are the only ones left unchecked across tickets
01–10. All five tickets are code-complete; these are hands-on verification gates.

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

### 4. Ticket 09 — two people on one board

> `- [ ] A moves a card, B sees it in ~4s; concurrent same-card drag settles
> last-write-wins with no duplicate/precision collision (demo)` —
> `.scratch/kanban-task-tracker/issues/09-near-real-time-polling.md`

Needs the same two accounts as demos 2 and 3, both with the board open side by side.

Most of the loop was verified against a running server and a real browser: the
version endpoint ticks every 4s and pauses when the tab is hidden, the heavy board
payload is fetched *only* when the token moves, a card moved out of band showed up
in the other tab in ~2s, a dropped card doesn't snap back across two poll cycles,
and an open card's thread polls every 5s. What no single browser can show:

- **Two humans, one board.** A drags a card; B — who is only *watching* — sees it
  land within ~4s, with no reload and no flicker on B's side either.
- **The concurrent same-card drag.** Both people grab the *same* card at the same
  moment and drop it in different lanes. Expect last-write-wins: both tabs settle
  on the same lane within a poll, exactly one row moved, no duplicate card and no
  two cards sharing a `position` (the fractional-index jitter, D3).
- **Editing while someone else's write is in flight.** Type in a card's editor
  while B is moving cards; your open editor must not be clobbered by a poll.
- **A hidden tab catching up.** Leave B's tab in the background for a minute while
  A makes changes; on return B should re-sync within one poll.

### 5. Ticket 10 — install it and open it offline

> `- [ ] Mobile layout: … install to home screen and open offline (demo)` —
> `.scratch/kanban-task-tracker/issues/10-pwa-offline-mobile-polish.md`

Needs a real phone. **The service worker and the install prompt only exist in a
production build**, so this is `npm run build && npm start` (with
`AUTH_TRUST_HOST=true`, see `.env.example`), not `npm run dev` — and the device has
to reach the machine over a secure context, so a tunnel with an HTTPS URL or a
deployment, not a bare LAN address.

Most of the loop was verified against a production build in a phone-sized browser:
the worker registers at scope `/`, the board opens with the network cut — straight
to the last-seen board, behind the "Offline" banner — a save from the card sheet is
refused with the toast, and the card detail renders as a full-screen sheet on a
phone and a side panel on a desktop. What no headless browser produces:

- **The install prompt itself.** Chromium fires `beforeinstallprompt` only for a
  real installable context; that event is what reveals the "Install app" button
  next to the boards list. Tap it, accept, and confirm the app lands on the home
  screen with the kanban icon.
- **Launched from the home screen.** It should open with no browser chrome
  (`display: standalone`) and the slate status bar, straight to your boards.
- **Then with the network off** (aeroplane mode). It should open to the last board
  you had open, stale and read-only, with the "Offline" banner — and every attempt
  to change something refused with the toast, nothing silently lost.
- **Touch feel.** Lanes scroll-snap one at a time and each lane scrolls its own
  cards; a long-press still lifts a card and an ordinary swipe still scrolls
  (ticket 06's demo covers the drag itself).
- **Signing out clears the device.** Sign out, kill the network, launch again: it
  must *not* open anyone's board — the persisted cache and the worker's pages are
  dropped on sign-out.

## Notes

- There is no live deployment to run these against right now. The app targets
  **Vercel + Neon** in production (see `.env.example`); a local run needs a Postgres
  on `DATABASE_URL` and `npm run db:migrate` before `npm run dev`.
- Once all five demos pass, tick the boxes in the ticket files above and this file
  can go away.
