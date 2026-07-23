import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDb } from "./index";
import { addGreeting, getLatestGreeting } from "./queries";

// Walking-skeleton integration test: proves the authored migration applies to a
// real Postgres and that the app can write and read a row back through Drizzle.
// Requires the Docker Postgres from docker-compose.yml to be running.

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await closeDb();
});

test("an inserted greeting is read back as the latest greeting", async () => {
  const message = `hello-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const inserted = await addGreeting(message);
  expect(inserted.id).toBeGreaterThan(0);
  expect(inserted.message).toBe(message);

  const latest = await getLatestGreeting();
  expect(latest).toBe(message);
});
