/**
 * Recognising the Postgres errors this app answers rather than propagates.
 *
 * Three writes here lean on a constraint instead of a check-then-write, and each
 * has to tell *its* constraint firing apart from any other database failure: a
 * duplicate account (`db/auth.ts`), a position collision (`db/ordering.ts`), a
 * card assigned to a non-member (`db/cards.ts`). Matching too widely is the real
 * hazard — a `23505` on some unrelated index reported as "that email is taken"
 * would be a lie that buries the actual fault — so every caller names both the
 * code *and* which constraint it will answer for.
 */

/** Postgres' `unique_violation` — a duplicate key on a unique index. */
export const UNIQUE_VIOLATION = "23505";

/** Postgres' `foreign_key_violation` — a reference with nothing on the other end. */
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Whether `error` is Postgres refusing a write with `code`, on a constraint the
 * caller claims via `ownsConstraint`.
 *
 * Drizzle wraps driver errors, so the whole `cause` chain is searched rather than
 * just the error handed back. The walk is bounded: a self-referential `cause` is
 * not worth hanging a request over, and nothing legitimate nests this deep.
 * A violation carrying no constraint name matches nothing — an unnamed constraint
 * is not evidence that it was ours.
 */
export function isConstraintViolation(
  error: unknown,
  code: string,
  ownsConstraint: (constraint: string) => boolean,
): boolean {
  let cursor = error;
  for (let depth = 0; cursor instanceof Object && depth < 10; depth += 1) {
    const found = cursor as { code?: unknown; constraint?: unknown };
    if (
      found.code === code &&
      typeof found.constraint === "string" &&
      ownsConstraint(found.constraint)
    ) {
      return true;
    }
    cursor = Reflect.get(cursor, "cause");
  }
  return false;
}
