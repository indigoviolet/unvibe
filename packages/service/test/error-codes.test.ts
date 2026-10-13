/**
 * Error codes (issue #86, finding 10): the service sets a machine `code`
 * beside the unchanged human message; behaviour no longer depends on
 * matching message text.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { NO_AGENT_MESSAGE, NoAgentError } from "../src/agent/none.js";
import { errorCodeFor, errorCodeOf, sendError } from "../src/errors.js";
import { createApp } from "../src/server.js";

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("errorCodeFor (finding 10)", () => {
  it("maps unknown-X to not-found, keeping the old 404/400/501 statuses", () => {
    expect(errorCodeFor(404, "unknown review rv_1")).toBe("not-found");
    expect(errorCodeFor(500, "unknown card c1")).toBe("not-found");
    expect(errorCodeFor(500, "no pending card")).toBe("not-found");
    expect(errorCodeFor(400, "quote and anchor are required")).toBe("invalid-request");
    expect(errorCodeFor(500, "direction must be simpler or deeper")).toBe("invalid-request");
    expect(errorCodeFor(500, "not available in this build")).toBe("not-implemented");
    expect(errorCodeFor(501, "anything")).toBe("not-implemented");
    expect(errorCodeFor(500, NO_AGENT_MESSAGE)).toBe("no-agent");
    expect(errorCodeFor(500, "kaboom")).toBeUndefined();
  });

  it("prefers a code carried by the error itself", () => {
    expect(errorCodeOf(new NoAgentError())).toBe("no-agent");
    expect(errorCodeOf(new Error("no agent configured: custom"))).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
  });
});

describe("coded error responses (finding 10)", () => {
  it("a thrown NoAgentError answers 500 with code no-agent and the same message", async () => {
    const created = await createApp("tok", { autoPipeline: false });
    app = created.app;
    app.get("/api/__noagent", async () => {
      throw new NoAgentError();
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/__noagent",
      headers: { authorization: "Bearer tok" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: NO_AGENT_MESSAGE, code: "no-agent" });
  });

  it("a thrown unknown-review 404 carries code not-found", async () => {
    const created = await createApp("tok", { autoPipeline: false });
    app = created.app;
    app.get("/api/__missing", async () => {
      throw Object.assign(new Error("unknown review rv_nope"), { statusCode: 404 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/__missing",
      headers: { authorization: "Bearer tok" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown review rv_nope", code: "not-found" });
  });

  it("sendError answers the app's error body with its code", async () => {
    const created = await createApp("tok", { autoPipeline: false });
    app = created.app;
    app.get("/api/__bad-shape", async (_req, reply) => sendError(reply, 400, "slug is required"));
    const res = await app.inject({
      method: "GET",
      url: "/api/__bad-shape",
      headers: { authorization: "Bearer tok" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "slug is required", code: "invalid-request" });
  });
});
