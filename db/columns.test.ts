import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { closeDb, db } from "./index";
import { registerUser } from "./auth";
import { boardMembers, columns } from "./schema";
import { createBoard } from "./boards";
import {
  ColumnNotFoundError,
  createColumn,
  deleteColumn,
  listColumns,
  renameColumn,
  reorderColumn,
} from "./columns";
import { keyBetween } from "./ordering";

// Columns integration test: proves a member can create / rename / reorder / delete
// columns on their board, that lanes list in `position` order, that a reorder
// generates a fractional key between neighbours and rewrites exactly one row, and
// that every mutation is refused for a non-member. Requires the Docker Postgres
// from docker-compose.yml.

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

async function makeBoard() {
  const owner = await makeUser();
  const board = await createBoard({ name: "Board", ownerId: owner.id });
  return { owner, board };
}

test("keyBetween orders keys and its jitter stays within the gap", () => {
  const first = keyBetween(null, null);
  const second = keyBetween(first, null);
  expect(first < second).toBe(true);

  // A jittered key still sorts strictly between its neighbours.
  const mid = keyBetween(first, second);
  expect(first < mid && mid < second).toBe(true);

  // Deterministic mode returns the plain midpoint (no randomness).
  expect(keyBetween(first, second, { jitter: false })).toBe(
    keyBetween(first, second, { jitter: false }),
  );
});

test("createColumn appends lanes and lists them in position order", async () => {
  const { owner, board } = await makeBoard();

  const todo = await createColumn({ boardId: board.id, name: "To Do", userId: owner.id });
  const doing = await createColumn({ boardId: board.id, name: "Doing", userId: owner.id });
  const done = await createColumn({ boardId: board.id, name: "Done", userId: owner.id });

  const lanes = await listColumns(board.id);
  expect(lanes.map((c) => c.name)).toEqual(["To Do", "Doing", "Done"]);
  // Positions are strictly ascending in listed order.
  expect(todo.position < doing.position && doing.position < done.position).toBe(true);
});

test("listColumns is scoped to its board", async () => {
  const { owner, board } = await makeBoard();
  const other = await createBoard({ name: "Other", ownerId: owner.id });

  await createColumn({ boardId: board.id, name: "Here", userId: owner.id });
  await createColumn({ boardId: other.id, name: "There", userId: owner.id });

  expect((await listColumns(board.id)).map((c) => c.name)).toEqual(["Here"]);
  expect((await listColumns(other.id)).map((c) => c.name)).toEqual(["There"]);
});

test("a plain member (not just the owner) can create and rename columns", async () => {
  const { board } = await makeBoard();
  const member = await makeUser();
  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: member.id, role: "member" });

  const col = await createColumn({ boardId: board.id, name: "Backlog", userId: member.id });
  const renamed = await renameColumn({
    columnId: col.id,
    name: "Icebox",
    userId: member.id,
  });
  expect(renamed.name).toBe("Icebox");
});

test("reorderColumn moves a lane between neighbours, rewriting exactly one row", async () => {
  const { owner, board } = await makeBoard();
  const a = await createColumn({ boardId: board.id, name: "A", userId: owner.id });
  const b = await createColumn({ boardId: board.id, name: "B", userId: owner.id });
  const c = await createColumn({ boardId: board.id, name: "C", userId: owner.id });

  // Move C to the front: [A, B, C] -> [C, A, B]. Its new neighbours are (null, A).
  const moved = await reorderColumn({
    columnId: c.id,
    beforeId: null,
    afterId: a.id,
    userId: owner.id,
  });

  expect((await listColumns(board.id)).map((col) => col.name)).toEqual(["C", "A", "B"]);
  // Exactly one row changed: only C's position moved; A and B are untouched.
  expect(moved.position < a.position).toBe(true);
  const after = Object.fromEntries((await listColumns(board.id)).map((x) => [x.id, x.position]));
  expect(after[a.id]).toBe(a.position);
  expect(after[b.id]).toBe(b.position);
});

test("reorderColumn places a lane between two others", async () => {
  const { owner, board } = await makeBoard();
  const a = await createColumn({ boardId: board.id, name: "A", userId: owner.id });
  const b = await createColumn({ boardId: board.id, name: "B", userId: owner.id });
  const c = await createColumn({ boardId: board.id, name: "C", userId: owner.id });

  // Move A between B and C: [A, B, C] -> [B, A, C].
  await reorderColumn({ columnId: a.id, beforeId: b.id, afterId: c.id, userId: owner.id });
  expect((await listColumns(board.id)).map((col) => col.name)).toEqual(["B", "A", "C"]);
});

test("deleteColumn removes only that lane", async () => {
  const { owner, board } = await makeBoard();
  const a = await createColumn({ boardId: board.id, name: "A", userId: owner.id });
  const b = await createColumn({ boardId: board.id, name: "B", userId: owner.id });

  await deleteColumn({ columnId: a.id, userId: owner.id });
  // Only A is gone; B survives, untouched, by id.
  expect((await listColumns(board.id)).map((col) => col.id)).toEqual([b.id]);
});

