import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

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

/**
 * User accounts. Shape follows the Auth.js Drizzle adapter (text `id`, `email`,
 * `emailVerified`, `image`) plus `passwordHash` for the Credentials provider and
 * `name` from DESIGN.md. The adapter tables (accounts, sessions,
 * verificationTokens) are reserved for future OAuth and land in a later slice.
 *
 * `email` is the account's identity, so it is unique on its *canonical* form
 * rather than on the typed text: a plain unique column would happily let
 * `ada@x.com`, `Ada@x.com` and ` ada@x.com ` become three accounts for one
 * person. Writes canonicalize before they get here; the index is what makes that
 * hold for writers that don't. Its expression must stay identical to
 * `canonicalEmail` / `canonicalEmailSql` in `db/email.ts` — if the two drift, the
 * constraint stops enforcing the identity the app computes.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_canonical_unique").on(sql`lower(btrim(${table.email}))`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * The public display projection of a user — the id plus the fields needed to
 * render them (avatar image + label). Shared by card assignees and board-member
 * listings so every surface renders a person through one shape.
 */
export type UserProfile = Pick<User, "id" | "name" | "email" | "image">;

/**
 * Auth.js adapter tables (canonical Drizzle shapes). Reserved for future OAuth —
 * the v1 Credentials + JWT flow doesn't write to them, but the adapter requires
 * them to exist.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

/** A member's role on a board (D1). Owners govern; members do all content work. */
export type BoardRole = "owner" | "member";

/**
 * A kanban board. `ownerId` is the creating user; the matching `owner` row in
 * `board_members` is the source of truth for access control (see
 * `requireBoardMember`). Deleting a board cascades everything (D5).
 */
export const boards = pgTable("boards", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;

/**
 * A user's membership of a board, carrying their `role`. Composite PK
 * (`boardId + userId`) makes membership unique per board. Every board-scoped read
 * and mutation is gated by looking a row up here via `requireBoardMember`.
 */
export const boardMembers = pgTable(
  "board_members",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<BoardRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (bm) => [primaryKey({ columns: [bm.boardId, bm.userId] })],
);

export type BoardMember = typeof boardMembers.$inferSelect;
export type NewBoardMember = typeof boardMembers.$inferInsert;

/**
 * An ordered lane on a board (e.g. "To Do"). `position` is a fractional-index
 * string (D3, see `db/ordering.ts`), so lanes render by `ORDER BY position` and a
 * reorder rewrites one row. Deleting a board cascades its columns; the cascade of
 * a non-empty column's cards + comments lands with the cards ticket (D5).
 * `updatedAt` is bumped by every rename and reorder so a lane change moves the
 * board's `max(updated_at)` version and other viewers' polls notice it (D4).
 */
export const columns = pgTable(
  "columns",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Two lanes on one board may never share a `position` (D3). Equal keys aren't
  // merely a display tie: `generateKeyBetween` cannot produce a key between two
  // equal ones, so a collision would poison the gap for every later insert. The
  // index makes the database refuse it, and `withUniquePosition` retries.
  (table) => [
    uniqueIndex("columns_board_id_position_unique").on(table.boardId, table.position),
  ],
);

export type Column = typeof columns.$inferSelect;
export type NewColumn = typeof columns.$inferInsert;

/**
 * A task card living in one column. `position` is a fractional-index string (D3),
 * so cards render by `ORDER BY position` and a reorder rewrites one row (reorder
 * lands in the cards-drag ticket). `description` is plain multiline text — no
 * markdown, so no HTML-sanitization surface (D7). `assigneeId` is an optional
 * single board member (validated on assignment); `createdById` is `ON DELETE SET
 * NULL` so a removed member's cards survive as "former member" (D5). Deleting the
 * board or the parent column cascades the card; deleting a card cascades its
 * comments (the FK lands with the comments ticket).
 */
export const cards = pgTable(
  "cards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    position: text("position").notNull(),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Two cards in one lane may never share a `position` — same reasoning as
  // `columns` above. Scoped to the column, so the same key may recur in a
  // different lane, which is exactly what a cross-column move relies on.
  (table) => [
    uniqueIndex("cards_column_id_position_unique").on(table.columnId, table.position),
  ],
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;

/**
 * A plain-text comment on a card (D7 — no markdown, so no HTML-sanitization
 * surface). Deleting a card cascades its comments (D5); `authorId` is `ON DELETE
 * SET NULL` so a removed member's comments survive on the board as "former
 * member" (D5). Comments are add + delete only — there is no edit (D7). The thread
 * renders by `ORDER BY createdAt`.
 */
export const comments = pgTable("comments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => users.id, {
    onDelete: "set null",
  }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

/**
 * A pending or accepted invitation to a board (D2). The owner mints one per
 * invitee with a crypto-random `token` — the trust boundary (D6): unguessable,
 * single-use (`acceptedAt` stamps it spent) and expiring (`expiresAt`, 7 days).
 * `email` is stored lowercased and is matched case-insensitively against the
 * accepting user's address; because v1 has no email verification, that binding is
 * a guardrail against accepting on the wrong account, not the security boundary.
 * `role` is the membership the accept mints. Deleting the board cascades its
 * invites (D5); `invitedById` is `ON DELETE SET NULL` so an invite outlives the
 * account that sent it.
 */
export const boardInvites = pgTable("board_invites", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").$type<BoardRole>().notNull(),
  invitedById: text("invited_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BoardInvite = typeof boardInvites.$inferSelect;
export type NewBoardInvite = typeof boardInvites.$inferInsert;
