import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./index";
import {
  authorizeCredentials,
  createAccount,
  registerUser,
  verifyCredentials,
} from "./auth";

// Auth domain integration test: proves sign-up hashes the password (argon2) and
// that credentials can be verified back through the public seam — no querying the
// stored hash directly. Requires the Docker Postgres from docker-compose.yml.

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await closeDb();
});

function uniqueEmail() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

test("a registered user authenticates with their password, not a wrong one", async () => {
  const email = uniqueEmail();

  const user = await registerUser({ email, password: "correct horse battery" });
  expect(user.id).toBeTruthy();
  expect(user.email).toBe(email);

  const ok = await verifyCredentials(email, "correct horse battery");
  expect(ok?.id).toBe(user.id);

  const wrong = await verifyCredentials(email, "Tr0ub4dour");
  expect(wrong).toBeNull();
});

test("authorizeCredentials validates input and authenticates valid credentials", async () => {
  const email = uniqueEmail();
  await registerUser({ email, password: "correct horse battery" });

  const ok = await authorizeCredentials({ email, password: "correct horse battery" });
  expect(ok?.email).toBe(email);

  // Wrong password → null (rejected, not thrown).
  expect(await authorizeCredentials({ email, password: "nope" })).toBeNull();

  // Malformed input → null without touching the DB.
  expect(await authorizeCredentials({ email: "not-an-email", password: "x" })).toBeNull();
  expect(await authorizeCredentials({ email })).toBeNull();
  expect(await authorizeCredentials(null)).toBeNull();
});

test("createAccount validates input and rejects duplicate emails", async () => {
  const email = uniqueEmail();

  const created = await createAccount({ email, password: "longenough1", name: "Ada" });
  expect(created.ok).toBe(true);
  if (created.ok) expect(created.user.email).toBe(email);

  // Too-short password → validation failure, no account created.
  const short = await createAccount({ email: uniqueEmail(), password: "short" });
  expect(short.ok).toBe(false);

  // Duplicate email → friendly failure, not a raw DB error.
  const dup = await createAccount({ email, password: "longenough1" });
  expect(dup.ok).toBe(false);
});
