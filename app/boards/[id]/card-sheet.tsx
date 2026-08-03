"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { OfflineNotice } from "@/app/pwa/offline-banner";
import type { BoardCard } from "./board-data";
import { withCardPatch, withoutCard } from "./board-edits";
import { patchBoard, useBoard } from "./board-context";
import { displayName } from "./avatar";
import { CommentThread } from "./comment-thread";
import { assignCardAction, deleteCardAction, updateCardAction } from "./actions";

/**
 * A card's detail view: title and description (plain multiline text, D7), the
 * assignee picker, delete, and the comment thread.
 *
 * It is a **full-screen sheet on a phone and a side panel on a desktop** — the
 * ticket 10 layout. On a phone a card's fields and its whole discussion cannot
 * share a 288px lane with the board; on a desktop covering the board to read one
 * card loses the context the board is for. Same component, two shapes.
 *
 * Rendered through a portal into `<body>` rather than inside its lane: the lanes
 * are a horizontally-scrolling, clipped row, and a fixed panel nested inside one
 * would be positioned and cropped by it.
 *
 * Every control routes through a membership-checked server action and patches the
 * cached board first, so the edit shows before the round trip returns and
 * reconciles on settle (D3). Offline they are refused with a toast (D8).
 */
export function CardSheet({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const { boardId, membership, online, run } = useBoard();
  const { members } = membership;
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  // A portal needs a DOM to aim at, which the server render doesn't have.
  useEffect(() => setMounted(true), []);

  // A refusal describes the moment it happened, and the commonest one here is
  // "you're offline" — which stops being true the moment the network returns.
  useEffect(() => {
    if (online) setError(null);
  }, [online]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const result = await run({
      patches: [
        patchBoard(boardId, (data) =>
          withCardPatch(data, card.id, { title: trimmed, description }),
        ),
      ],
      action: () => updateCardAction({ cardId: card.id, title: trimmed, description }),
    });
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    onClose();
  }

  async function assign(assigneeId: string | null) {
    const assignee = members.find((member) => member.id === assigneeId) ?? null;
    const result = await run({
      patches: [
        patchBoard(boardId, (data) => withCardPatch(data, card.id, { assigneeId, assignee })),
      ],
      action: () => assignCardAction({ cardId: card.id, assigneeId }),
    });
    setError(result?.error ?? null);
  }

  async function remove() {
    if (!confirm(`Delete the "${card.title}" card?`)) return;
    const result = await run({
      patches: [patchBoard(boardId, (data) => withoutCard(data, card.id))],
      action: () => deleteCardAction({ cardId: card.id }),
    });
    if (result?.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Tapping away closes on both shapes; on a phone the sheet covers the
          backdrop entirely, so it's a desktop affordance in practice. */}
      <button
        type="button"
        aria-label="Close card"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Card: ${card.title}`}
        className="relative flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border-l sm:border-black/10 dark:bg-neutral-900 sm:dark:border-white/15"
      >
        {/* The sheet covers the page's offline banner on a phone, so it carries
            its own — otherwise a refused edit here has no visible explanation. */}
        {!online && (
          <OfflineNotice className="py-1.5 text-xs">
            Offline — read-only until you reconnect.
          </OfflineNotice>
        )}

        <header className="flex items-center gap-2 border-b border-black/10 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 dark:border-white/10">
          <h2 className="flex-1 truncate text-sm font-semibold opacity-60">Card</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <form onSubmit={save} className="space-y-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              required
              maxLength={200}
              aria-label="Card title"
              autoFocus
              className="w-full rounded-md border border-black/20 bg-transparent px-2 py-1.5 text-base font-medium outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              maxLength={5000}
              placeholder="Add a description…"
              aria-label="Card description"
              className="w-full resize-y rounded-md border border-black/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-black/50 dark:border-white/25 dark:focus:border-white/60"
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-2 py-1.5 text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="ml-auto rounded-md px-2 py-1.5 text-xs opacity-70 hover:text-red-600 hover:opacity-100 disabled:opacity-40 dark:hover:text-red-400"
              >
                Delete
              </button>
            </div>
          </form>

          <label className="mt-3 flex items-center gap-2 border-t border-black/10 pt-3 text-xs dark:border-white/10">
            <span className="opacity-60">Assignee</span>
            <select
              value={card.assigneeId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void assign(event.target.value === "" ? null : event.target.value)
              }
              aria-label="Assignee"
              className="min-w-0 flex-1 rounded-md border border-black/20 bg-transparent px-2 py-1.5 outline-none focus:border-black/50 disabled:opacity-50 dark:border-white/25 dark:focus:border-white/60"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {displayName(member)}
                </option>
              ))}
            </select>
          </label>

          <CommentThread cardId={card.id} />
        </div>
      </section>
    </div>,
    document.body,
  );
}
