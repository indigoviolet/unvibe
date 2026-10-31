/**
 * #322 part 1: extension endpoints against the real Fastify app.
 *
 * - `/api/extension/pr-status`: exact allowlisted extension origin passes
 *   the origin gate (CORS + check), an unknown extension origin is 403,
 *   the token is still required, and the extension origin is refused on
 *   every other endpoint.
 * - `/open?pr=…`: an existing review redirects to it.
 */
import { describe, expect, it } from "vitest";
import { PINNED_EXTENSION_ID, extensionOrigin, type ReviewSnapshot } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const GOOD_ORIGIN = extensionOrigin(PINNED_EXTENSION_ID);
const BAD_ORIGIN = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AUTH = "Bearer " + "t" + "ok";
const PR = "https://github.com/acme/app/pull/7";

function seedSnapshot(): ReviewSnapshot {
  return {
    review: { id: "rv_ext", repoId: "rp_ext", branch: "feature", prNumber: 7, versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
}

async function seededApp() {
  const made = await createApp("tok", { runner: new FakeCommandRunner(), agents: undefined });
  made.ctx.repos.upsert({ id: "rp_ext", owner: "acme", name: "app", localPath: "/tmp", lastOpened: 0 });
  made.ctx.db
    .prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("rv_ext", "rp_ext", "feature", 7, 1, 0, JSON.stringify({ title: "PR #7" }));
  made.ctx.reviews.putSnapshot("rv_ext", seedSnapshot());
  return made;
}

describe("extension pr-status endpoint", () => {
  it("answers exists for the allowlisted origin with a token", async () => {
    const { app } = await seededApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/extension/pr-status?pr=${encodeURIComponent(PR)}`,
        headers: { origin: GOOD_ORIGIN, authorization: AUTH },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ exists: true, reviewId: "rv_ext", status: "ready" });
      expect(res.headers["access-control-allow-origin"]).toBe(GOOD_ORIGIN);
    } finally {
      await app.close();
    }
  });

  it("answers exists:false for a PR with no review", async () => {
    const { app } = await seededApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/extension/pr-status?pr=${encodeURIComponent("https://github.com/acme/app/pull/99")}`,
        headers: { origin: GOOD_ORIGIN, authorization: AUTH },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ exists: false });
    } finally {
      await app.close();
    }
  });

  it("refuses an unknown extension origin, and the allowlisted origin elsewhere", async () => {
    const { app } = await seededApp();
    try {
      const unknown = await app.inject({
        method: "GET",
        url: `/api/extension/pr-status?pr=${encodeURIComponent(PR)}`,
        headers: { origin: BAD_ORIGIN, authorization: AUTH },
      });
      expect(unknown.statusCode).toBe(403);
      const elsewhere = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { origin: GOOD_ORIGIN, authorization: AUTH },
      });
      expect(elsewhere.statusCode).toBe(403);
      const wildcard = await app.inject({
        method: "GET",
        url: `/api/extension/pr-status?pr=${encodeURIComponent(PR)}`,
        headers: { origin: "chrome-extension://*", authorization: AUTH },
      });
      expect(wildcard.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("still requires the token from the allowlisted origin", async () => {
    const { app } = await seededApp();
    try {
      const noToken = await app.inject({
        method: "GET",
        url: `/api/extension/pr-status?pr=${encodeURIComponent(PR)}`,
        headers: { origin: GOOD_ORIGIN },
      });
      expect(noToken.statusCode).toBe(401);
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/extension/pr-status",
        headers: { origin: GOOD_ORIGIN, "access-control-request-method": "GET" },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(GOOD_ORIGIN);
    } finally {
      await app.close();
    }
  });

  it("rejects a bad PR URL with 400", async () => {
    const { app } = await seededApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/extension/pr-status?pr=https://github.com/acme/app",
        headers: { origin: GOOD_ORIGIN, authorization: AUTH },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("/open deep link", () => {
  it("redirects to the existing review (cookie auth)", async () => {
    const { app } = await seededApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/open?pr=${encodeURIComponent(PR)}`,
        headers: { cookie: "__unvibe_token=tok", accept: "text/html" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/review/rv_ext");
    } finally {
      await app.close();
    }
  });

  it("400s on a non-PR deep link", async () => {
    const { app } = await seededApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/open?pr=https://github.com/acme/app/issues/3",
        headers: { cookie: "__unvibe_token=tok", accept: "text/html" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
