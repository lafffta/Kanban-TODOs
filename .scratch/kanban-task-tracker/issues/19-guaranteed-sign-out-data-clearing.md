# 19 — Guaranteed sign-out data clearing

**What to build:** Make the ticket-10 privacy guarantee real under blocked
IndexedDB deletion, an unresponsive/missing service worker, and multiple open tabs.
Sign-out must not complete while another account's cached pages, query data, or
last-board pointer can still be restored on the device. Clear in-memory data too,
coordinate other tabs, and use a cleanup mechanism whose failure is explicit
rather than silently accepted after a timeout.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Sign-out clears the in-memory QueryClient, persisted IndexedDB data, last-board storage, and app-owned Cache Storage entries
- [ ] Cleanup works when more than one tab from the same app is open
- [ ] A blocked IndexedDB delete and an unresponsive/missing worker cannot silently report success
- [ ] After sign-out, killing the network and relaunching cannot reveal the previous account's boards
- [ ] Automated tests cover normal cleanup, blocked storage, worker timeout, and cross-tab behavior
- [ ] The production/manual acceptance check from `TODO.md` is rerun on a shared-device scenario
