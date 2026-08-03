import { sql } from "drizzle-orm";
import { db } from "./index";
import { getBoard, listBoardMembers, type BoardMemberProfile } from "./boards";
import { listColumns } from "./columns";
import { listCards, type CardWithAssignee } from "./cards";
import { boardMembers, cards, columns, comments, type Board, type Column } from "./schema";

/**
 * Everything the board view renders, in one payload: the board, its lanes and
 * cards (with assignees and comment counts), its members, and the `version` the
 * payload was read at. This is what `GET /api/boards/:id` serves and what the
 * client polls behind the version guard (D4).
 */
export type BoardSnapshot = {
  board: Board;
  columns: Column[];
  cards: CardWithAssignee[];
  members: BoardMemberProfile[];
  version: string;
};

/** One entity's contribution to the version: how many rows, and the latest touch. */
type VersionPart = { count: string; stamp: string };

type VersionRow = {
  column_count: string;
  column_stamp: string;
  card_count: string;
  card_stamp: string;
  comment_count: string;
  comment_stamp: string;
  member_count: string;
  member_stamp: string;
};

/**
 * A cheap change token for a whole board — the thing `GET /api/boards/:id/version`
 * serves, polled every 4s so the heavy board payload is only refetched when
 * something actually moved (D4).
 *
 * It is `max(updated_at)` per entity, paired with a row count. The timestamp
 * catches edits in place (a card renamed, moved or assigned; a lane renamed or
 * reordered — which is why `columns.updatedAt` exists); the count catches the
 * changes no timestamp can see, since a deleted row takes its timestamp with it.
 * Comments have no `updatedAt` because they're add + delete only (D7), so their
 * `createdAt` plus the count covers them — and they belong in the token at all
 * because a card's face shows a comment count. Members are here so a teammate who
 * accepts an invite shows up in the assignee picker without a reload, and so a
 * promotion or demotion reaches the promoted user's own screen: that changes no
 * count and creates no row, which is what `board_members.updatedAt` is for.
 *
 * The token is compared for equality only, never ordered: it says *different*,
 * not *newer*. One round trip, one connection — polls are the reason production
 * must use Neon's pooled endpoint (D4).
 */
export async function boardVersion(boardId: string): Promise<string> {
  // Timestamps come back as epoch seconds with microsecond precision, as text, so
  // the token doesn't depend on either driver's date parsing — and two edits in
  // the same millisecond still produce different tokens.
  const stamp = (column: unknown) =>
    sql`coalesce(extract(epoch from max(${column}))::text, '-')`;

  const result = await db.execute<VersionRow>(sql`
    select
      (select count(*)::text from ${columns}
        where ${columns.boardId} = ${boardId}) as column_count,
      (select ${stamp(columns.updatedAt)} from ${columns}
        where ${columns.boardId} = ${boardId}) as column_stamp,
      (select count(*)::text from ${cards}
        where ${cards.boardId} = ${boardId}) as card_count,
      (select ${stamp(cards.updatedAt)} from ${cards}
        where ${cards.boardId} = ${boardId}) as card_stamp,
      (select count(*)::text from ${comments}
        inner join ${cards} on ${cards.id} = ${comments.cardId}
        where ${cards.boardId} = ${boardId}) as comment_count,
      (select ${stamp(comments.createdAt)} from ${comments}
        inner join ${cards} on ${cards.id} = ${comments.cardId}
        where ${cards.boardId} = ${boardId}) as comment_stamp,
      (select count(*)::text from ${boardMembers}
        where ${boardMembers.boardId} = ${boardId}) as member_count,
      (select ${stamp(boardMembers.updatedAt)} from ${boardMembers}
        where ${boardMembers.boardId} = ${boardId}) as member_stamp
  `);

  const row = result.rows[0];
  const parts: VersionPart[] = [
    { count: row.column_count, stamp: row.column_stamp },
    { count: row.card_count, stamp: row.card_stamp },
    { count: row.comment_count, stamp: row.comment_stamp },
    { count: row.member_count, stamp: row.member_stamp },
  ];
  return parts.map((part) => `${part.count}@${part.stamp}`).join("|");
}

/**
 * The full board payload plus the version it was read at, or `null` if the board
 * is gone. **Access is the caller's job** — every caller goes through
 * `requireBoardMember` first, exactly as the page and the other route handlers do.
 *
 * The version is read *before* the payload, never after: if a change lands
 * mid-read, the client stores fresh data under a stale token and its next poll
 * refetches — one wasted fetch. Reading the version last would do the opposite,
 * pairing stale data with a fresh token, and the client would sit on it until the
 * next unrelated change.
 */
export async function getBoardSnapshot(boardId: string): Promise<BoardSnapshot | null> {
  const version = await boardVersion(boardId);
  const board = await getBoard(boardId);
  if (!board) return null;

  const [boardColumns, boardCards, members] = await Promise.all([
    listColumns(boardId),
    listCards(boardId),
    listBoardMembers(boardId),
  ]);

  return { board, columns: boardColumns, cards: boardCards, members, version };
}
