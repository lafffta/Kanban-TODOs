import { desc } from "drizzle-orm";
import { db } from "./index";
import { greetings, type Greeting } from "./schema";

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
