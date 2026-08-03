# Kanban Task Tracker

A mobile-first, installable-PWA kanban board for teams. See [`DESIGN.md`](./DESIGN.md)
for the full spec and locked design decisions, and
[GitHub Issues](https://github.com/lafffta/Kanban-TODOs/issues) for the tracer-bullet
tickets and outstanding work.

**Stack:** Next.js 15 (App Router, React 19, TypeScript) · Tailwind CSS v4 ·
Drizzle ORM + drizzle-kit · Postgres (Docker locally, Neon **pooled** endpoint in prod).

---

## Ticket 01 — Walking skeleton

This slice proves the pipe end to end: a Next.js app reads a row from Postgres
through Drizzle and renders it on a "hello" page, backed by one migration.

## Local development

Prerequisites: Node 20+ and Docker.

```bash
# 1. Install deps
npm install

# 2. Configure env (local Docker Postgres)
cp .env.example .env

# 3. Start Postgres
docker compose up -d

# 4. Apply the migration and seed a greeting
npm run db:migrate
npm run db:seed

# 5. Run the app — http://localhost:3000 shows "Hello from Postgres 👋"
npm run dev
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) |
| `npm test` | Vitest — DB round-trip integration test (needs Postgres running) |
| `npm run db:generate` | Author a migration from `db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Insert the initial greeting |
| `npm run db:studio` | Drizzle Studio |

### Database driver

`db/index.ts` picks the driver from `DATABASE_DRIVER`:

- `pg` (default) — `node-postgres` against local Docker Postgres.
- `neon` — `@neondatabase/serverless` against Neon's **pooled** endpoint
  (required in prod by design decision **D4** — every serverless poll opens a
  connection, so it must go through PgBouncer).

### PWA / offline

The app installs to a home screen and opens with no network (design decision
**D8**). Two pieces do that, and they only exist in a **production build**:

```bash
npm run build
AUTH_TRUST_HOST=true npm start   # http://localhost:3000
```

- `public/sw.js` — the app-shell service worker. It is deliberately *not*
  registered by `npm run dev` (and unregisters itself there), because a worker
  serving cached build output outlives the build that produced it and would hand
  hot-reloaded pages stale chunks. Its whole caching policy is `classifyRequest`,
  unit-tested in `app/pwa/sw-strategy.test.ts`.
- `app/pwa/query-persistence.ts` — the TanStack Query cache, persisted to
  IndexedDB, so an offline launch opens on the board it last saw.

Offline the board is read-only: writes are refused with a toast rather than
queued (no background sync in v1).

#### Signing out clears the device

Everything the offline app can open belongs to whoever was signed in, so
sign-out empties it: the in-memory query cache, its IndexedDB copy, the
last-board note and the pages the worker cached (`app/pwa/device-clearing.ts`).
Every area is **read back afterwards**, and anything that can't be proven gone
is named on screen with the session left up — a sign-out that leaves the boards
on a shared phone is worse than one that visibly didn't finish. Other open tabs
are told over a `BroadcastChannel` so they stop writing their cache back, and
they put the board away rather than sit on a readable copy. The sign-in page
sweeps once more on arrival (`app/pwa/leftover-sweep.tsx`), which catches a
response the worker filed after the sign-out's last check.

Verifying it by hand — the shared-device check, which the automated tests
cannot stand in for:

1. `npm run build && AUTH_TRUST_HOST=true npm start`, sign in, open a board and
   let it load. Open a second tab on the same board.
2. Sign out in the first tab. The second tab should replace the board with
   "Signed out".
3. In DevTools → Application, check **IndexedDB → kanban-query-cache** is empty,
   **Local Storage** has no `kanban:last-board`, and **Cache Storage** has no
   `kanban-pages-*` / `kanban-data-*` (only `kanban-shell-*`).
4. Go offline (DevTools → Network → Offline) and relaunch the app. It must land
   on the offline page or sign-in — never the previous account's board.
5. Sign in as a second account and repeat: the first account's boards must not
   be reachable from the device at any point.

`AUTH_TRUST_HOST` is only needed for a local production run; Vercel sets it.

Icons are generated, not hand-drawn — `node scripts/generate-icons.mjs` redraws
`public/icons/` from source.

---

## Building & deploying (Vercel + Neon)

Production runs on Vercel against a Neon Postgres database. Two things are **not**
automated by the build and must be done by hand — forgetting either takes prod
down with a "server-side exception" on load:

- **Migrations don't run on deploy.** The build command is just `next build`.
  New migrations must be applied to the prod database manually (step 4 / "Ongoing
  deploys" below). Symptom when skipped: `relation "…" does not exist`
  (Postgres `42P01`) on the first write.
- **Env-var changes need a redeploy.** Already-running functions keep the old
  environment. After adding or changing any variable, trigger a fresh deployment.

### Required environment variables (Vercel → Settings → Environment Variables, **Production**)

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`), `…?sslmode=require` | Pooled is required by design decision **D4** (every serverless poll opens a connection → PgBouncer). |
| `DATABASE_DRIVER` | `neon` | Selects `@neondatabase/serverless` in `db/index.ts`. |
| `AUTH_SECRET` | 32 random bytes, base64 | **Required** — Auth.js v5 throws `MissingSecret` on any route that reads the session (e.g. `/boards`) if unset. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |

`AUTH_TRUST_HOST` is **not** needed on Vercel — the platform sets the trusted
host automatically. (It's only required for a *local* production run; see
[PWA / offline](#pwa--offline).)

### First-time setup

1. **Create a Neon project.** Note both connection strings from the Neon console:
   the **pooled** one (host has `-pooler`, for the app) and the **direct** one
   (no `-pooler`, for running migrations).
2. **Import the repo into Vercel** (New Project → pick this repo). Set the three
   env vars above (Production, and Preview if you want preview deploys to work),
   and ensure the project's **Node.js version is 22.x** (Neon's WebSocket pool;
   the `ws` polyfill in `db/index.ts` covers older runtimes, but 22+ is cleanest).
3. **Apply migrations to Neon**, once, from your machine — use the **direct**
   (non-pooler) endpoint for DDL. `drizzle-kit` connects with `node-postgres` and
   ignores `DATABASE_DRIVER`, so only `DATABASE_URL` matters here:
   ```bash
   DATABASE_URL='<neon-DIRECT-url>' npm run db:migrate
   ```
4. **Deploy** (push to `main`, or Vercel dashboard → Deploy). Verify:
   `https://<your-domain>/api/health` → `200 {"status":"ok","db":"up"}`.

### Ongoing deploys

- **Code only:** push to `main` — Vercel builds and deploys automatically.
- **After adding a migration** (`npm run db:generate`): apply it to prod **before
  or right after** the deploy, or the new code will hit missing tables/columns:
  ```bash
  DATABASE_URL='<neon-DIRECT-url>' npm run db:migrate
  ```
- **After changing an env var:** redeploy (Deployments → latest → ⋯ → Redeploy),
  since running functions won't pick up the change otherwise.
- **If `0010_normalized_email_identity` refuses to apply:** two accounts in the
  target database already share one address in different capitalizations, and the
  migration will not pick a winner — it names them and stops, having changed
  nothing. Decide by hand which account keeps the address (rename or remove the
  other, moving any boards or memberships you want to keep), then re-run
  `npm run db:migrate`.

### Verifying a deploy

- `GET /api/health` → `200 {"status":"ok","db":"up"}` confirms the app connected
  to Postgres.
  Note it only runs `SELECT 1`, so it proves **connectivity**, not that the schema
  is migrated — a real sign-up/board write is the true schema check.
  A failure answers `503 {"status":"error","db":"down"}` and nothing else — the
  endpoint is public, so the driver's message (host, port, role, TLS) stays out of
  the body. Read the cause in the runtime logs: `/api/health: database probe failed`.
- Watch runtime logs for the **new deployment** and confirm routes log at `info`,
  not `error` (e.g. `/boards` should be `307 [info]`, not `307 [error]`).

### Rotating the Neon password

1. Neon console → **Roles** → the app role (`neondb_owner`) → **Reset password**.
   The old password stops working immediately, so do the next steps back-to-back.
2. Update `DATABASE_URL` in Vercel (Production) with the new pooled string, then
   **redeploy**.
3. Update your local `.env` if you run migrations/seed against prod.
4. Verify `GET /api/health` → `200 {"status":"ok","db":"up"}`.
