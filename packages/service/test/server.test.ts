import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("HTTP auth gate", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("/api/health is open; /api/* needs the token", async () => {
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
      expect(header.statusCode).toBe(200);

      const query = await app.inject({ method: "GET", url: "/api/repos?token=test-token" });
      expect(query.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("every PRD §14.1 endpoint is registered and gated", async () => {
    const { app } = await createApp("test-token");
    const authed = { authorization: "Bearer test-token" };
    // All milestones landed: nothing stays 501 on this branch.
    const stubs: { method: "GET" | "POST" | "PATCH" | "PUT"; url: string }[] = [];
    // M1 service + M3 pipeline + M6 comments/description/submit: functional
    // statuses, not 501.
    const live: { method: "GET" | "POST" | "PATCH" | "PUT"; url: string; status: number }[] = [
      { method: "GET", url: "/api/repos", status: 200 },
      { method: "POST", url: "/api/repos", status: 400 },
      { method: "GET", url: "/api/repos/r1/changes", status: 404 },
      { method: "GET", url: "/api/repos/demo/changes", status: 200 },
      { method: "POST", url: "/api/reviews", status: 400 },
      { method: "GET", url: "/api/reviews/r1", status: 404 },
      { method: "POST", url: "/api/reviews/r1/refresh", status: 404 },
      { method: "POST", url: "/api/reviews/r1/update", status: 404 },
      { method: "POST", url: "/api/reviews/r1/actions", status: 400 },
      { method: "POST", url: "/api/reviews/r1/resume", status: 404 },
      { method: "POST", url: "/api/reviews/r1/hunks/abc/summarize", status: 404 },
      { method: "PATCH", url: "/api/reviews/r1/hunks/abc", status: 400 },
      { method: "GET", url: "/api/settings", status: 200 },
      { method: "GET", url: "/api/jobs", status: 400 },
      { method: "PATCH", url: "/api/reviews/r1/comments/c1", status: 400 },
      { method: "PUT", url: "/api/reviews/r1/description", status: 400 },
      { method: "POST", url: "/api/reviews/r1/submit", status: 404 },
    ];
    try {
      for (const c of [...stubs, ...live]) {
        const anon = await app.inject({ method: c.method, url: c.url });
        expect(anon.statusCode, c.url).toBe(401);
      }
      for (const c of stubs) {
        const res = await app.inject({ method: c.method, url: c.url, headers: authed });
        expect(res.statusCode, c.url).toBe(501);
      }
      for (const c of live) {
        const res = await app.inject({
          method: c.method,
          url: c.url,
          headers: authed,
          ...(c.method === "POST" || c.method === "PATCH" ? { payload: {} } : {}),
        });
        expect(res.statusCode, c.url).toBe(c.status);
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
      // Review expansion is wired to the ReviewStore: unknown reviews 404.
      const review = await app.inject({
        method: "GET",
        url: "/api/prompts?review=r1",
        headers: { authorization: "Bearer test-token" },
      });
      expect(review.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
