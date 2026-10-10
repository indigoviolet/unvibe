/**
 * M6 viewer endpoint: `GET /api/viewer` returns the `gh api user` login
 * and caches it (one `gh` call for repeated hits); `{ login: null }` when
 * `gh` fails.
 */
import { describe, expect, it } from "vitest";
import { FakeCommandRunner } from "../src/exec/index.js";
import { clearViewerCache } from "../src/routes/viewer.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

describe("viewer", () => {
  it("returns the gh login and caches it", async () => {
    clearViewerCache();
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: JSON.stringify({ login: "author" }), stderr: "", code: 0 });
    const { app } = await createApp("tok", { runner });
    try {
      const first = await app.inject({ method: "GET", url: "/api/viewer", headers: authed });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ login: "author" });
      // Cached: a second hit makes no further `gh` call.
      const second = await app.inject({ method: "GET", url: "/api/viewer", headers: authed });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ login: "author" });
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0].opts.args).toEqual(["api", "user"]);
    } finally {
      await app.close();
    }
  });

  it("returns null login when gh fails", async () => {
    clearViewerCache();
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "auth error", code: 1 });
    const { app } = await createApp("tok", { runner });
    try {
      const res = await app.inject({ method: "GET", url: "/api/viewer", headers: authed });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ login: null });
    } finally {
      await app.close();
    }
  });
});
