# 01 — Walking skeleton

**What to build:** A deployed, end-to-end-wired Next.js app that proves the whole
pipe works before any feature exists. From a browser, a visitor can load a deployed
"hello" page whose content confirms the app can talk to the database. Scaffolds
Next.js 15 (App Router, TS, React 19) + Tailwind, wires Drizzle ORM against Neon's
**pooled** Postgres endpoint (Docker Postgres locally), applies one initial
migration, and deploys to Vercel.

**Blocked by:** None — can start immediately.

**Status:** in-progress — local slice complete & verified on `feat/01-walking-skeleton`; only the Vercel deploy remains (handed off)

- [x] Next.js 15 App Router + TypeScript + Tailwind scaffold builds and runs locally *(verified: build + dev-server 200)*
- [x] Drizzle + drizzle-kit configured; connects via the Neon **pooled** endpoint (`@neondatabase/serverless`), Docker Postgres for local dev *(both drivers wired in `db/index.ts`; local `pg` driver exercised live against Docker Postgres 16)*
- [x] One migration is authored and applied (a trivial table is fine) *(authored: `drizzle/0000_new_magik.sql` → `greetings`; applied via `npm run db:migrate` — "migrations applied successfully")*
- [x] A "hello" page renders data fetched through the DB connection, proving the round trip *(round-trip test green — 1 passed; prod build serves the greeting live: "✅ Fetched from Postgres — the pipe works end to end.")*
- [ ] App is deployed to Vercel and the hello page is reachable at its URL *(deploy handed off — steps in `README.md`; needs a Neon account + Vercel login)*

**To finish (user):** follow the README "Deploying to Vercel (hand-off)" section (Neon pooled URL + Vercel import) to close the last item.
