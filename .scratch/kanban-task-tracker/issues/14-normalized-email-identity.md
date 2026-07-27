# 14 — Normalized email identity

**What to build:** Make one case-insensitive, whitespace-trimmed email address map
to exactly one account across sign-up, sign-in, and invite acceptance. Accounts
currently store and query the typed casing while invites fold case, allowing two
credential identities to satisfy the same invite. Normalize at every auth
boundary and enforce the invariant in Postgres, including a safe migration for
existing data.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Registration stores a canonical trimmed/lowercase email and sign-in applies the same normalization
- [ ] Postgres enforces uniqueness on the canonical identity, not case-sensitive display text
- [ ] The migration detects pre-existing case-colliding accounts and never merges them silently
- [ ] Invites continue matching the intended account case-insensitively
- [ ] Tests cover mixed-case sign-in, whitespace, duplicate registration, and invite matching
- [ ] User-facing duplicate/credential errors remain generic and do not expose account details
