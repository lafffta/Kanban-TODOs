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
| *(from `manual-qa.md`)* Production deploy | [#20](https://github.com/lafffta/Kanban-TODOs/issues/20) | open |
| 11 — Collision-safe fractional ordering | [#21](https://github.com/lafffta/Kanban-TODOs/issues/21) | open |
| 12 — Owner board rename + delete | [#22](https://github.com/lafffta/Kanban-TODOs/issues/22) | open |
| 13 — Generic health-check errors | [#23](https://github.com/lafffta/Kanban-TODOs/issues/23) | open |
| 14 — Normalized email identity | [#24](https://github.com/lafffta/Kanban-TODOs/issues/24) | open |
| 15 — Roll back resolved mutation errors | [#25](https://github.com/lafffta/Kanban-TODOs/issues/25) | open |
| 16 — Atomic assignment + membership removal | [#26](https://github.com/lafffta/Kanban-TODOs/issues/26) | open |
| 17 — Live role-change polling | [#27](https://github.com/lafffta/Kanban-TODOs/issues/27) | open |
| 18 — Visible service-worker sync failures | [#28](https://github.com/lafffta/Kanban-TODOs/issues/28) | open |
| 19 — Guaranteed sign-out data clearing | [#29](https://github.com/lafffta/Kanban-TODOs/issues/29) | open |
| 20 — Former-member attribution on removal | [#30](https://github.com/lafffta/Kanban-TODOs/issues/30) | open |
| 21 — Production dependency advisory triage | [#31](https://github.com/lafffta/Kanban-TODOs/issues/31) | open |

Tickets 01–05 are closed as completed. Tickets 06–10 are code-complete and merged;
they stay open only for a manual demo that needs a real phone or a second account —
each issue spells out exactly what to check. Tickets 11–21 are unstarted.

`DESIGN.md` is unaffected and remains the spec and the record of locked design
decisions (D1–D7).
