import { describe, expect, it } from "vitest";
import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  isConstraintViolation,
} from "./pg-errors";

// Unit test for the shared constraint-violation matcher. It has no database in
// it: what matters is which errors it *claims*, and the risk it guards against is
// claiming too many — a caller that answers an unrelated failure with its own
// friendly message hides the real fault behind a plausible lie.

/** A stand-in for the error the Postgres driver raises for a constraint. */
function violation(code: string, constraint?: string) {
  return Object.assign(new Error("constraint violated"), { code, constraint });
}

/** Drizzle hands back its own error with the driver's underneath. */
function wrapped(inner: unknown): Error {
  return Object.assign(new Error("Failed query"), { cause: inner });
}

const owns = (name: string) => (constraint: string) => constraint === name;

describe("isConstraintViolation", () => {
  it("recognises a bare violation of the named constraint", () => {
    const error = violation(UNIQUE_VIOLATION, "users_email_canonical_unique");
    expect(
      isConstraintViolation(error, UNIQUE_VIOLATION, owns("users_email_canonical_unique")),
    ).toBe(true);
  });

  it("finds the violation through a cause chain", () => {
    const error = wrapped(wrapped(violation(FOREIGN_KEY_VIOLATION, "cards_assignee_board_member_fk")));
    expect(
      isConstraintViolation(
        error,
        FOREIGN_KEY_VIOLATION,
        owns("cards_assignee_board_member_fk"),
      ),
    ).toBe(true);
  });

  it("does not claim the same constraint under a different code", () => {
    const error = violation(UNIQUE_VIOLATION, "cards_assignee_board_member_fk");
    expect(
      isConstraintViolation(
        error,
        FOREIGN_KEY_VIOLATION,
        owns("cards_assignee_board_member_fk"),
      ),
    ).toBe(false);
  });

  it("does not claim the same code on a constraint it doesn't own", () => {
    const error = violation(FOREIGN_KEY_VIOLATION, "cards_column_id_columns_id_fk");
    expect(
      isConstraintViolation(
        error,
        FOREIGN_KEY_VIOLATION,
        owns("cards_assignee_board_member_fk"),
      ),
    ).toBe(false);
  });

  it("does not claim a violation that names no constraint", () => {
    expect(isConstraintViolation({ code: UNIQUE_VIOLATION }, UNIQUE_VIOLATION, () => true)).toBe(
      false,
    );
  });

  it("does not claim errors that aren't database errors at all", () => {
    expect(isConstraintViolation(new Error("boom"), UNIQUE_VIOLATION, () => true)).toBe(false);
    expect(isConstraintViolation(null, UNIQUE_VIOLATION, () => true)).toBe(false);
    expect(isConstraintViolation(undefined, UNIQUE_VIOLATION, () => true)).toBe(false);
  });

  it("terminates on a cause chain that points back at itself", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isConstraintViolation(cyclic, UNIQUE_VIOLATION, () => true)).toBe(false);
  });
});
