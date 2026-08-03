import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers } from "./schema";
import { createBoard, listBoardMembers, removeMember } from "./boards";
import { createColumn } from "./columns";
import { AssigneeNotBoardMemberError, assignCard, createCard, listCards } from "./cards";

// Concurrency test for the invariant "a card's assignee is a current member of
// that card's board" (ticket 16). The sequential halves of the rule live in
// db/cards.test.ts (a non-member can't be assigned) and db/boards.test.ts
// (removal clears assignments); what's proved here is that the two operations
// can't interleave their way past it — the case application-level
// check-then-write cannot cover, because the check and the write are separate
// statements and anything can commit between them.
//
// Both orderings are exercised, and both are deterministic: a second database
// session pins one uncommitted write in place, `waitForRowLockWait` proves the
// racing operation is genuinely parked on that write's row locks, and only then
// is the pinned session committed. Requires the Docker Postgres from
// docker-compose.yml.

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await closeDb();
});

function uniqueEmail() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function makeUser() {
  return registerUser({ email: uniqueEmail(), password: "correct horse battery" });
}

/** A board with one owner, one plain member, and one card in a single lane. */
async function boardWithMemberAndCard() {
  const owner = await makeUser();
  const member = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });
  const column = await createColumn({
    boardId: board.id,
    name: "To Do",
    userId: owner.id,
  });
  const card = await createCard({
    boardId: board.id,
    columnId: column.id,
    title: "Ship it",
    userId: owner.id,
  });
  return { owner, member, board, card };
}

/** The card's assignee as the board renders it — the read every viewer gets. */
async function assigneeOf(boardId: string, cardId: string): Promise<string | null> {
  const card = (await listCards(boardId)).find((c) => c.id === cardId);
  return card?.assignee?.id ?? null;
}

/**
 * A second database session holding an open transaction, so a test can pin an
 * uncommitted write — and the row locks it takes — while the operation under
 * test runs against the app's own pool.
 */
async function openPinnedSession() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return {
    write: (text: string, params: unknown[]) => client.query(text, params),
    async commit() {
      await client.query("COMMIT");
      await client.end();
    },
  };
}

/**
 * Resolve once some session is waiting on a row lock. This is what makes the
 * interleaving deterministic rather than timing-dependent: the racing operation
 * has demonstrably reached the database and blocked on the pinned write, so the
 * commit that follows really does land in the middle of it. A timeout here is a
 * failure in its own right — nothing blocked, so the two operations never
 * actually raced.
 */
async function waitForRowLockWait(timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting
      from pg_stat_activity
      where wait_event_type = 'Lock' and datname = current_database()
    `);
    if ((result.rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "Timed out waiting for a query to block on a row lock — the operations never raced.",
  );
}

test("a removal landing mid-assignment still leaves the card unassigned", async () => {
  const { owner, member, board, card } = await boardWithMemberAndCard();

  // The assignment is written but not yet committed.
  const assigning = await openPinnedSession();
  await assigning.write(`update cards set assignee_id = $1 where id = $2`, [
    member.id,
    card.id,
  ]);

  // The removal can't see that write, so nothing it reads would warn it off.
  const removal = removeMember({ boardId: board.id, userId: member.id, actorId: owner.id });
  await waitForRowLockWait();
  await assigning.commit();
  await removal;

  expect(await assigneeOf(board.id, card.id)).toBeNull();
  expect((await listBoardMembers(board.id)).map((m) => m.id)).toEqual([owner.id]);
});

test("an assignment landing mid-removal is refused", async () => {
  const { owner, member, board, card } = await boardWithMemberAndCard();

  // The membership is deleted but not yet committed.
  const removing = await openPinnedSession();
  await removing.write(`delete from board_members where board_id = $1 and user_id = $2`, [
    board.id,
    member.id,
  ]);

  // The assignment still reads the member as present, so a membership check
  // before the write would wave it through. Its rejection handler is attached
  // here rather than at the assertion: it fails the instant the removal commits,
  // and an unhandled rejection in the window between would fail the run.
  const assignment = assignCard({
    cardId: card.id,
    assigneeId: member.id,
    userId: owner.id,
  }).catch((error: unknown) => error);
  await waitForRowLockWait();
  await removing.commit();

  expect(await assignment).toBeInstanceOf(AssigneeNotBoardMemberError);
  expect(await assigneeOf(board.id, card.id)).toBeNull();
});
