import { expect, test } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

// The auth forms carry a "come back here afterwards" target through sign-in and
// sign-up (an invite link is the reason it exists), and that target arrives as
// user-controlled input. These cases pin the rule: an in-app path is honoured,
// anything that could leave the app falls back.

const FALLBACK = "/boards";

test("an in-app path is honoured", () => {
  expect(safeRedirectPath("/invite/abc123", FALLBACK)).toBe("/invite/abc123");
  expect(safeRedirectPath("/boards/7?mine=1", FALLBACK)).toBe("/boards/7?mine=1");
});

test("a missing or empty target falls back", () => {
  expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("", FALLBACK)).toBe(FALLBACK);
});

test("a target that leaves the app falls back", () => {
  // Absolute URLs, protocol-relative hosts and the backslash variant browsers
  // normalise to one — each would hand the session off to another origin.
  expect(safeRedirectPath("https://evil.example/steal", FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("//evil.example/steal", FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("/\\evil.example/steal", FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  // A relative path is ambiguous against the form's own URL — not honoured.
  expect(safeRedirectPath("invite/abc123", FALLBACK)).toBe(FALLBACK);
});

test("a target carrying whitespace or control characters falls back", () => {
  expect(safeRedirectPath(" /invite/abc", FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("/\t//evil.example", FALLBACK)).toBe(FALLBACK);
  expect(safeRedirectPath("/invite/a\nb", FALLBACK)).toBe(FALLBACK);
});
