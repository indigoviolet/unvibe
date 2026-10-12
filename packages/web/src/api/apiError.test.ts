/**
 * Error-code parsing (issue #86, finding 10): the client reads the
 * service's machine `code` from its own transport errors, falling back
 * to undefined (callers then use their previous text match) when the
 * response carries none.
 */
import { describe, expect, it } from "vitest";
import { apiErrorCode, parseApiError } from "./client.js";

describe("parseApiError", () => {
  it("reads status + code from a coded error body", () => {
    const err = new Error('POST /api/reviews/r1/submit: 409 {"error":"the PR has new commits","code":"head-moved"}');
    expect(parseApiError(err)).toEqual({
      status: 409,
      code: "head-moved",
      bodyText: '{"error":"the PR has new commits","code":"head-moved"}',
    });
    expect(apiErrorCode(err)).toBe("head-moved");
  });

  it("reads a coded no-agent failure", () => {
    const err = new Error(
      'POST /api/reviews/r1/actions: 500 {"error":"no agent configured: the service was started with UNVIBE_AGENT=none","code":"no-agent"}',
    );
    expect(apiErrorCode(err)).toBe("no-agent");
  });

  it("returns no code for responses without one (old clients keep text matching)", () => {
    const err = new Error('POST /api/reviews/r1/submit: 409 {"error":"the PR head moved — refresh"}');
    const parsed = parseApiError(err);
    expect(parsed.status).toBe(409);
    expect(parsed.code).toBeUndefined();
    expect(apiErrorCode(err)).toBeUndefined();
  });

  it("ignores unknown code strings", () => {
    const err = new Error('GET /api/x: 500 {"error":"boom","code":"super-new"}');
    expect(apiErrorCode(err)).toBeUndefined();
  });

  it("handles non-JSON bodies and plain errors", () => {
    expect(parseApiError(new Error("GET /api/x: 502 Bad Gateway"))).toEqual({
      status: 502,
      bodyText: "Bad Gateway",
    });
    expect(parseApiError(new Error("kaboom"))).toEqual({ bodyText: "kaboom" });
  });
});
