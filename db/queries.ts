import { desc, sql } from "drizzle-orm";
import { db } from "./index";
import { greetings, type Greeting } from "./schema";

/**
 * Lightweight DB connectivity check for the /api/health probe. Runs `SELECT 1`
 * rather than touching a table so it stays cheap and independent of any schema.
 * Throws if the pool can't reach Postgres.
 */
export async function checkDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}

/** The most recently created greeting's message, or null if the table is empty. */
export async function getLatestGreeting(): Promise<string | null> {
  const rows = await db
    .select()
    .from(greetings)
    .orderBy(desc(greetings.createdAt), desc(greetings.id))
    .limit(1);
  return rows[0]?.message ?? null;
}

/** Insert a greeting and return the created row. */
export async function addGreeting(message: string): Promise<Greeting> {
  const [row] = await db.insert(greetings).values({ message }).returning();
  return row;
}
