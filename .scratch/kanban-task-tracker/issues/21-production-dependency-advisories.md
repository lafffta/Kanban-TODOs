# 21 — Production dependency advisory triage

**What to build:** Resolve or explicitly disposition the high-severity production
advisories currently reported by `npm audit --omit=dev` through Next.js, PostCSS,
and Sharp. Do not apply the audit tool's suggested downgrade or a blind
`--force`; identify patched compatible versions, assess whether each vulnerable
path is reachable in this app, and upgrade the smallest safe dependency set.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Each current production advisory is mapped to its dependency path and reachable app surface
- [ ] Next.js/transitive packages are upgraded to compatible patched versions where available
- [ ] No high-severity production advisory remains without a documented, evidence-backed exception
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass after the upgrade
- [ ] Lockfile changes are intentional and reviewed; no unrelated major downgrade or forced audit rewrite is introduced
- [ ] Deployment smoke checks cover authentication, board rendering, and any image/CSS processing path affected by the upgrade
