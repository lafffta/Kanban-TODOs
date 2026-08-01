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

/** How a `position` is chosen for a gap — swappable so tests can force a collision. */
export type PositionGenerator = (before: string | null, after: string | null) => string;

/**
 * Optional seam on every position-writing db function. Production callers omit it
 * and get jittered `keyBetween`; tests inject a generator to force the collision
 * path deterministically, which random jitter can't be relied on to reproduce.
 */
export type PositionOptions = { generate?: PositionGenerator };

/**
 * How many keys we'll try before giving up. Each attempt strictly narrows the gap,
 * so a run of collisions converges fast; the bound exists to fail loudly rather
 * than spin if something is pathologically wrong.
 */
const MAX_POSITION_ATTEMPTS = 8;

/**
 * Thrown when every attempt to find a free `position` in a gap collided. Callers
 * get a typed refusal they can surface as "try again", not a raw driver 500.
 */
export class PositionCollisionError extends Error {
  constructor(
    readonly before: string | null,
    readonly after: string | null,
    readonly attempts: number,
  ) {
    super(
      `Could not find a free position between ${before ?? "start"} and ${
        after ?? "end"
      } after ${attempts} attempts.`,
    );
    this.name = "PositionCollisionError";
  }
}

/** Postgres' `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether an error is Postgres refusing a duplicate key. Drizzle wraps driver
 * errors, so the whole `cause` chain is searched rather than just the top error.
 */
export function isUniquePositionViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current != null && depth < 10; depth++) {
    if (typeof current === "object" && "code" in current) {
      if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Run `write` with a `position` that is free, retrying if the database refuses it
 * as a duplicate (D3, collision-safety).
 *
 * Jitter alone only makes a tie *unlikely* — two clients dropping into the same
 * gap can still pick the same candidate, and equal neighbouring keys are worse
 * than a tie: `generateKeyBetween` cannot produce a key between two equal ones, so
 * a collision poisons the gap for every later insert. The unique indexes on
 * `(board_id, position)` and `(column_id, position)` turn that silent corruption
 * into a refusal, and this helper turns the refusal into a retry.
 *
 * **Each retry narrows the gap**: the key that collided becomes the new upper
 * bound, so the next candidate is strictly smaller yet still above `before` — it
 * lands in the same slot the user asked for, and it cannot repeat a key we already
 * know is taken. That guarantees progress instead of re-rolling the same dice.
 */
export async function withUniquePosition<T>(
  before: string | null,
  after: string | null,
  write: (position: string) => Promise<T>,
  { generate = keyBetween }: PositionOptions = {},
): Promise<T> {
  let upper = after;

  for (let attempt = 1; attempt <= MAX_POSITION_ATTEMPTS; attempt++) {
    const position = generate(before, upper);
    try {
      return await write(position);
    } catch (error) {
      if (!isUniquePositionViolation(error)) throw error;
      // That key is taken — search below it, still inside the original gap.
      // Only narrow while the taken key is strictly above `before`; a key at or
      // below the lower bound would collapse the range to nothing and make the
      // next `generate` throw. In that case keep the current bounds and re-roll.
      if (before === null || position > before) upper = position;
    }
  }

  throw new PositionCollisionError(before, after, MAX_POSITION_ATTEMPTS);
}
