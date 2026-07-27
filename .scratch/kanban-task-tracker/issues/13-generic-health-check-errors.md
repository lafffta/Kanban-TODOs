# 13 — Generic health-check errors

**What to build:** Keep `/api/health` useful as an unauthenticated readiness probe
without returning raw database-driver messages. Detailed connection failures can
contain hostnames, TLS details, or other infrastructure information; record those
server-side and return only the generic response shape promised by `DESIGN.md`.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] A successful probe still returns `200 { "status": "ok", "db": "up" }`
- [ ] Any database failure returns only `503 { "status": "error", "db": "down" }`
- [ ] Raw error messages, connection strings, hosts, and stack traces never enter the response body
- [ ] The detailed failure is logged server-side in a form suitable for production diagnosis
- [ ] Route tests cover both success and a representative driver failure
