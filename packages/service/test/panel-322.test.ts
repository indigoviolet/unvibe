/**
 * #322 part 2: lockdown retriever, panel endpoints on web reviews,
 * extension status/folder. Real Fastify app, fake runner, no agents
 * (panelAnswer falls back to retriever evidence), scratch dirs only.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_EXTENSION_ID, extensionOrigin, parseRepoCodeCitation } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import { assertInsideRepo, retrieveAcrossRepos } from "../src/panel/retriever.js";
import { openFolderCommand } from "../src/panel/status.js";

const GOOD = extensionOrigin(PINNED_EXTENSION_ID);
const BAD = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AUTH = "Bearer tok";

function repo(id: string, owner: string, name: string, files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `unvibe-panel-${name}-`));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return { id, owner, name, localPath: dir, lastOpened: 0 };
}

describe("panel retriever lockdown", () => {
  it("reads both repos, cites both repo-qualified; escapes refused", () => {
    const a = repo("svc", "acme", "service", { "src/auth.ts": "export function validateToken(t: string) { return true; }\n" });
    const b = repo("cli", "acme", "client", { "src/api.ts": "export async function fetchSession() { return 1; }\n" });
    try {
      const r = retrieveAcrossRepos([a, b], "How does validateToken work with fetchSession?");
      expect(r.reposUsed).toEqual(["acme/service", "acme/client"]);
      for (const c of r.citations) expect(parseRepoCodeCitation(c)).not.toBeNull();
      expect(() => assertInsideRepo(a.localPath, "/etc/passwd")).toThrow(/outside/);
    } finally { rmSync(a.localPath, { recursive: true, force: true }); rmSync(b.localPath, { recursive: true, force: true }); }
  });
  it("open folder command per platform", () => {
    expect(openFolderCommand("darwin", "/x/extension")).toEqual({ cmd: "open", args: ["/x/extension"] });
    expect(openFolderCommand("linux", "/x/extension")).toEqual({ cmd: "xdg-open", args: ["/x/extension"] });
  });
});

describe("panel endpoints", () => {
  it("ask creates one web review per page, second ask reuses it; bad origin 403; status shows worker call", async () => {
    const a = repo("svc", "acme", "service", { "src/auth.ts": "export function validateToken(t: string) { return true; }\n" });
    const { app, ctx } = await createApp("tok", { runner: new FakeCommandRunner(), agents: undefined });
    try {
      ctx.repos.upsert(a);
      ctx.settings.update({ extensionActiveRepoIds: [a.id] });
      const url = "https://github.com/acme/app/pull/1";
      const ask = (origin: string) => app.inject({
        method: "POST", url: "/api/extension/panel/ask",
        headers: { origin, authorization: AUTH, "content-type": "application/json" },
        payload: JSON.stringify({ url, title: "PR", selection: "", context: "page text validateToken", question: "Where is validateToken?" }),
      });
      const bad = await ask(BAD);
      expect(bad.statusCode).toBe(403);
      const first = await ask(GOOD);
      expect(first.statusCode).toBe(200);
      const body1 = first.json();
      expect(body1.reviewId).toBeTruthy();
      expect(body1.thread.messages).toHaveLength(2);
      expect(body1.thread.messages[1].citations.some((c: string) => c.startsWith("code:acme/service:"))).toBe(true);
      const second = await ask(GOOD);
      expect(second.json().reviewId).toBe(body1.reviewId);
      expect(second.json().thread.messages).toHaveLength(4);
      const snap = ctx.reviews.getSnapshot(body1.reviewId);
      expect(snap?.web?.pageKey).toContain("github.com/acme/app/pull/1");
      const status = await app.inject({ method: "GET", url: "/api/extension/status", headers: { authorization: AUTH } });
      expect(status.statusCode).toBe(200);
      expect(status.json().extensionPath).toContain("extension");
      expect(status.json().lastWorkerCallAt).not.toBeNull();
      expect(status.json().connected).toBe(true);
      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: { authorization: AUTH } });
      expect(list.json().reviews.find((r: { id: string }) => r.id === body1.reviewId)?.kind).toBe("web");
    } finally { await app.close(); rmSync(a.localPath, { recursive: true, force: true }); }
  });
});
