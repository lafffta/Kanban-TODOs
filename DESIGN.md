# Kanban Task Tracker — Design Spec

## Context

A full-stack, mobile-first web app for tracking tasks on a kanban board. Teams
share boards, drag cards between customizable columns, assign cards to members,
and discuss work by commenting on cards. The app is an installable PWA so it
feels native on a phone. This document is the spec — it feeds directly into
ticketing and implementation. Every open question has been grilled to a
decision; see **Resolved design decisions** below for the reasoning.

### Decisions (locked)

| Area | Decision |
|---|---|
| Collaboration | **Shared boards.** A board has members with roles; members move cards and comment. |
| Stack | **Next.js (App Router) full-stack**, TypeScript, React Server Components + server actions. |
| Auth | **Auth.js v5 (self-hosted)**, email + password credentials. OAuth deferrable. |
| Mobile | **Installable PWA** — manifest + service worker, mobile-first responsive UI. |
| Freshness | **Near-real-time polling** — the board silently re-fetches every few seconds. No websockets. |
| Columns | **Customizable per board** — users add / rename / reorder columns. |
| Hosting | **Vercel + Neon Postgres** (pooled connection endpoint — required, see §Polling). |

### Explicitly out of scope for v1
- Websockets / true push real-time (polling is the chosen tradeoff).
- Offline **write** sync (PWA gives an app shell, installability, and read-only offline; not offline mutation).
- OAuth / social login (schema leaves room; not built).
- Real email delivery / verification (no SMTP in v1 — see decision D6).
- File attachments, labels, due-date reminders, notifications, markdown.
- Ownership transfer and account self-deletion.

---

## Resolved design decisions

These are the outcomes of grilling the spec. Each is load-bearing; reopen
deliberately.

- **D1 — Permissions (two roles).** `owner | member`. **Members** do all *content*
  operations, including **deleting cards other members created**, creating/renaming/
  reordering/deleting columns, and commenting. **Only owners** invite/remove members,
  change roles, and rename/delete the board. Members may delete only their **own**
  comments; owners may delete any. Rationale: content is a shared artifact (Trello-like);
  governance stays with the owner. Full matrix in §Domain model.
- **D2 — Invites are link-based & email-bound.** Owner enters an email + role → we
  mint a `board_invites` row with a crypto-random `token` and 7-day `expiresAt` → owner
  shares the link out-of-band (no email infra). Opening the link while logged out routes
  through sign-up/sign-in (token carried across the redirect) to an accept screen; on
  accept the logged-in user's email must match (case-insensitive). Idempotent.
- **D3 — Concurrency = last-write-wins + fractional index.** No locking, no merge UI.
  Card/column order uses **LexoRank-style fractional-index string keys** (`position text`)
  with jitter so two clients choosing the same slot produce *different* keys — backed by a
  unique index per lane, so a residual tie is refused by the database and retried rather
  than stored (an equal pair cannot be ordered between afterwards). Optimistic
  drag reconciles with polling via TanStack Query: `cancelQueries` on mutate, suppress
  reconciliation while a mutation is in flight, `invalidateQueries` on settle, and gate
  stale polls with a local monotonic version.
- **D4 — Polling: 4s board / 5s comments.** Only the *currently open* board and open
  card poll; **paused when the tab is hidden** (`refetchIntervalInBackground: false`). A
  lightweight `GET /api/boards/:id/version` (`max(updated_at)`) guards payload so the full
  board is refetched only when something changed. **Constraint:** every serverless poll
  opens a DB connection → must use **Neon's pooled endpoint** (`@neondatabase/serverless`
  / PgBouncer) or connections exhaust.
- **D5 — Deletion cascades.** Deleting a non-empty column (confirm dialog) cascade-deletes
  its cards + their comments. Deleting a board (owner only, confirm) cascades everything.
  Deleting a card cascades its comments. **A removed member's cards/comments stay** on the
  board — `cards.createdById` / `comments.authorId` are `ON DELETE SET NULL` so content
  survives account deletion (shows "former member"). Single owner, **no ownership transfer**,
  **no account self-deletion** in v1.
- **D6 — The invite token is the trust boundary.** Because there's no email verification
  in v1 (no SMTP), email-binding (D2) is a guardrail against *accidental* wrong-account
  acceptance, not a security boundary. Security rests on the token: **crypto-random,
  single-use, 7-day expiry.** Genuine verified-email invites arrive with SMTP in v2.
- **D7 — Card content is plain text; single assignee.** Descriptions and comments are
  plain multiline text (no markdown → no HTML-sanitization surface). Comments are add +
  delete only (no editing). Each card has an optional **single `assigneeId`** (must be a
  board member) with an avatar on the card face and a "my cards" filter.
