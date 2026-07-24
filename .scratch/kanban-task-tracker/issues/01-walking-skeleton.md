# 01 — Walking skeleton

**What to build:** A deployed, end-to-end-wired Next.js app that proves the whole
pipe works before any feature exists. From a browser, a visitor can load a deployed
"hello" page whose content confirms the app can talk to the database. Scaffolds
Next.js 15 (App Router, TS, React 19) + Tailwind, wires Drizzle ORM against Neon's
**pooled** Postgres endpoint (Docker Postgres locally), applies one initial
migration, and deploys to Vercel.

**Blocked by:** None — can start immediately.

**Status:** ✅ done — deployed & verified end to end on `main` (merged from `feat/01-walking-skeleton`)

- [x] Next.js 15 App Router + TypeScript + Tailwind scaffold builds and runs locally *(verified: build + dev-server 200)*
- [x] Drizzle + drizzle-kit configured; connects via the Neon **pooled** endpoint (`@neondatabase/serverless`), Docker Postgres for local dev *(both drivers wired in `db/index.ts`; local `pg` driver exercised live against Docker Postgres 16, Neon pooled serverless path verified in prod)*
- [x] One migration is authored and applied (a trivial table is fine) *(authored: `drizzle/0000_new_magik.sql` → `greetings`; applied to Docker locally and to Neon via `npm run db:migrate`)*
- [x] A "hello" page renders data fetched through the DB connection, proving the round trip *(round-trip test green — 1 passed; prod page serves the greeting live: "✅ Fetched from Postgres — the pipe works end to end.")*
- [x] App is deployed to Vercel and the hello page is reachable at its URL *(live at https://kanban-task-tracker-kohl.vercel.app — HTTP 200, renders "Hello from Postgres 👋" from Neon; Vercel project `aidan18/kanban-task-tracker`, Node 22.x, `DATABASE_DRIVER=neon` + pooled `DATABASE_URL`)*

**Complete** — all acceptance criteria met; the pipe is proven browser → Vercel → Neon Postgres and back.
