# 16 — Atomic assignment + membership removal

**What to build:** Enforce the invariant that a card's assignee is a current member
of the same board even when assignment and member removal happen concurrently.
Today assignment checks membership before updating, while removal clears
assignments before deleting membership; the operations can interleave and leave a
removed user assigned. Coordinate the relevant membership and card writes in the
database rather than relying on check-then-write timing.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Assigning a current member succeeds and assigning a non-member is refused
- [ ] Removing a member always leaves every card on that board unassigned from them
- [ ] Concurrent assign/remove operations cannot commit a stale assignee
- [ ] The invariant is protected transactionally or by a database constraint, not only application sequencing
- [ ] A deterministic integration test exercises both concurrency orderings
