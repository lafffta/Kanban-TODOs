import { keyBetween } from "@/db/ordering";
import type { UserProfile } from "@/db/schema";
import type { BoardCard, BoardColumn, BoardData } from "./board-data";

/** The visible cards for one column, in order, keyed by column id. */
export type Lanes = Record<string, BoardCard[]>;

/** Rows the server hasn't acknowledged yet carry an id no other client can name. */
const PROVISIONAL_PREFIX = "optimistic:";

/**
 * Whether a row is a local optimistic placeholder rather than a real server row.
 * Its id means nothing to the server, so the board view renders it inert — no
 * drag, no edit, no delete — until the refetch after the write swaps in the real
 * row (a second or so later, usually much less).
 */
export function isProvisional(id: string): boolean {
  return id.startsWith(PROVISIONAL_PREFIX);
}

/** An id for a row that exists only locally, until the write that made it returns. */
export function provisionalId(): string {
  return `${PROVISIONAL_PREFIX}${crypto.randomUUID()}`;
}

/** The server's ordering rule, applied client-side: position, then id as tiebreak. */
function byPosition(a: { position: string; id: string }, b: { position: string; id: string }) {
  if (a.position === b.position) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.position < b.position ? -1 : 1;
}

/** A board's columns in render order. */
export function orderedColumns(columns: BoardColumn[]): BoardColumn[] {
  return [...columns].sort(byPosition);
}

/**
 * Group a board's cards into per-column lanes, each in `position` order. The
 * server returns them ordered already, but an optimistic move rewrites a position
 * in place — so the client sorts by the same rule rather than trusting arrival
 * order, and a moved card sits where its new key puts it without any splicing.
 */
export function groupByColumn(columns: BoardColumn[], cards: BoardCard[]): Lanes {
  const lanes: Lanes = {};
  for (const column of columns) lanes[column.id] = [];
  for (const card of cards) (lanes[card.columnId] ??= []).push(card);
  for (const columnId of Object.keys(lanes)) lanes[columnId].sort(byPosition);
  return lanes;
}

/** Replace one card, leaving the rest of the payload (and the input) untouched. */
function mapCard(
  board: BoardData,
  cardId: string,
  change: (card: BoardCard) => BoardCard,
): BoardData {
  return {
    ...board,
    cards: board.cards.map((card) => (card.id === cardId ? change(card) : card)),
  };
}

/** The `position` of a card named as a drop neighbour, or null for an open end. */
function positionOf(board: BoardData, cardId: string | null): string | null {
  if (cardId === null) return null;
  return board.cards.find((card) => card.id === cardId)?.position ?? null;
}

/**
 * Move a card into `columnId`, between the two cards it was dropped between —
 * the optimistic twin of `moveCard` in the db layer, generating a fractional key
 * in the same gap (D3). The key won't be byte-identical to the server's (both
 * jitter), but it puts the card in the same slot, so the refetch that follows
 * changes nothing visible.
 */
export function withMovedCard(
  board: BoardData,
  move: { cardId: string; columnId: string; beforeId: string | null; afterId: string | null },
): BoardData {
  if (!board.cards.some((card) => card.id === move.cardId)) return board;
  const position = keyBetween(positionOf(board, move.beforeId), positionOf(board, move.afterId));
  return mapCard(board, move.cardId, (card) => ({
    ...card,
    columnId: move.columnId,
    position,
  }));
}

/** Show a card's edited title/description or new assignee before the write lands. */
export function withCardPatch(
  board: BoardData,
  cardId: string,
  patch: Partial<Pick<BoardCard, "title" | "description" | "assigneeId">> & {
    assignee?: UserProfile | null;
  },
): BoardData {
  return mapCard(board, cardId, (card) => ({ ...card, ...patch }));
}

/** Drop a deleted card out of its lane immediately. */
export function withoutCard(board: BoardData, cardId: string): BoardData {
  return { ...board, cards: board.cards.filter((card) => card.id !== cardId) };
}

/** Append a provisional card to the end of a lane, as `createCard` will. */
export function withNewCard(
  board: BoardData,
  input: { columnId: string; title: string; createdById: string },
): BoardData {
  const lane = board.cards.filter((card) => card.columnId === input.columnId).sort(byPosition);
  const now = new Date().toISOString();
  const card: BoardCard = {
    id: provisionalId(),
    boardId: board.board.id,
    columnId: input.columnId,
    title: input.title,
    description: "",
    position: keyBetween(lane.at(-1)?.position ?? null, null),
    assigneeId: null,
    createdById: input.createdById,
    createdAt: now,
    updatedAt: now,
    assignee: null,
    commentCount: 0,
  };
  return { ...board, cards: [...board.cards, card] };
}

/** Append a provisional lane to the end of the board, as `createColumn` will. */
export function withNewColumn(board: BoardData, input: { name: string }): BoardData {
  const lanes = orderedColumns(board.columns);
  const now = new Date().toISOString();
  const column: BoardColumn = {
    id: provisionalId(),
    boardId: board.board.id,
    name: input.name,
    position: keyBetween(lanes.at(-1)?.position ?? null, null),
    createdAt: now,
    updatedAt: now,
  };
  return { ...board, columns: [...board.columns, column] };
}

/** Show a lane's new name immediately. */
export function withColumnRenamed(
  board: BoardData,
  columnId: string,
  name: string,
): BoardData {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, name } : column,
    ),
  };
}

/** Move a lane between its new neighbours — the twin of `reorderColumn`. */
export function withMovedColumn(
  board: BoardData,
  move: { columnId: string; beforeId: string | null; afterId: string | null },
): BoardData {
  const positionOfColumn = (id: string | null) =>
    id === null ? null : (board.columns.find((column) => column.id === id)?.position ?? null);
  const position = keyBetween(
    positionOfColumn(move.beforeId),
    positionOfColumn(move.afterId),
  );
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === move.columnId ? { ...column, position } : column,
    ),
  };
}

/** Drop a deleted lane and, as the server's cascade will, its cards (D5). */
export function withoutColumn(board: BoardData, columnId: string): BoardData {
  return {
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
    cards: board.cards.filter((card) => card.columnId !== columnId),
  };
}

/**
 * Adjust a card face's comment count by `delta` — the board-side half of adding or
 * deleting a comment, so the "💬 N" badge moves with the thread. Clamped at zero:
 * a delete racing a poll that already dropped the comment shouldn't show "-1".
 */
export function withCommentCount(
  board: BoardData,
  cardId: string,
  delta: number,
): BoardData {
  return mapCard(board, cardId, (card) => ({
    ...card,
    commentCount: Math.max(0, card.commentCount + delta),
  }));
}
