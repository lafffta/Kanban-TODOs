# 10 — PWA + offline + mobile polish

**What to build:** The app installs to a phone's home screen and, launched offline,
opens straight to the last-seen board read-only. Adds a web manifest
(`display: standalone`, icons, theme color), an app-shell service worker with
network-first data, and a TanStack Query cache **persisted to IndexedDB** so the
installed app opens offline to the last board (clearly stale) behind an "Offline"
banner; any mutation while offline is blocked with a toast (no write queue /
background sync in v1). A custom install affordance uses `beforeinstallprompt`. Final
mobile polish: horizontally-scrolling columns, full-screen card sheet on mobile /
side panel on desktop, touch/scroll tuning.

**Blocked by:** 09 — Near-real-time polling.

**Status:** ready-for-agent

- [ ] Manifest (`display: standalone`, icons, theme color) + app-shell service worker, network-first data
- [ ] Query cache persisted to IndexedDB; launching offline opens the last-seen board read-only
- [ ] "Offline" banner shows offline; mutations are blocked with a toast
- [ ] Custom install button via `beforeinstallprompt`
- [ ] Mobile layout: horizontally-scrolling columns, full-screen card sheet on mobile / side panel on desktop; install to home screen and open offline (demo)
