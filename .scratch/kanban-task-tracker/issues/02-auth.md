# 02 — Auth (Credentials + JWT)

**What to build:** A visitor can create an account with email + password, sign in,
and sign out; a protected route is inaccessible when logged out and visible when
logged in. Uses Auth.js v5 (`next-auth@beta`) with the Drizzle adapter, the
**Credentials** provider, and the **JWT** session strategy (Credentials requires
JWT). Passwords are hashed with argon2 (`@node-rs/argon2`). Auth.js adapter tables
(`accounts`, `sessions`, `verificationTokens`) are created but reserved for future
OAuth.

**Blocked by:** 01 — Walking skeleton.

**Status:** code-complete — pending review + commit

- [x] `users` table exists with `passwordHash`; sign-up creates a user with an argon2 hash
- [x] Sign in with correct credentials establishes a JWT session; wrong credentials are rejected
- [x] Sign out clears the session
- [x] A protected route redirects to sign-in when logged out and renders when logged in
- [x] Server-action / route inputs validated with Zod
