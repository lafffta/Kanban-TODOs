# 18 — Visible service-worker sync failures

**What to build:** Preserve useful cached data for a true offline launch without
turning a failed live poll into an indistinguishable cached HTTP 200. When the
browser reports online but DNS, the deployment, or the API is unreachable, the
board must visibly enter the existing “Not syncing” state instead of appearing
current forever. Adjust service-worker routing and/or mark cached fallbacks so the
query layer can distinguish stale data from a successful live response.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] A failed live version poll is observable by the query layer and sets `outOfSync`
- [ ] Cached board data remains readable during an offline launch
- [ ] `navigator.onLine === true` plus an unreachable server displays a stale/not-syncing warning
- [ ] Reconnection clears the warning and resumes authoritative polling automatically
- [ ] Service-worker strategy tests cover network success, true offline fallback, and server/DNS failure
