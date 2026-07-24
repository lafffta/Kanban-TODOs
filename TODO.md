# TODO

Outstanding work that isn't code — things a person has to do on a real device or
with a second account, which no test in `vitest run` can cover.

## Manual demo steps

These two acceptance criteria are the only ones left unchecked across tickets 01–07.
Both tickets are code-complete and merged; these are hands-on verification gates.

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

## Notes

- There is no live deployment to run these against right now. The app targets
  **Vercel + Neon** in production (see `.env.example`); a local run needs a Postgres
  on `DATABASE_URL` and `npm run db:migrate` before `npm run dev`.
- Once both demos pass, tick the boxes in the two ticket files above and this file
  can go away.
