import type { QueryKey } from "@tanstack/react-query";
import type { Reconciler } from "./reconciler";

/** What a board server action answers with: nothing, or why it refused. */
export type ActionResult = { error?: string } | void | undefined;

/** An optimistic edit to one cached query, applied before its write is sent. */
export type CachePatch = {
  queryKey: QueryKey;
  update: (previous: unknown) => unknown;
};

/** A board write: what to show immediately, and the server action to send. */
export type BoardMutation = {
  patches?: CachePatch[];
  action: () => Promise<ActionResult>;
};

/**
 * The slice of the query cache the write protocol touches. Naming it separately
 * from `QueryClient` keeps the protocol testable in plain node, and keeps the two
 * ways of writing a cache entry apart: `update` runs an updater over what's held,
 * `write` puts a captured value back verbatim (a rollback must not re-derive).
 */
export type WriteCache = {
  cancel(queryKey: QueryKey): Promise<void>;
  read(queryKey: QueryKey): unknown;
  write(queryKey: QueryKey, data: unknown): void;
  update(queryKey: QueryKey, updater: (previous: unknown) => unknown): void;
  invalidate(queryKey: QueryKey): void;
};

/** What the user is told when the action never answered at all. */
export const WRITE_FAILED = "That didn't save. Check your connection and try again.";

/** Why a write failed, or undefined if it didn't. */
function refusalOf(result: ActionResult): string | undefined {
  return result?.error;
}

/**
 * Run one board write under the optimistic + reconcile protocol (D3): cancel the
 * reads already on the wire so none lands on top of the edit, patch every cache
 * entry the write touches, send the action, and invalidate on settle so the
 * server's version of events replaces the optimistic one.
 *
 * **A refusal is a failure.** A server action reports an expected refusal — a
 * stale comment id, a permission the user no longer has — by *resolving* with
 * `{ error }` rather than throwing. Both endings undo the same thing, so both
 * restore every patch: leaving a refused delete applied until the next poll
 * repairs it would show the user something that didn't happen. The action's own
 * message is what comes back, though; only a thrown failure, which carries no
 * message a user could act on, falls back to `WRITE_FAILED`.
 *
 * Success is the one ending that keeps its patches: they stay on screen until the
 * invalidate below brings the authoritative payload that contains them.
 */
export async function runBoardWrite(
  deps: { cache: WriteCache; reconciler: Reconciler; boardKey: QueryKey },
  write: BoardMutation,
): Promise<ActionResult> {
  const { cache, reconciler, boardKey } = deps;
  const patches = write.patches ?? [];
  let applied: { queryKey: QueryKey; data: unknown }[] = [];
  let result: ActionResult;
  let failure: string | undefined;

  reconciler.begin();
  try {
    await Promise.all(
      [boardKey, ...patches.map((patch) => patch.queryKey)].map((key) => cache.cancel(key)),
    );
    applied = patches.map((patch) => ({
      queryKey: patch.queryKey,
      data: cache.read(patch.queryKey),
    }));
    for (const patch of patches) cache.update(patch.queryKey, patch.update);

    result = await write.action();
    failure = refusalOf(result);
  } catch {
    failure = WRITE_FAILED;
  }

  if (failure !== undefined) {
    // Newest first, so two patches to the same query end at the value held before
    // *either* of them: the write is one logical edit, and it unwinds as one.
    for (const entry of [...applied].reverse()) cache.write(entry.queryKey, entry.data);
  }

  reconciler.end();
  // The board key is a prefix of the version key, so this re-reads both and they
  // can't drift apart.
  cache.invalidate(boardKey);
  for (const patch of patches) cache.invalidate(patch.queryKey);

  return failure === undefined ? result : { error: failure };
}
