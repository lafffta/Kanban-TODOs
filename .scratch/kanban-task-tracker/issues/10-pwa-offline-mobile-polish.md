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

**Status:** done (bar the demo)

- [x] Manifest (`display: standalone`, icons, theme color) + app-shell service worker, network-first data
- [x] Query cache persisted to IndexedDB; launching offline opens the last-seen board read-only
- [x] "Offline" banner shows offline; mutations are blocked with a toast
- [x] Custom install button via `beforeinstallprompt`
- [ ] Mobile layout: horizontally-scrolling columns, full-screen card sheet on mobile / side panel on desktop; install to home screen and open offline (demo)

Everything but the home-screen install was exercised against a production build in a
real (phone-sized) browser: the worker registers at scope `/`, a launch with the
network cut opens the last-seen board behind the "Offline" banner, and a save from
the card sheet is refused with the toast. What a headless browser can't produce is
`beforeinstallprompt` itself — see `TODO.md` for the device demo.
