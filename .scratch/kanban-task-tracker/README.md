# Issue tracking has moved to GitHub Issues

This directory used to hold the ticket markdown files (`issues/01-*.md` … `issues/21-*.md`),
a `manual-qa.md` checklist, and a root `TODO.md`. They are gone — **GitHub Issues is
now the single source of truth**. Their content was migrated verbatim, and the old
files remain recoverable in git history if you need them.

Nothing here should be updated by hand any more. Open, edit, and close issues on GitHub:

    https://github.com/lafffta/Kanban-TODOs/issues

## Where each ticket went

Issue numbers are offset from ticket numbers, because GitHub shares one numbering
sequence between issues and pull requests (PRs #1–#9 came first).

| Ticket | Issue | State |
| --- | --- | --- |
| 01 — Walking skeleton | [#10](https://github.com/lafffta/Kanban-TODOs/issues/10) | closed |
| 02 — Auth (Credentials + JWT) | [#11](https://github.com/lafffta/Kanban-TODOs/issues/11) | closed |
| 03 — Boards + membership | [#12](https://github.com/lafffta/Kanban-TODOs/issues/12) | closed |
| 04 — Columns | [#13](https://github.com/lafffta/Kanban-TODOs/issues/13) | closed |
| 05 — Cards + assignees | [#14](https://github.com/lafffta/Kanban-TODOs/issues/14) | closed |
| 06 — Drag & drop cards | [#15](https://github.com/lafffta/Kanban-TODOs/issues/15) | open — phone demo |
| 07 — Comments | [#16](https://github.com/lafffta/Kanban-TODOs/issues/16) | open — two-user demo |
| 08 — Sharing / invites | [#17](https://github.com/lafffta/Kanban-TODOs/issues/17) | open — invite demo |
| 09 — Near-real-time polling | [#18](https://github.com/lafffta/Kanban-TODOs/issues/18) | open — two-user demo |
| 10 — PWA + offline + mobile polish | [#19](https://github.com/lafffta/Kanban-TODOs/issues/19) | open — device demo |
| *(from `manual-qa.md`)* Production deploy | [#20](https://github.com/lafffta/Kanban-TODOs/issues/20) | open — needs prod credentials |
| 11 — Collision-safe fractional ordering | [#21](https://github.com/lafffta/Kanban-TODOs/issues/21) | closed |
| 12 — Owner board rename + delete | [#22](https://github.com/lafffta/Kanban-TODOs/issues/22) | closed |
| 13 — Generic health-check errors | [#23](https://github.com/lafffta/Kanban-TODOs/issues/23) | closed |
| 14 — Normalized email identity | [#24](https://github.com/lafffta/Kanban-TODOs/issues/24) | closed |
| 15 — Roll back resolved mutation errors | [#25](https://github.com/lafffta/Kanban-TODOs/issues/25) | closed |
| 16 — Atomic assignment + membership removal | [#26](https://github.com/lafffta/Kanban-TODOs/issues/26) | closed |
| 17 — Live role-change polling | [#27](https://github.com/lafffta/Kanban-TODOs/issues/27) | closed |
| 18 — Visible service-worker sync failures | [#28](https://github.com/lafffta/Kanban-TODOs/issues/28) | closed |
| 19 — Guaranteed sign-out data clearing | [#29](https://github.com/lafffta/Kanban-TODOs/issues/29) | closed |
| 20 — Former-member attribution on removal | [#30](https://github.com/lafffta/Kanban-TODOs/issues/30) | closed |
| 21 — Production dependency advisory triage | [#31](https://github.com/lafffta/Kanban-TODOs/issues/31) | closed |

## The code backlog is empty

Every ticket 01–21 is written, merged to `main`, and closed. **The six issues still
open need a human with hardware or credentials — none of them is a coding task**, so
an agent looking for the next thing to implement will not find one here:

- **#15–#19** are code-complete and merged. Every acceptance criterion is ticked
  except the last box on each, which is a manual demo that needs something no
  container has: a **real phone** (#15's touch timing, #19's install prompt and
  offline launch) or a **second account driven by a second person** (#16's two-user
  thread, #17's invite acceptance, #18's concurrent same-card drag). Each issue
  spells out exactly what to check.
- **#20** is the production deploy. It needs Neon and Vercel credentials, and the
  issue is explicit that prod DB changes and deploys are user-triggered and must not
  run automatically.

Note that #20's body is itself stale on one point: it was written when the newest
migration was `0008`, and `drizzle/` is now through `0012`. Re-read the migration
list before acting on it.

New work should be filed as a new GitHub issue rather than added to this table.

`DESIGN.md` is unaffected and remains the spec and the record of locked design
decisions (D1–D8).
