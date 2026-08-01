import { describe, expect, it, vi } from "vitest";
import {
  PositionCollisionError,
  isUniquePositionViolation,
  keyBetween,
  withUniquePosition,
} from "./ordering";

/** A stand-in for the `23505` Postgres raises when a *position* index is violated. */
function uniqueViolation(
  constraint = "columns_board_id_position_unique",
): Error & { code: string; constraint: string } {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
}

/** Postgres surfaces driver errors wrapped by drizzle, so the cause chain matters. */
function wrapped(inner: unknown): Error {
  return Object.assign(new Error("Failed query"), { cause: inner });
}

describe("isUniquePositionViolation", () => {
  it("recognises a bare 23505", () => {
    expect(isUniquePositionViolation(uniqueViolation())).toBe(true);
  });

  it("recognises a 23505 wrapped in a cause chain", () => {
    expect(isUniquePositionViolation(wrapped(wrapped(uniqueViolation())))).toBe(true);
  });

  it("matches the cards index too", () => {
    expect(isUniquePositionViolation(uniqueViolation("cards_column_id_position_unique"))).toBe(
      true,
    );
  });

  it("does not claim unrelated errors", () => {
    expect(isUniquePositionViolation(new Error("boom"))).toBe(false);
    expect(isUniquePositionViolation({ code: "23503" })).toBe(false);
    expect(isUniquePositionViolation(null)).toBe(false);
  });

  it("does not claim a 23505 on some other constraint", () => {
    // Re-rolling a position would never fix a duplicate PK or invite token, so
    // those must surface rather than being retried into an attempt limit.
    expect(isUniquePositionViolation(uniqueViolation("cards_pkey"))).toBe(false);
    expect(isUniquePositionViolation(uniqueViolation("board_invites_token_unique"))).toBe(false);
    // A 23505 with no constraint name is not assumed to be ours either.
    expect(isUniquePositionViolation({ code: "23505" })).toBe(false);
  });
});

describe("withUniquePosition", () => {
  it("writes once with a key inside the gap when nothing collides", async () => {
    const write = vi.fn(async (position: string) => position);
    const result = await withUniquePosition("a0", "a2", write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(result > "a0" && result < "a2").toBe(true);
  });

  it("retries a collision with a different key that still sorts inside the gap", async () => {
    const attempted: string[] = [];
    const write = vi.fn(async (position: string) => {
      attempted.push(position);
      // Refuse the first key the way a unique index would.
      if (attempted.length === 1) throw uniqueViolation();
      return position;
    });

    const result = await withUniquePosition("a0", "a2", write);

    expect(write).toHaveBeenCalledTimes(2);
    expect(result).not.toBe(attempted[0]);
    // The retry must still land strictly between the neighbours — a narrower key,
    // not one that escapes the gap and reorders the row somewhere else.
    expect(result > "a0" && result < "a2").toBe(true);
  });

  it("keeps narrowing across several collisions and still orders correctly", async () => {
    const attempted: string[] = [];
    const write = vi.fn(async (position: string) => {
      attempted.push(position);
      if (attempted.length <= 3) throw uniqueViolation();
      return position;
    });

    const result = await withUniquePosition("a0", "a2", write);

    expect(write).toHaveBeenCalledTimes(4);
    expect(new Set(attempted).size).toBe(attempted.length); // every attempt distinct
    expect(result > "a0" && result < "a2").toBe(true);
  });

  it("retries against an open upper end", async () => {
    const attempted: string[] = [];
    const write = vi.fn(async (position: string) => {
      attempted.push(position);
      if (attempted.length === 1) throw uniqueViolation();
      return position;
    });

    const result = await withUniquePosition("a0", null, write);

    expect(result > "a0").toBe(true);
    expect(result).not.toBe(attempted[0]);
  });

  it("survives a collision on a key that is not inside the gap", async () => {
    // A generator can hand back the lower bound itself. Narrowing to it would
    // collapse the range and make the next generate throw, so the helper must
    // keep its bounds and re-roll instead.
    const generate = vi
      .fn<typeof keyBetween>()
      .mockReturnValueOnce("a0") // equal to `before` — cannot narrow below it
      .mockImplementation((before, after) => keyBetween(before, after));
    const write = vi.fn(async (position: string) => {
      if (position === "a0") throw uniqueViolation();
      return position;
    });

    const result = await withUniquePosition("a0", null, write, { generate });

    expect(result > "a0").toBe(true);
  });

  it("gives up with PositionCollisionError rather than looping forever", async () => {
    const write = vi.fn(async () => {
      throw uniqueViolation();
    });

    await expect(withUniquePosition("a0", "a2", write)).rejects.toBeInstanceOf(
      PositionCollisionError,
    );
    // Bounded, not infinite.
    expect(write.mock.calls.length).toBeGreaterThan(1);
    expect(write.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("propagates a non-collision error untouched, without retrying", async () => {
    const boom = new Error("connection reset");
    const write = vi.fn(async () => {
      throw boom;
    });

    await expect(withUniquePosition("a0", "a2", write)).rejects.toBe(boom);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("uses an injected generator, so a collision can be forced deterministically", async () => {
    const generate = vi
      .fn<typeof keyBetween>()
      .mockReturnValueOnce("a1")
      .mockImplementation((before, after) => keyBetween(before, after));
    const attempted: string[] = [];
    const write = vi.fn(async (position: string) => {
      attempted.push(position);
      if (position === "a1") throw uniqueViolation();
      return position;
    });

    const result = await withUniquePosition("a0", "a2", write, { generate });

    expect(attempted[0]).toBe("a1");
    expect(result).not.toBe("a1");
  });
});
