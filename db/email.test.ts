import { describe, expect, it } from "vitest";
import { canonicalEmail } from "./email";

// What counts as "the same person" — the rule the unique index enforces and every
// auth boundary applies. Pure, so no database needed.

describe("canonicalEmail", () => {
  it("folds case and surrounding whitespace into one identity", () => {
    const forms = [
      "ada@example.com",
      "Ada@Example.com",
      "ADA@EXAMPLE.COM",
      "  ada@example.com  ",
      "\tAda@Example.com\n",
    ];
    expect(new Set(forms.map(canonicalEmail))).toEqual(new Set(["ada@example.com"]));
  });

  it("leaves an already-canonical address untouched", () => {
    expect(canonicalEmail("ada@example.com")).toBe("ada@example.com");
  });

  it("keeps distinct addresses distinct", () => {
    // Deliberately *not* provider-specific folding: gmail ignores dots and `+tag`
    // suffixes, but those rules are per-provider and change without notice —
    // guessing wrong would silently merge two people into one account.
    expect(canonicalEmail("ada+work@example.com")).not.toBe(
      canonicalEmail("ada@example.com"),
    );
    expect(canonicalEmail("a.da@example.com")).not.toBe(
      canonicalEmail("ada@example.com"),
    );
    // Whitespace *inside* an address isn't padding, so it isn't stripped.
    expect(canonicalEmail(" a da@example.com ")).toBe("a da@example.com");
  });
});
