"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Column } from "@/db/schema";
import type { BoardMemberProfile } from "@/db/boards";
import type { CardWithAssignee } from "@/db/cards";
import { ColumnLane, type MoveTarget } from "./column-lane";
import { CardFace } from "./card-item";
import { CreateColumnForm } from "./create-column-form";
import { moveCardAction } from "./actions";

/** The visible cards for one column, in order, keyed by column id. */
type Lanes = Record<string, CardWithAssignee[]>;

/** Group the board's cards into per-column lanes, each already position-ordered. */
function groupByColumn(columns: Column[], cards: CardWithAssignee[]): Lanes {
  const lanes: Lanes = {};
  for (const column of columns) lanes[column.id] = [];
  for (const card of cards) (lanes[card.columnId] ??= []).push(card);
  return lanes;
}

/** A stable signature of the server's card order, so we only re-sync on real change. */
function laneSignature(cards: CardWithAssignee[]): string {
  return cards.map((c) => `${c.columnId}:${c.id}:${c.position}`).join("|");
}

/** The card ids bracketing `id` in an ordered lane — `null` at either end. */
function neighbours(
  cards: CardWithAssignee[],
  id: string,
): { beforeId: string | null; afterId: string | null } {
  const index = cards.findIndex((card) => card.id === id);
  return {
    beforeId: index > 0 ? cards[index - 1].id : null,
    afterId: index >= 0 && index < cards.length - 1 ? cards[index + 1].id : null,
  };
}

/**
 * The interactive board: every lane under one `DndContext` so a card can be dragged
 * within its column or across columns (ticket 06). Two input-specific sensors cover
 * both devices — a `MouseSensor` with an 8px activation distance (a click still opens
 * the card's editor; only a real drag starts DnD) and a `TouchSensor` with
 * **long-press activation** (a tap edits, a press-and-hold drags, and an ordinary
 * swipe still scrolls the board on a phone). A pointer sensor is deliberately *not*
 * used: on a touch device it also fires and its distance constraint would start a
 * drag mid-swipe, before the long-press elapses — defeating vertical page scroll.
 *
 * Local `lanes` state mirrors the server's cards so a drag reorders instantly;
 * `onDragOver` moves the card between lanes for live feedback, and `onDragEnd`
 * persists the drop as neighbour ids via `moveCardAction`. The action revalidates
 * the board, and the effect below re-syncs local state to that authoritative order.
 */
export function BoardView({
  boardId,
  columns,
  cards,
  members,
  currentUserId,
  isOwner,
}: {
  boardId: string;
  columns: Column[];
  cards: CardWithAssignee[];
  members: BoardMemberProfile[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, CardWithAssignee>();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  const [lanes, setLanes] = useState<Lanes>(() => groupByColumn(columns, cards));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync to the server's order whenever it changes and no drag is in flight —
  // the authoritative positions land here after each `moveCardAction` revalidates.
  const signature = laneSignature(cards);
  useEffect(() => {
    if (!activeId) setLanes(groupByColumn(columns, cards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  /** Which lane a draggable id sits in — a card id, or a column id used as an empty drop target. */
  function laneOf(id: string): string | undefined {
    if (id in lanes) return id;
    return Object.keys(lanes).find((columnId) =>
      lanes[columnId].some((card) => card.id === id),
    );
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  // Live cross-column feedback: as the pointer enters another lane, pull the card
  // out of its source lane and splice it into the target at the hovered slot.
  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = laneOf(activeId);
    const to = laneOf(overId);
    if (!from || !to || from === to) return;

    setLanes((prev) => {
      const fromCards = prev[from];
      const toCards = prev[to];
      const moving = fromCards.find((card) => card.id === activeId);
      if (!moving) return prev;

      // Dropping onto the lane itself (its empty area) appends; onto a card inserts
      // just before that card.
      const overIndex = toCards.findIndex((card) => card.id === overId);
      const insertAt = overIndex === -1 ? toCards.length : overIndex;

      return {
        ...prev,
        [from]: fromCards.filter((card) => card.id !== activeId),
        [to]: [...toCards.slice(0, insertAt), moving, ...toCards.slice(insertAt)],
      };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const draggedId = String(active.id);
    setActiveId(null);
    if (!over) return;

    const lane = laneOf(draggedId);
    if (!lane) return;

    // Settle the final in-lane order (cross-lane placement already happened in
    // onDragOver), then read the drop's neighbours to persist.
    let settled = lanes;
    const overId = String(over.id);
    const laneCards = lanes[lane];
    const oldIndex = laneCards.findIndex((card) => card.id === draggedId);
    const overIndex = laneCards.findIndex((card) => card.id === overId);
    if (overIndex !== -1 && oldIndex !== overIndex) {
      const reordered = arrayMove(laneCards, oldIndex, overIndex);
      settled = { ...lanes, [lane]: reordered };
      setLanes(settled);
    }

    const { beforeId, afterId } = neighbours(settled[lane], draggedId);

    // Skip the write when the drop lands the card exactly where the server already
    // has it (same lane, same neighbours) — a no-op drag shouldn't touch a row.
    const original = byId.get(draggedId);
    const base = neighbours(groupByColumn(columns, cards)[lane] ?? [], draggedId);
    if (original?.columnId === lane && base.beforeId === beforeId && base.afterId === afterId) {
      return;
    }

    startTransition(() =>
      moveCardAction({ boardId, cardId: draggedId, columnId: lane, beforeId, afterId }),
    );
  }

  const activeCard = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {columns.map((column, i) => {
          // Neighbours the column lands between when nudged one step. Moving left
          // means slotting before the previous lane; moving right, after the next.
          const moveLeft: MoveTarget =
            i > 0
              ? { beforeId: columns[i - 2]?.id ?? null, afterId: columns[i - 1].id }
              : null;
          const moveRight: MoveTarget =
            i < columns.length - 1
              ? { beforeId: columns[i + 1].id, afterId: columns[i + 2]?.id ?? null }
              : null;
          return (
            <ColumnLane
              key={column.id}
              boardId={boardId}
              column={column}
              cards={lanes[column.id] ?? []}
              members={members}
              currentUserId={currentUserId}
              isOwner={isOwner}
              moveLeft={moveLeft}
              moveRight={moveRight}
            />
          );
        })}
        <CreateColumnForm boardId={boardId} />
      </div>

      <DragOverlay>{activeCard ? <CardFace card={activeCard} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
