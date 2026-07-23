# 09 — Near-real-time polling

**What to build:** Two people looking at the same board see each other's changes
within a few seconds without reloading. TanStack Query polls the open board every 4s
and open-card comments every 5s, **pausing when the tab is hidden**
(`refetchIntervalInBackground: false`). A cheap `GET /api/boards/:id/version`
(`max(updated_at)`) guards the full-board refetch so the heavy payload is fetched
only when something changed. Mutations are optimistic and reconcile with polling:
`cancelQueries` on mutate, suppress reconciliation while a mutation is in flight,
`invalidateQueries` on settle, and gate stale polls with a local monotonic version.

**Blocked by:** 08 — Sharing / invites.

**Status:** ready-for-agent

- [ ] Open board polls every 4s; open card's comments poll every 5s; both pause when the tab is hidden
- [ ] `GET /api/boards/:id/version` returns `max(updated_at)` and guards full-board refetch
- [ ] Mutations apply optimistically and reconcile on settle without flicker (cancel/suppress-in-flight/invalidate)
- [ ] Stale polls gated by a local monotonic version
- [ ] A moves a card, B sees it in ~4s; concurrent same-card drag settles last-write-wins with no duplicate/precision collision (demo)