test("column mutations are refused for a non-member", async () => {
  const { owner, board } = await makeBoard();
  const outsider = await makeUser();
  const col = await createColumn({ boardId: board.id, name: "Secret", userId: owner.id });

  const denied = { name: "BoardAccessError", reason: "not-a-member" };
  await expect(
    createColumn({ boardId: board.id, name: "Nope", userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    renameColumn({ columnId: col.id, name: "Nope", userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    reorderColumn({ columnId: col.id, beforeId: null, afterId: null, userId: outsider.id }),
  ).rejects.toMatchObject(denied);
  await expect(
    deleteColumn({ columnId: col.id, userId: outsider.id }),
  ).rejects.toMatchObject(denied);

  // And nothing was actually mutated or deleted.
  const [still] = await db.select().from(columns).where(eq(columns.id, col.id));
  expect(still?.name).toBe("Secret");
});

test("acting on a missing column raises ColumnNotFoundError", async () => {
  const { owner } = await makeBoard();
  await expect(
    renameColumn({ columnId: "no-such-column", name: "X", userId: owner.id }),
  ).rejects.toBeInstanceOf(ColumnNotFoundError);
});

// --- Collision-safe ordering (ticket 11) -----------------------------------

test("a column position collision is retried instead of surfacing as an error", async () => {
  const { owner, board } = await makeBoard();
  const first = await createColumn({ boardId: board.id, name: "Todo", userId: owner.id });

  // Force the exact key that is already taken, then fall back to the real
  // generator — random jitter can't be relied on to reproduce a collision.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return first.position;
    }
    return keyBetween(before, after);
  };

  const second = await createColumn(
    { boardId: board.id, name: "Doing", userId: owner.id },
    { generate },
  );

  expect(forced).toBe(true);
  expect(second.position).not.toBe(first.position);
  // The retry still appends: the new lane sorts after the existing one.
  expect(second.position > first.position).toBe(true);

  const lanes = await listColumns(board.id);
  expect(lanes.map((c) => c.name)).toEqual(["Todo", "Doing"]);
});

test("column positions are unique within a board but may repeat across boards", async () => {
  const owner = await makeUser();
  const boardA = await createBoard({ name: "A", ownerId: owner.id });
  const boardB = await createBoard({ name: "B", ownerId: owner.id });

  const a = await createColumn({ boardId: boardA.id, name: "Todo", userId: owner.id });

  // The same key on a *different* board is fine — the index is scoped per board.
  await expect(
    db.insert(columns).values({ boardId: boardB.id, name: "Todo", position: a.position }),
  ).resolves.toBeDefined();

  // ...but a second lane on the *same* board can never reuse the key.
  await expect(
    db.insert(columns).values({ boardId: boardA.id, name: "Dupe", position: a.position }),
  ).rejects.toThrow();
});

test("concurrent column creates into the same gap all get distinct, ordered keys", async () => {
  const { owner, board } = await makeBoard();

  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createColumn({ boardId: board.id, name: `Lane ${i}`, userId: owner.id }),
    ),
  );

  const positions = created.map((c) => c.position);
  expect(new Set(positions).size).toBe(positions.length);

  // Every adjacent pair still admits a later insert — the gap isn't poisoned.
  const ordered = [...positions].sort();
  for (let i = 0; i < ordered.length - 1; i++) {
    const between = keyBetween(ordered[i], ordered[i + 1]);
    expect(ordered[i] < between && between < ordered[i + 1]).toBe(true);
  }
});

test("a column reorder collision narrows into the gap instead of re-rolling", async () => {
  const { owner, board } = await makeBoard();
  const a = await createColumn({ boardId: board.id, name: "A", userId: owner.id });
  const b = await createColumn({ boardId: board.id, name: "B", userId: owner.id });
  const c = await createColumn({ boardId: board.id, name: "C", userId: owner.id });
  const d = await createColumn({ boardId: board.id, name: "D", userId: owner.id });

  // Move A between B and D. C already sits strictly *inside* that gap, so forcing
  // C's key exercises the narrowing branch (upper = collided key) rather than the
  // re-roll branch a key equal to `before` would hit.
  let forced = false;
  const generate = (before: string | null, after: string | null) => {
    if (!forced) {
      forced = true;
      return c.position;
    }
    return keyBetween(before, after);
  };

  const moved = await reorderColumn(
    { columnId: a.id, beforeId: b.id, afterId: d.id, userId: owner.id },
    { generate },
  );

  expect(forced).toBe(true);
  expect(moved.position).not.toBe(c.position);
  // Narrowed: strictly above B and strictly below the key that collided.
  expect(b.position < moved.position && moved.position < c.position).toBe(true);

  expect((await listColumns(board.id)).map((l) => l.name)).toEqual(["B", "A", "C", "D"]);
});
