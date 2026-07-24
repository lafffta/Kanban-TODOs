# 06 — Drag & drop cards

**What to build:** A member can drag a card within its column and across columns, on
both desktop and a phone, and the new order and column persist. Movement writes a new
fractional-index `position` between the drop neighbours (with jitter) and updates the
card's `columnId` — one row touched per move, last-write-wins with no locking. Uses
`@dnd-kit/core` + `@dnd-kit/sortable` with touch sensors and **long-press
activation** so vertical page scroll still works on mobile.

**Blocked by:** 05 — Cards + assignees.

**Status:** done

- [x] Drag a card within a column → new fractional `position` persisted
- [x] Drag a card to another column → `columnId` + `position` persisted
- [x] dnd-kit touch sensors with long-press activation; vertical scroll still works on a phone
- [x] Move is one row update; concurrent moves produce distinct keys (jitter), settling last-write-wins
- [ ] Move a task on a phone (demo)
