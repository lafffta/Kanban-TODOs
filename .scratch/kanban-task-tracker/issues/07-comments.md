# 07 — Comments

**What to build:** In a card's detail view, a member can add a plain-text comment
and see the card's comment thread; a member can delete their **own** comment, and an
owner can delete **any** comment. Comments are add + delete only (no editing).
Adds the `comments` table (`cardId`, `authorId` `ON DELETE SET NULL`, `body` plain
text, `createdAt`) and the `GET /api/cards/:id/comments` read. Card faces show a
comment count.

**Blocked by:** 06 — Drag & drop cards.

**Status:** code done — merged to `main` (PR #5). The two-users-discuss demo below is
still outstanding — see `TODO.md`.

- [x] Add a plain-text comment on a card (membership-checked, Zod-validated)
- [x] Card detail lists comments; card face shows a comment count
- [x] Author can delete their own comment; owner can delete any; a member cannot delete others' comments
- [x] `authorId` is `ON DELETE SET NULL` so a removed member's comments survive as "former member"
- [ ] Two users discuss a card (demo)
