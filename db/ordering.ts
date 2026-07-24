import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Fractional-index ordering (D3), shared by columns now and cards later. A row's
 * `position` is a string key; to place a row between two neighbours you generate a
 * key that sorts strictly between their keys, so a reorder touches exactly one row
 * (no renumbering, no float exhaustion). Keys compare with a plain string `<`.
 *
 * **Jitter.** Two clients dropping into the *same* gap at the same moment would,
 * without jitter, compute the *identical* key and produce a tie. Rather than
 * append random characters — which yields non-canonical keys that corrupt later
 * `generateKeyBetween` calls — we generate several evenly-spaced *canonical*
 * candidates in the gap and pick one at random. Every stored key stays a valid
 * fractional index (so future reorders between jittered keys keep working), and
 * two concurrent inserts into one gap collide only ~1/`JITTER_SLOTS` of the time
 * instead of always. Last-write-wins settles any residual tie (D3).
 */
const JITTER_SLOTS = 16;

/**
 * A `position` key that sorts strictly between `before` and `after`. Pass `null`
 * for an open end: `keyBetween(null, first)` prepends, `keyBetween(last, null)`
 * appends, `keyBetween(null, null)` is the first key on an empty list. `before`
 * must sort before `after`; both must be keys previously produced by this helper.
 *
 * With `jitter` (the default) the result is a random canonical candidate in the
 * gap; pass `jitter: false` for the deterministic midpoint (useful in tests).
 */
export function keyBetween(
  before: string | null,
  after: string | null,
  { jitter = true }: { jitter?: boolean } = {},
): string {
  if (!jitter) return generateKeyBetween(before, after);
  const candidates = generateNKeysBetween(before, after, JITTER_SLOTS);
  return candidates[Math.floor(Math.random() * candidates.length)];
}
