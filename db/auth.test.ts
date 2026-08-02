import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./index";
import { users } from "./schema";
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

// --- Canonical email identity (ticket 14) ---
// One address = one account, however it was typed. Registration canonicalizes,
// sign-in canonicalizes the same way, and Postgres holds the invariant.

test("registration stores the canonical address, trimmed and lowercased", async () => {
  const canonical = uniqueEmail();
  const typed = `  ${canonical.toUpperCase()}  `;

  const user = await registerUser({ email: typed, password: "correct horse battery" });
  expect(user.email).toBe(canonical);
});

test("sign-in matches the account whatever case or padding was typed", async () => {
  const canonical = uniqueEmail();
  const user = await registerUser({
    email: canonical,
    password: "correct horse battery",
  });

  for (const typed of [
    canonical.toUpperCase(),
    `  ${canonical}  `,
    ` ${canonical.toUpperCase()} `,
  ]) {
    expect((await verifyCredentials(typed, "correct horse battery"))?.id).toBe(user.id);
    expect(
      (await authorizeCredentials({ email: typed, password: "correct horse battery" }))
        ?.id,
    ).toBe(user.id);
  }

  // Canonicalizing must not weaken the password check.
  expect(await verifyCredentials(canonical.toUpperCase(), "wrong")).toBeNull();
});

test("a second account cannot claim the same address in a different case", async () => {
  const canonical = uniqueEmail();
  const first = await createAccount({ email: canonical, password: "longenough1" });
  expect(first.ok).toBe(true);

  const dup = await createAccount({
    email: ` ${canonical.toUpperCase()} `,
    password: "longenough1",
  });
  expect(dup.ok).toBe(false);
  // Generic: the refusal says the address is taken, never whose it is or how it
  // was originally typed.
  if (!dup.ok) {
    expect(dup.error).toBe("That email is already registered.");
    expect(dup.error).not.toContain(canonical);
  }
});

/** Whether a thrown error is (or wraps) a Postgres unique violation. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e != null; e = (e as { cause?: unknown }).cause) {
    if (typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

test("Postgres refuses a case-colliding account even when the app is bypassed", async () => {
  const canonical = uniqueEmail();
  await db.insert(users).values({ email: canonical });

  // A writer that skips `registerUser` — a future OAuth adapter, a seed script —
  // still cannot mint a second identity for the same address.
  const collision = await db
    .insert(users)
    .values({ email: canonical.toUpperCase() })
    .then(
      () => null,
      (err: unknown) => err,
    );
  expect(isUniqueViolation(collision)).toBe(true);
});