- **D8 — Offline opens to your last board.** App-shell service worker, network-first for
  data. The TanStack Query cache is **persisted to IndexedDB**, so launching the installed
  app offline opens straight to the last-seen board (clearly stale, read-only) with an
  "Offline" banner; any mutation is blocked with a toast. No write queue / background sync
  in v1. Custom install affordance via `beforeinstallprompt`.

---

## Tech stack

- **Framework:** Next.js 15 (App Router), TypeScript, React 19.
- **DB:** Postgres (Neon in prod via its **pooled** endpoint; Docker Postgres locally).
- **ORM / migrations:** Drizzle ORM + drizzle-kit. Serverless-friendly, first-class Auth.js adapter.
- **Auth:** Auth.js v5 (`next-auth@beta`) + Drizzle adapter, **Credentials** provider, **JWT** session strategy (Credentials requires JWT). Passwords hashed with `@node-rs/argon2` (or `bcryptjs`).
- **Client data / polling:** TanStack Query — `refetchInterval` for reads, optimistic mutations via server actions, IndexedDB persister for offline (D8).
- **Ordering:** `fractional-indexing` (npm) for `position` string keys (D3).
- **Drag & drop:** `@dnd-kit/core` + `@dnd-kit/sortable` — strong touch support, long-press activation so mobile scroll still works.
- **Validation:** Zod on every server action / route handler boundary.
- **Styling:** Tailwind CSS, mobile-first. Optional: shadcn/ui for accessible primitives.
- **PWA:** `next-pwa` or hand-rolled manifest + service worker.

---

## Domain model

- **User** — an account (email, password hash, name).
- **Board** — a kanban board owned by a user, shared with members.
- **BoardMember** — a user's membership in a board, with a **role** (`owner` | `member`).
- **Column** — an ordered lane on a board (e.g. "To Do"), user-customizable.
- **Card** — a task in one column: title, description, position, optional assignee.
- **Comment** — a plain-text message by a user on a card.
- **Invite** — a tokenized, email-bound, single-use link granting membership on accept.

### Permissions matrix (D1)

| Action | Owner | Member |
|---|:--:|:--:|
| View board, create/edit/move cards | ✅ | ✅ |
| Delete **any** card | ✅ | ✅ |
| Assign a card to a member | ✅ | ✅ |
| Add comment | ✅ | ✅ |
| Delete **own** comment | ✅ | ✅ |
| Delete **others'** comments | ✅ | ❌ |
| Create/rename/reorder/delete columns | ✅ | ✅ |
| Invite / remove members, change roles | ✅ | ❌ |
| Rename / delete the board | ✅ | ❌ |

### Schema (Drizzle)

```
users            id, name, email (unique), emailVerified, image, passwordHash, createdAt
accounts         (Auth.js adapter — reserved for future OAuth)
sessions         (Auth.js adapter — reserved; JWT strategy in v1)
verificationTokens (Auth.js adapter)

boards           id, name, ownerId → users, createdAt
board_members    boardId → boards, userId → users, role, createdAt   [PK: boardId+userId]
columns          id, boardId → boards, name, position (TEXT, fractional index), createdAt
                 [UNIQUE: boardId+position]
cards            id, boardId → boards, columnId → columns, title, description,
                 position (TEXT, fractional index),   [UNIQUE: columnId+position]
                 assigneeId → users (nullable, must be board member),
                 createdById → users (ON DELETE SET NULL),
                 createdAt, updatedAt
comments         id, cardId → cards,
                 authorId → users (ON DELETE SET NULL),
                 body (plain text), createdAt
board_invites    id, boardId → boards, email, token (unique, crypto-random, single-use),
                 role, invitedById → users, expiresAt, acceptedAt
```

**Ordering (D3):** `columns.position` and `cards.position` are **fractional-index
strings**. On reorder, generate a key between the new neighbours (with jitter to
avoid identical concurrent keys) — one row touched per move, no float exhaustion.
Uniqueness is enforced in the database, not just hoped for: unique indexes on
`columns (board_id, position)` and `cards (column_id, position)`. Jitter alone only
makes a tie unlikely, and equal keys are worse than a tie — `generateKeyBetween`
cannot produce a key between two equal ones, so a collision would poison that gap
for every later insert. A refused write is retried against a narrower gap.

**Access control:** every board/column/card/comment query is scoped by verifying
the current user's membership. Centralize in a single seam:
`requireBoardMember(boardId, userId, minRole?)` — used by every server action and
route handler. Assignment sets validate the assignee is a member of the same board.

---

## Server surface

