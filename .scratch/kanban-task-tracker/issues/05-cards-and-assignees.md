# 05 — Cards + assignees

**What to build:** A member can create a card in a column, edit its title and
description (plain multiline text — no markdown), delete it (cascading its
comments), and assign it to an optional single board member. The card face shows the
title and, when assigned, the assignee's avatar; a "my cards" filter narrows the
board to the current user's assigned cards. Assignment is validated: the assignee
must be a member of the same board. Adds the `cards` table (`boardId`, `columnId`,
`title`, `description`, `position` TEXT, `assigneeId` nullable, `createdById`
`ON DELETE SET NULL`, `createdAt`, `updatedAt`). Cards get an initial fractional
`position` on create; drag/reorder lands in the next ticket.

**Blocked by:** 04 — Columns.

**Status:** ready-for-agent

- [ ] Create / edit (title + description) / delete a card; delete cascades its comments
- [ ] Card gets a fractional-index `position` within its column on create
- [ ] Assign an optional single member via `assigneeId`; assignment rejected if assignee isn't a board member
- [ ] Card face shows title + assignee avatar; "my cards" filter works
- [ ] `createdById` is `ON DELETE SET NULL` so a removed member's cards survive as "former member"
