# Kanban Task Tracker

A mobile-first, installable-PWA kanban board for teams. See [`DESIGN.md`](./DESIGN.md)
for the full spec and locked design decisions, and [`.scratch/kanban-task-tracker/issues`](./.scratch/kanban-task-tracker/issues)
for the tracer-bullet tickets.

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
queued (no background sync in v1). Signing out clears both the persisted cache
and the worker's caches — they hold the signed-in user's boards.

`AUTH_TRUST_HOST` is only needed for a local production run; Vercel sets it.

Icons are generated, not hand-drawn — `node scripts/generate-icons.mjs` redraws
`public/icons/` from source.

---

## Deploying to Vercel (hand-off)

The app is deploy-ready. To put the hello page live:

1. **Create a Neon project** and copy its **pooled** connection string
   (the host contains `-pooler`), e.g.
   `postgres://user:pass@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`.
2. **Import the repo into Vercel** (New Project → pick this repo).
3. Set **Environment Variables** in Vercel:
   - `DATABASE_URL` = the Neon **pooled** string above
   - `DATABASE_DRIVER` = `neon`
4. Ensure the project's **Node.js version is 22.x** (Neon's WebSocket pool; the
   `ws` polyfill in `db/index.ts` covers older runtimes, but 22+ is cleanest).
5. **Apply the migration to Neon** once, from your machine:
   ```bash
   DATABASE_URL='<neon-pooled-url>' DATABASE_DRIVER=neon npm run db:migrate
   DATABASE_URL='<neon-pooled-url>' DATABASE_DRIVER=neon npm run db:seed
   ```
6. **Deploy.** The hello page at the Vercel URL should read the greeting from Neon.
