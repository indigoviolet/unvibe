import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("HTTP auth gate", () => {
  it("/api/health is open; /api/* needs the token; stubs 501 with it", async () => {
    const { app } = await createApp("test-token");
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);

      const noToken = await app.inject({ method: "GET", url: "/api/repos" });
      expect(noToken.statusCode).toBe(401);

      const badToken = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { authorization: "Bearer wrong" },
      });
      expect(badToken.statusCode).toBe(401);

      const header = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { authorization: "Bearer test-token" },
      });
      expect(header.statusCode).toBe(501);

      const query = await app.inject({ method: "GET", url: "/api/repos?token=test-token" });
      expect(query.statusCode).toBe(501);
    } finally {
      await app.close();
    }
  });

  it("every PRD §14.1 stub endpoint is registered and gated", async () => {
    const { app } = await createApp("test-token");
    const authed = { authorization: "Bearer test-token" };
    const cases: { method: "GET" | "POST" | "PATCH" | "PUT"; url: string }[] = [
      { method: "GET", url: "/api/repos" },
      { method: "POST", url: "/api/repos" },
      { method: "GET", url: "/api/repos/r1/changes" },
      { method: "POST", url: "/api/reviews" },
      { method: "GET", url: "/api/reviews/r1" },
      { method: "POST", url: "/api/reviews/r1/refresh" },
      { method: "POST", url: "/api/reviews/r1/update" },
      { method: "POST", url: "/api/reviews/r1/actions" },
      { method: "PATCH", url: "/api/reviews/r1/hunks/abc" },
      { method: "POST", url: "/api/reviews/r1/hunks/abc/summarize" },
      { method: "PATCH", url: "/api/reviews/r1/comments/c1" },
      { method: "PUT", url: "/api/reviews/r1/description" },
      { method: "POST", url: "/api/reviews/r1/submit" },
      { method: "GET", url: "/api/settings" },
      { method: "PUT", url: "/api/settings" },
      { method: "GET", url: "/api/jobs" },
    ];
    try {
      for (const c of cases) {
        const anon = await app.inject({ method: c.method, url: c.url });
        expect(anon.statusCode, c.url).toBe(401);
        const authedRes = await app.inject({ method: c.method, url: c.url, headers: authed });
        expect(authedRes.statusCode, c.url).toBe(501);
      }
    } finally {
      await app.close();
    }
  });

  it("GET /api/prompts lists templates (implemented, not a stub)", async () => {
    const { app } = await createApp("test-token");
    try {
      const anon = await app.inject({ method: "GET", url: "/api/prompts" });
      expect(anon.statusCode).toBe(401);
      const res = await app.inject({
        method: "GET",
        url: "/api/prompts",
        headers: { authorization: "Bearer test-token" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { templates: { name: string }[] };
      expect(body.templates.length).toBe(18);
      // Review expansion is unwired by default (no snapshot provider).
      const review = await app.inject({
        method: "GET",
        url: "/api/prompts?review=r1",
        headers: { authorization: "Bearer test-token" },
      });
      expect(review.statusCode).toBe(501);
    } finally {
      await app.close();
    }
  });
});
