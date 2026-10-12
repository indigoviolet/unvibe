/**
 * Route error handler (issue #86, finding 2): an exception thrown inside
 * a route answers the app's usual error body (`{ error: <message> }`)
 * instead of Fastify's default (`{ statusCode, error: "Internal Server
 * Error", message }`, whose `error` field is what `friendlyError` prints).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server.js";

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  vi.restoreAllMocks();
});

async function boomApp(): Promise<FastifyInstance> {
  const created = await createApp("tok", { autoPipeline: false });
  app = created.app;
  app.get("/api/__boom", async () => {
    throw new Error("kaboom");
  });
  app.get("/api/__bad", async () => {
    throw Object.assign(new Error("bad input"), { statusCode: 400 });
  });
  return app;
}

const headers = { authorization: "Bearer tok" };

describe("route error handler (#86 finding 2)", () => {
  it("answers a thrown route exception with { error: message } and status 500", async () => {
    const fault = await boomApp();
    const res = await fault.inject({ method: "GET", url: "/api/__boom", headers });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "kaboom" });
  });

  it("keeps an explicit status code from a thrown error", async () => {
    const fault = await boomApp();
    const res = await fault.inject({ method: "GET", url: "/api/__bad", headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad input" });
  });

  it("logs the stack server-side and never sends it", async () => {
    const logged: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    const fault = await boomApp();
    const res = await fault.inject({ method: "GET", url: "/api/__boom", headers });
    expect(res.statusCode).toBe(500);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(errSpy).toHaveBeenCalled();
    expect(logged.join("\n")).toContain("kaboom");
  });
});
