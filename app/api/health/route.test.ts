import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkDatabase } from "@/db/queries";
import { GET } from "./route";

// `/api/health` is unauthenticated — anyone on the internet can call it, so the
// probe answers "up" or "down" and nothing else. These cases pin both halves:
// the fixed response shape, and the cause going to the server log instead.

vi.mock("@/db/queries", () => ({ checkDatabase: vi.fn() }));

const probe = vi.mocked(checkDatabase);

// A representative node-postgres connection failure: the message alone names the
// host and port, and the driver hangs its own fields off the error.
function driverFailure(): Error & { code: string } {
  return Object.assign(
    new Error("connect ECONNREFUSED 10.1.2.3:5432 (ep-secret-123.neon.tech)"),
    { code: "ECONNREFUSED" },
  );
}

beforeEach(() => {
  probe.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a reachable database answers 200 ok/up", async () => {
  probe.mockResolvedValue(undefined);

  const response = await GET();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", db: "up" });
});

test("a driver failure answers 503 error/down and nothing else", async () => {
  probe.mockRejectedValue(driverFailure());

  const response = await GET();

  expect(response.status).toBe(503);
  // Whole-body equality, not a subset check — that is what makes this a leak
  // test: the host, port and driver code in the thrown message have nowhere to
  // hide, because any field beyond these two fails the assertion.
  expect(await response.json()).toEqual({ status: "error", db: "down" });
});

test("a non-Error thrown value is still answered generically", async () => {
  // Drivers and their transports don't always throw an `Error` — a rejected
  // WebSocket handshake can surface as a string or an event object.
  probe.mockRejectedValue("connect ECONNREFUSED 10.1.2.3:5432");

  const response = await GET();

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "error", db: "down" });
});

test("the failure is logged server-side for diagnosis", async () => {
  const failure = driverFailure();
  probe.mockRejectedValue(failure);

  await GET();

  // The operator needs the cause the caller doesn't get: the thrown value
  // itself, so the message, `code` and stack all reach the platform log.
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining("/api/health"),
    failure,
  );
});
