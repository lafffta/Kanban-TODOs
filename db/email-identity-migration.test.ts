import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, expect, test } from "vitest";
import { Client } from "pg";

// Ticket 14's migration is the half that can't be re-run into place: it rewrites
// rows that already exist. So run the real file — read off disk, statement by
// statement — against a scratch schema holding the *pre*-migration shape (emails
// unique on the typed text), and check both outcomes: it canonicalizes a clean
// table, and it refuses a table where two accounts already share an address.
//
// Requires the Docker Postgres from docker-compose.yml. Uses its own connection
// rather than the app's pool, because every statement here depends on a
// session-scoped `search_path` and a pool hands out whichever connection it likes.

const SCHEMA = "ticket14_migration_check";
const MIGRATION_FILE = "./drizzle/0010_normalized_email_identity.sql";

const client = new Client({ connectionString: process.env.DATABASE_URL });
const connected = client.connect();

beforeEach(async () => {
  await connected;
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await client.query(`CREATE SCHEMA "${SCHEMA}"`);
  await client.query(`SET search_path TO "${SCHEMA}"`);
  // The shape as of 0009: identity is the typed text.
  await client.query(`
    CREATE TABLE "users" (
      "id" text PRIMARY KEY,
      "email" text NOT NULL,
      CONSTRAINT "users_email_unique" UNIQUE("email")
    )`);
  await client.query(
    `CREATE TABLE "board_invites" ("id" text PRIMARY KEY, "email" text NOT NULL)`,
  );
});

afterAll(async () => {
  await connected;
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await client.end();
});

async function givenAccounts(...emails: string[]): Promise<void> {
  for (const [i, email] of emails.entries()) {
    await client.query(`INSERT INTO "users" ("id", "email") VALUES ($1, $2)`, [
      `u${i}`,
      email,
    ]);
  }
}

/**
 * Apply the migration the way the drizzle migrator does — split on its statement
 * breakpoints, in order. (The migrator also wraps the run in a transaction, so in
 * production a refusal rolls the whole thing back; here each statement stands
 * alone, which is the stricter test of "nothing was changed before the refusal".)
 */
async function runMigration(): Promise<void> {
  const file = await readFile(MIGRATION_FILE, "utf8");
  for (const statement of file.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function storedEmails(): Promise<string[]> {
  const { rows } = await client.query<{ email: string }>(
    `SELECT "email" FROM "users" ORDER BY "id"`,
  );
  return rows.map((r) => r.email);
}

test("the migration folds existing accounts onto their canonical address", async () => {
  await givenAccounts("Ada@Example.com", "  bob@x.com  ", "carol@x.com");
  await client.query(
    `INSERT INTO "board_invites" ("id", "email") VALUES ('i0', 'Dave@X.com')`,
  );

  await runMigration();

  expect(await storedEmails()).toEqual(["ada@example.com", "bob@x.com", "carol@x.com"]);
  const { rows: invites } = await client.query<{ email: string }>(
    `SELECT "email" FROM "board_invites"`,
  );
  expect(invites[0].email).toBe("dave@x.com");

  // And from here on the database is the one holding the invariant — over both
  // halves of the canonical form, so the state just cleaned up can't recur.
  for (const [id, bypass] of [
    ["u9", "ADA@example.com"],
    ["u10", "  ada@example.com  "],
  ]) {
    await expect(
      client.query(`INSERT INTO "users" ("id", "email") VALUES ($1, $2)`, [id, bypass]),
    ).rejects.toMatchObject({ code: "23505" });
  }
});

test("the migration refuses to merge accounts that already collide", async () => {
  await givenAccounts("ada@x.com", "Ada@X.com", "solo@x.com");

  const refusal = await runMigration().then(
    () => null,
    (err: { code?: string; message?: string; hint?: string }) => err,
  );

  // Raised by the guard, not by a unique-index build: the operator gets told
  // which accounts to look at.
  expect(refusal?.code).toBe("P0001");
  expect(refusal?.message).toContain("ada@x.com");
  expect(refusal?.message).toContain("Ada@X.com");
  expect(refusal?.hint).toContain("will not pick a winner");

  // Nothing was merged, renamed, or dropped on the way to the refusal.
  expect(await storedEmails()).toEqual(["ada@x.com", "Ada@X.com", "solo@x.com"]);
});