**Reads (polled via TanStack Query → route handlers):**
- `GET /api/health` — unauthenticated liveness/readiness probe. Runs a `SELECT 1`
  DB round-trip (the check the old walking-skeleton homepage used to render):
  `200 {status:"ok",db:"up"}` when Postgres is reachable, `503 {status:"error",db:"down"}`
  otherwise. The root `/` route redirects into the app (`/boards`), so this endpoint
  is where the DB pipe is now verified.
- `GET /api/boards` — boards I'm a member of.
- `GET /api/boards/:id` — full board: columns + cards (+ assignee, comment counts).
- `GET /api/boards/:id/version` — `max(updated_at)` cheap poll to guard full refetch (D4).
- `GET /api/cards/:id/comments` — comments for a card (polled while a card is open).

**Mutations (server actions, Zod-validated, membership-checked):**
- Auth: sign up, sign in, sign out (Auth.js).
- Boards: create, rename (owner), delete (owner, cascades).
- Members / invites: create invite (owner), accept invite, remove member (owner), change role (owner).
- Columns: create, rename, reorder, delete (delete cascades cards+comments).
- Cards: create, edit (title/description), assign (assigneeId), move (column + position), delete (cascades comments).
- Comments: add, delete (author, or owner for any).

Mutations invalidate the relevant board query; optimistic updates apply
immediately and reconcile on settle / next poll (D3).

---

## Mobile & PWA

- **Mobile-first layout.** Board is a horizontally-scrolling row of columns; each
  column scrolls vertically. Card detail opens as a full-screen sheet on mobile,
  a side panel on desktop. Cards show title + assignee avatar; "my cards" filter.
- **Drag & drop** via dnd-kit with touch sensors + long-press activation so
  vertical scroll still works on a phone.
- **PWA (D8):** manifest (`display: standalone`, icons, theme color), app-shell
  service worker, network-first data, IndexedDB-persisted query cache for offline
  read-only, "Offline" banner, mutations blocked offline, custom install button.

---

## Build order (tracer-bullet tickets)

Each slice cuts through the whole stack and is independently demoable.

1. **Walking skeleton** — Next.js + TS + Tailwind scaffold, Drizzle + **Neon pooled**
   connection, one migration, a deployed "hello" page. Verifies the pipe end to end.
2. **Auth** — Auth.js Credentials (JWT), sign up / sign in / sign out, protected route,
   `users.passwordHash` (argon2). Demo: create an account, log in, see a gated page.
3. **Boards + membership** — create a board (creator → `owner` member), list my boards,
   `requireBoardMember` seam. Demo: two accounts, each sees only their boards.
4. **Columns** — create / rename / reorder (fractional index) / delete columns. Demo: custom lanes.
5. **Cards + assignees** — create / edit / delete cards; **assign to a member**; drag
   between/within columns (dnd-kit, fractional positions). Demo: move & assign a task on a phone.
6. **Comments** — add / list / delete (author-or-owner) in card detail. Demo: two users discuss a card.
7. **Sharing / invites** — owner mints email-bound single-use token link → accept flow →
   membership; remove member; owner-only guards. Demo: invite a teammate, they join and comment.
8. **Near-real-time polling** — TanStack Query 4s/5s intervals, hidden-tab pause, version
   guard, optimistic mutations + in-flight suppression. Demo: A moves a card, B sees it in ~4s.
9. **PWA + offline + mobile polish** — manifest, icons, app-shell SW, IndexedDB persistence,
   "Offline" banner, install button, touch/scroll tuning. Demo: install to home screen, open offline.

---

## Verification

- **Per slice:** an integration test through the server action + DB (Vitest + a test
  Postgres schema), plus a manual demo of the slice's flow.
- **End-to-end smoke (after slice 8):** two browser sessions, different users, same board;
  A creates a column, adds+assigns a card, drags it, comments; B sees each change within
  ~4s without reloading. Concurrently drag the *same* card from both — confirm last-write-wins
  settles cleanly with no duplicate/precision-collision ordering.
- **Access-control check:** a non-member gets 403/redirect on every board/card/comment read
  and mutation; a member is blocked from owner-only actions (invite, remove, board delete).
- **Invite check:** token is single-use and expires; accepting with a mismatched email is rejected.
- **Mobile/PWA check (after slice 9):** run on a phone, install to home screen, verify
  drag/scroll and full-screen card sheet; kill the network and confirm the app opens to the
  last board read-only with the "Offline" banner and blocked mutations.

---

## Suggested next step

`/to-tickets` to split this spec into the nine tracer-bullet tickets above (or work
them top-down by hand), then `/implement` each in a fresh context, starting with the
**walking skeleton**.
