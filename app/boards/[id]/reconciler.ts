/**
 * The gate between a 4s poll and the board a user is actively editing (D3/D4).
 *
 * Polling and optimistic mutations pull in opposite directions: the poll wants to
 * replace local state with the server's, the mutation has already moved local
 * state ahead of it. Applying a poll that predates the local write snaps the card
 * back to where it was — the flicker this whole seam exists to prevent.
 *
 * So local state carries a **monotonic version**, bumped by every mutation, and a
 * count of mutations **in flight**. A fetch stamps itself with `snapshot()` when it
 * starts; `accepts()` lets the result through only if nothing is in flight *and*
 * no mutation has been made since the fetch left. Everything else is dropped —
 * safely, because every mutation invalidates the board on settle, so a fresh
 * payload is always right behind.
 */
export type Reconciler = {
  /** The version to stamp a fetch with, read *before* the request goes out. */
  snapshot(): number;
  /** A mutation is starting: bump the version, mark it in flight. */
  begin(): void;
  /** A mutation has settled, whether it succeeded or failed. */
  end(): void;
  /** May a payload fetched at `stampedAt` be applied to local state? */
  accepts(stampedAt: number): boolean;
};

export function createReconciler(): Reconciler {
  let version = 0;
  let inFlight = 0;

  return {
    snapshot: () => version,
    begin() {
      version++;
      inFlight++;
    },
    end() {
      // Never below zero: an unmount or a double-settle would otherwise leave a
      // credit behind that opens the gate during the *next* mutation.
      inFlight = Math.max(0, inFlight - 1);
    },
    accepts: (stampedAt) => inFlight === 0 && stampedAt === version,
  };
}
