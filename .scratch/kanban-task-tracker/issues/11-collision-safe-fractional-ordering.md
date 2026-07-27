# 11 — Collision-safe fractional ordering

**What to build:** Make column and card ordering preserve D3's guarantee that two
clients choosing the same slot produce different stored `position` keys. The
current helper randomly chooses one of 16 candidates, so independent writes can
still collide and leave equal neighbours that `generateKeyBetween` cannot order
between. Keep the one-row-per-move fractional-index design, but add a
database-backed collision check and retry strategy for creates and moves.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Column positions are unique within a board and card positions are unique within a column
- [ ] A position collision is retried with a new valid key rather than committed or surfaced as a 500
- [ ] Concurrent creates/moves into the same gap finish with distinct, correctly ordered keys
- [ ] A later insert between every adjacent pair succeeds, including after concurrent writes
- [ ] Integration tests deterministically force the collision path for both columns and cards
