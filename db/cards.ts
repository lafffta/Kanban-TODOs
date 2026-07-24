import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { keyBetween } from "./ordering";
import { requireBoardMember } from "./boards";
import {
  columns,
  cards,
  users,
  boardMembers,
  type Card,
  type UserProfile,
} from "./schema";

/** Zod shape for a card's editable content — the boundary check for create/edit. */
export const cardContentSchema = z.object({
  title: z.string().trim().min(1, "Card title is required.").max(200),
  // Plain multiline text, no markdown (D7). Optional; defaults to empty.
  description: z.string().max(5000).default(""),
});

/** Just the title — the boundary check for the quick "add card" form. */
export const cardTitleSchema = cardContentSchema.pick({ title: true });

/** Thrown when a card id doesn't resolve — e.g. it was deleted concurrently. */
export class CardNotFoundError extends Error {
  constructor(readonly cardId: string) {
    super(`Card not found: ${cardId}`);
    this.name = "CardNotFoundError";
  }
}

/** Thrown when an assignee isn't a member of the card's board (D7 validation). */
export class AssigneeNotBoardMemberError extends Error {
  constructor(
    readonly boardId: string,
    readonly assigneeId: string,
  ) {
    super(`User ${assigneeId} is not a member of board ${boardId}`);
    this.name = "AssigneeNotBoardMemberError";
  }
}

/** A card plus its resolved assignee profile (null when unassigned). */
export type CardWithAssignee = Card & { assignee: UserProfile | null };

/**
 * A board's cards with assignee profiles, ordered by column then `position` (id
 * breaks any jitter tie). The board page groups these by `columnId` into lanes and
 * the "my cards" filter narrows by `assigneeId`.
 */
export async function listCards(boardId: string): Promise<CardWithAssignee[]> {
  const rows = await db
    .select({
      card: cards,
      assignee: {
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      },
    })
    .from(cards)
    .leftJoin(users, eq(users.id, cards.assigneeId))
    .where(eq(cards.boardId, boardId))
    .orderBy(asc(cards.columnId), asc(cards.position), asc(cards.id));
  return rows.map((r) => ({ ...r.card, assignee: r.assignee?.id ? r.assignee : null }));
}

/**
 * Load a card and confirm the caller may act on its board. Every card mutation
 * funnels through here, so membership is checked in exactly one place (the
 * `requireBoardMember` seam). Throws `BoardAccessError` for a non-member,
 * `CardNotFoundError` if the card is gone.
 */
async function requireCardMember(cardId: string, userId: string): Promise<Card> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) throw new CardNotFoundError(cardId);
  await requireBoardMember(card.boardId, userId);
  return card;
}

/**
 * Confirm a column belongs to a board, so a card can't be attached to — or moved
 * into — another board's lane. Shared by create and move (the two places a card
 * lands in a column the caller named).
 */
async function requireColumnInBoard(columnId: string, boardId: string): Promise<void> {
  const [column] = await db
    .select({ id: columns.id })
    .from(columns)
    .where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
    .limit(1);
  if (!column) throw new Error("Column does not belong to this board.");
}

/**
 * Create a card at the end of a column's cards. Members may create cards (D1);
 * membership is checked here, and the column is confirmed to belong to the board
 * so a caller can't attach a card to another board's lane. The new key is
 * generated after the current last card, so appends touch no existing row (D3).
 */
export async function createCard(input: {
  boardId: string;
  columnId: string;
  title: string;
  userId: string;
}): Promise<Card> {
  await requireBoardMember(input.boardId, input.userId);
  await requireColumnInBoard(input.columnId, input.boardId);

  const siblings = await db
    .select({ position: cards.position })
    .from(cards)
    .where(eq(cards.columnId, input.columnId))
    .orderBy(asc(cards.position), asc(cards.id));
  const last = siblings.at(-1)?.position ?? null;

  const [card] = await db
    .insert(cards)
    .values({
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      position: keyBetween(last, null),
      createdById: input.userId,
    })
    .returning();
  return card;
}

/** Edit a card's title and description (member-permitted, membership-checked). */
export async function updateCard(input: {
  cardId: string;
  title: string;
  description: string;
  userId: string;
}): Promise<Card> {
  const card = await requireCardMember(input.cardId, input.userId);
  const [updated] = await db
    .update(cards)
    .set({ title: input.title, description: input.description, updatedAt: new Date() })
    .where(eq(cards.id, card.id))
    .returning();
  return updated;
}

/**
 * Assign a card to a single board member, or clear the assignment with `null`.
 * The assignee must be a member of the card's board (D7); a non-member is rejected
 * with `AssigneeNotBoardMemberError`, leaving the card untouched.
 */
export async function assignCard(input: {
  cardId: string;
  assigneeId: string | null;
  userId: string;
}): Promise<Card> {
  const card = await requireCardMember(input.cardId, input.userId);

  if (input.assigneeId !== null) {
    const [member] = await db
      .select({ userId: boardMembers.userId })
      .from(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, card.boardId),
          eq(boardMembers.userId, input.assigneeId),
        ),
      )
      .limit(1);
    if (!member) throw new AssigneeNotBoardMemberError(card.boardId, input.assigneeId);
  }

  const [updated] = await db
    .update(cards)
    .set({ assigneeId: input.assigneeId, updatedAt: new Date() })
    .where(eq(cards.id, card.id))
    .returning();
  return updated;
}

/**
 * Move a card to sit between `beforeId` and `afterId` (each a card id, or `null`
 * for an end) inside `columnId` — the same lane for a reorder, a different lane
 * for a cross-column move. The target column must belong to the card's board, and
 * both neighbours must currently live in that target column, so a caller can't
 * splice in a position from another lane or board. Generates one fractional key
 * between the neighbours' positions (with jitter) and rewrites the single moved
 * row — `columnId` + `position` in one update, last-write-wins with no locking
 * (D3). Mirrors `reorderColumn`, plus the column change.
 */
export async function moveCard(input: {
  cardId: string;
  columnId: string;
  beforeId: string | null;
  afterId: string | null;
  userId: string;
}): Promise<Card> {
  const card = await requireCardMember(input.cardId, input.userId);
  await requireColumnInBoard(input.columnId, card.boardId);

  // A neighbour's position, scoped to the target column: a card named as a drop
  // neighbour must already sit in the lane the move lands in.
  const neighbourPosition = async (id: string | null): Promise<string | null> => {
    if (id === null) return null;
    if (id === card.id) {
      throw new Error("A card cannot be moved relative to itself.");
    }
    const [neighbour] = await db
      .select({ position: cards.position })
      .from(cards)
      .where(and(eq(cards.id, id), eq(cards.columnId, input.columnId)))
      .limit(1);
    if (!neighbour) throw new CardNotFoundError(id);
    return neighbour.position;
  };

  const before = await neighbourPosition(input.beforeId);
  const after = await neighbourPosition(input.afterId);

  const [updated] = await db
    .update(cards)
    .set({
      columnId: input.columnId,
      position: keyBetween(before, after),
      updatedAt: new Date(),
    })
    .where(eq(cards.id, card.id))
    .returning();
  return updated;
}

/**
 * Delete a card (member-permitted, membership-checked). Its comments cascade via
 * their FK once the comments ticket lands; the confirm dialog lives in the UI.
 */
export async function deleteCard(input: {
  cardId: string;
  userId: string;
}): Promise<void> {
  const card = await requireCardMember(input.cardId, input.userId);
  await db.delete(cards).where(eq(cards.id, card.id));
}
