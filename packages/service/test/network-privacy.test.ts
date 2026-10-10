/**
 * Network and privacy guarantee (PRD §16).
 *
 * - The HTML shell is served with a strict Content-Security-Policy.
 * - End-to-end: boot the app, create the demo review with the replay
 *   runner, run pipeline actions, and assert no non-loopback connection
 *   attempt was made by the service process (see `vitest.setup.ts`, which
 *   makes non-loopback sockets fail suite-wide and records attempts on
 *   `globalThis.__unvibeNonLoopbackAttempts`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { CONTENT_SECURITY_POLICY } from "../src/security/csp.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const authed = { authorization: "Bearer tok" };

function nonLoopbackAttempts(): string[] {
  return (globalThis as { __unvibeNonLoopbackAttempts?: string[] }).__unvibeNonLoopbackAttempts ?? [];
}

describe("network and privacy", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
    (globalThis as { __unvibeNonLoopbackAttempts?: string[] }).__unvibeNonLoopbackAttempts = [];
  });

  it("serves a strict CSP on the HTML shell", async () => {
    const { app } = await createApp("tok", { autoPipeline: false });
    try {
      const res = await app.inject({ method: "GET", url: "/?token=tok" });
      // Without a web build the shell is a help page; with a build it is
      // index.html. Either way the CSP header must be present on HTML.
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      const policy = Array.isArray(csp) ? csp.join("; ") : String(csp);
      for (const part of [
        "default-src 'self'",
        "connect-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ]) {
        expect(policy, `CSP contains ${part}`).toContain(part);
      }
      expect(policy).not.toContain("https://");
      // Style unsafe-inline is scoped + justified (see csp.ts): Mermaid
      // injects inline <style> at runtime; scripts never use it.
      expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'");
      expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/);
    } finally {
      await app.close();
    }
  });

  it("offline page meta matches the served CSP", async () => {
    const startHtml = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "public", "start.html"),
      "utf8",
    );
    const m = startHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/);
    expect(m, "start.html carries a CSP meta").toBeTruthy();
    expect(m![1].replace(/\s+/g, " ").trim()).toBe(CONTENT_SECURITY_POLICY);
  });

  it("demo review with the replay runner makes no non-loopback connections", async () => {
    const replay = new ReplayAgentRunner({ fixturesDir, chunkChars: 256, delayMs: 5 });
    const { app, ctx } = await createApp("tok", { agents: replay });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;

      // Wait for the guide to stream (replay, no tokens, no network).
      const start = Date.now();
      for (;;) {
        const s = ctx.reviews.getSnapshot(id);
        const root = s?.pages.find((p) => p.id === "root");
        if (root && root.cards.length >= 3) break;
        if (Date.now() - start > 60000) throw new Error("demo pipeline did not stream");
        await new Promise((r) => setTimeout(r, 100));
      }

      // Run an action + refresh/list/readiness (all local-only paths).
      await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      await app.inject({ method: "GET", url: "/api/readiness", headers: authed });
      await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });

      expect(nonLoopbackAttempts()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
