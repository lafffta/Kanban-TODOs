# Manual QA / deploy checklist

Manual tasks that the automated test suite can't cover — demos, prod DB
migrations, and deploys. Automated integration tests already cover the domain
logic; these are the human-in-the-loop steps. Keep this in sync as tickets land.

## Ticket 03 — Boards + membership

- [ ] **Two-account isolation demo.** `npm run dev` against local Docker Postgres, then:
  - Sign up / sign in as **account A**, create a board via the boards page form, confirm it appears in the list.
  - Confirm the creator gets an `owner` membership (creator → `owner` row in `board_members`).
  - Sign out, sign in as **account B**; confirm B sees none of A's boards, then create B's own board.
  - `GET /api/boards` while signed in → only the caller's boards; while signed out → **401**.
  - Empty-state message shows with no boards; submitting a blank board name shows the inline Zod error.
  - Note: `requireBoardMember`'s 403/redirect path has **no live route caller until ticket 04**, so it can't be exercised in the app yet — it's proven by integration tests only.

## Deploy (tickets 02 + 03 → production)

Prod DB changes and deploys are **user-triggered** — do not run automatically.

- [ ] **Apply migration 0003 to production Neon.** Local Docker Postgres already has it (applied via the test suite's `migrate()`), but Neon does not. Run drizzle migrate against the Neon **pooled** URL (`DATABASE_URL=<neon> DATABASE_DRIVER=neon npm run db:migrate`, or the chosen apply path). Verify `boards` + `board_members` tables and their FKs exist in Neon afterward.
- [ ] **Deploy to Vercel + smoke-test live** *(blocked by the Neon migration above)*. Ticket 01 is live; auth (02) and boards (03) still need a prod deploy. After deploying:
  - Confirm `AUTH_SECRET` and `DATABASE_URL` / `DATABASE_DRIVER=neon` are set in the Vercel project.
  - On the live URL: sign up / in, create a board, confirm per-account isolation, and `GET /api/boards` returns the caller's boards (401 signed out).
