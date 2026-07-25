"use client";

import { useMemo, useState } from "react";
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
import type { BoardCard } from "./board-data";
import { groupByColumn, orderedColumns, withMovedCard, type Lanes } from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { ColumnLane, type MoveTarget } from "./column-lane";
import { CardFace } from "./card-item";
import { CreateColumnForm } from "./create-column-form";
import { moveCardAction } from "./actions";

/** The card ids bracketing `id` in an ordered lane — `null` at either end. */
function neighbours(
  cards: BoardCard[],
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
 * Lanes are derived from the polled board payload (ticket 09), so another member's
 * move appears here within a poll. `dragLanes` shadows that derivation for exactly
 * as long as a drag is being made and its write is in flight: `onDragOver` moves the
 * card between lanes for live feedback, `onDragEnd` persists the drop as neighbour
 * ids, and the optimistic cache patch has already taken over by the time the shadow
 * is dropped — so the card never snaps back to where it came from.
 */
export function BoardView({
  filterAssigneeId,
}: {
  /** When set, only this user's assigned cards are shown ("my cards", ?mine=1). */
  filterAssigneeId: string | null;
}) {
  const { boardId, board, run, outOfSync } = useBoard();

  const columns = useMemo(() => orderedColumns(board.columns), [board.columns]);
  const byId = useMemo(() => {
    const map = new Map<string, BoardCard>();
    for (const card of board.cards) map.set(card.id, card);
    return map;
  }, [board.cards]);

  // *Every* card on the board, not just the visible ones — ordering has to be
  // computed against the full lane. Filtering happens at render, so a drop between
  // two visible cards still resolves its true neighbours, which may be cards the
  // filter hides.
  const polledLanes = useMemo(
    () => groupByColumn(columns, board.cards),
    [columns, board.cards],
  );

  const [dragLanes, setDragLanes] = useState<Lanes | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lanes = dragLanes ?? polledLanes;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  /**
   * Whether a card shows under the current filter. Lanes always hold every card so
   * neighbour lookup stays correct; only rendering narrows.
   */
  function isVisible(card: BoardCard): boolean {
    return filterAssigneeId === null || card.assigneeId === filterAssigneeId;
  }

  /** Which lane a draggable id sits in — a card id, or a column id used as an empty drop target. */
  function laneOf(id: string): string | undefined {
    if (id in lanes) return id;
    return Object.keys(lanes).find((columnId) =>
      lanes[columnId].some((card) => card.id === id),
    );
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDragLanes(polledLanes);
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

    setDragLanes((prev) => {
      const current = prev ?? polledLanes;
      const fromCards = current[from];
      const toCards = current[to];
      const moving = fromCards.find((card) => card.id === activeId);
      if (!moving) return current;

      // Dropping onto the lane itself (its empty area) appends; onto a card inserts
      // just before that card.
      const overIndex = toCards.findIndex((card) => card.id === overId);
      const insertAt = overIndex === -1 ? toCards.length : overIndex;

      return {
        ...current,
        [from]: fromCards.filter((card) => card.id !== activeId),
        [to]: [...toCards.slice(0, insertAt), moving, ...toCards.slice(insertAt)],
      };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const draggedId = String(active.id);
    setActiveId(null);

    const lane = over ? laneOf(draggedId) : undefined;
    if (!lane) {
      setDragLanes(null);
      return;
    }

    // Settle the final in-lane order (cross-lane placement already happened in
    // onDragOver), then read the drop's neighbours to persist.
    let settled = lanes;
    const overId = String(over!.id);
    const laneCards = lanes[lane];
    const oldIndex = laneCards.findIndex((card) => card.id === draggedId);
    const overIndex = laneCards.findIndex((card) => card.id === overId);
    if (overIndex !== -1 && oldIndex !== overIndex) {
      settled = { ...lanes, [lane]: arrayMove(laneCards, oldIndex, overIndex) };
    }
    setDragLanes(settled);

    const { beforeId, afterId } = neighbours(settled[lane], draggedId);

    // Skip the write when the drop lands the card exactly where it already is
    // (same lane, same neighbours) — a no-op drag shouldn't touch a row.
    const original = byId.get(draggedId);
    const base = neighbours(polledLanes[lane] ?? [], draggedId);
    if (original?.columnId === lane && base.beforeId === beforeId && base.afterId === afterId) {
      setDragLanes(null);
      return;
    }

    void run({
      patches: [
        patchBoard(boardId, (data) =>
          withMovedCard(data, { cardId: draggedId, columnId: lane, beforeId, afterId }),
        ),
      ],
      action: () => moveCardAction({ cardId: draggedId, columnId: lane, beforeId, afterId }),
      // Hold the dropped order on screen until the write settles; by then the
      // optimistic patch is in the cache, so the hand-off is invisible.
    }).finally(() => setDragLanes(null));
  }

  const activeCard = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragLanes(null);
      }}
    >
      {outOfSync && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs"
        >
          Not syncing — this board may be out of date.
        </p>
      )}

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
              column={column}
              cards={(lanes[column.id] ?? []).filter(isVisible)}
              moveLeft={moveLeft}
              moveRight={moveRight}
            />
          );
        })}
        <CreateColumnForm />
      </div>

      {columns.length === 0 && (
        <p className="text-sm opacity-60">No columns yet. Add your first lane above.</p>
      )}

      <DragOverlay>{activeCard ? <CardFace card={activeCard} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
