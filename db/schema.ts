import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Trivial table for the walking skeleton. Its only job is to prove the
 * end-to-end pipe: a migration creates it, the app reads a row from it.
 * Real domain tables (users, boards, columns, cards, …) arrive in later tickets.
 */
export const greetings = pgTable("greetings", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Greeting = typeof greetings.$inferSelect;
export type NewGreeting = typeof greetings.$inferInsert;
