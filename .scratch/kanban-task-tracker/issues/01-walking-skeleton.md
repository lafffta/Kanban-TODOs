# 01 — Walking skeleton

**What to build:** A deployed, end-to-end-wired Next.js app that proves the whole
pipe works before any feature exists. From a browser, a visitor can load a deployed
"hello" page whose content confirms the app can talk to the database. Scaffolds
Next.js 15 (App Router, TS, React 19) + Tailwind, wires Drizzle ORM against Neon's
**pooled** Postgres endpoint (Docker Postgres locally), applies one initial
migration, and deploys to Vercel.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Next.js 15 App Router + TypeScript + Tailwind scaffold builds and runs locally
- [ ] Drizzle + drizzle-kit configured; connects via the Neon **pooled** endpoint (`@neondatabase/serverless`), Docker Postgres for local dev
- [ ] One migration is authored and applied (a trivial table is fine)
- [ ] A "hello" page renders data fetched through the DB connection, proving the round trip
- [ ] App is deployed to Vercel and the hello page is reachable at its URL
