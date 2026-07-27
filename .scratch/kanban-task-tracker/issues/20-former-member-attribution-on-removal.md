# 20 — Former-member attribution on removal

**What to build:** Align membership removal with the completed card/comment ticket
criteria. Removing someone from a board must preserve their cards and comments but
detach the board-visible authorship fields so the content renders as “Former
member.” The current foreign keys only clear those fields when the entire user
account is deleted, while `removeMember` deletes only `board_members`.

**Blocked by:** None — can start immediately.

**Status:** ready

- [ ] Removing a member keeps every card and comment they created on that board
- [ ] Their card `createdById`, comment `authorId`, and card assignments are cleared for that board
- [ ] Content they created on other boards is unchanged
- [ ] The UI renders preserved comments as “Former member” after removal and polling
- [ ] Integration tests remove only the membership—not the user account—and assert the stored/resulting attribution
