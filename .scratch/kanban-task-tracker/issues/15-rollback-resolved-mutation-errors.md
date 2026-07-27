# 15 — Roll back resolved mutation errors

**What to build:** Treat a server action result containing `{ error }` as a failed
optimistic mutation. The current mutation layer rolls snapshots back only when an
action throws, so expected refusals such as stale or unauthorized comment deletion
briefly remain applied until a refetch repairs them. Preserve the action's friendly
message while restoring every patched query immediately.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Both thrown failures and resolved `{ error }` results restore every optimistic patch
- [ ] The original friendly action error is returned to the component for display
- [ ] Successful mutations keep their optimistic state until the authoritative refetch lands
- [ ] Board and comment-count patches roll back together as one logical mutation
- [ ] Unit tests cover resolved errors, thrown errors, success, and overlapping query patches
