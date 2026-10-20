/**
 * versions/update: update-pass application with a fake prompt runner.
 *
 * - The route enqueues an `update-pass` job (202 + jobId) only when the
 *   review is stale; otherwise 409.
 * - The job sends only changed/new hunks (prompt snapshot contains the
 *   `h:` IDs, not the full diff), parses the fake reply, and applies it:
 *   revised stale cards (new revisions, stale cleared), rechecked findings,
 *   new findings, regenerated hunk summaries, `versionStatus.stale` cleared.
 * - `JsonBlockReplyParser` unit: trailing block parsing + verdict validation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot, UpdatePassResult } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { JobQueue } from "../src/jobs/index.js";
import { createApp } from "../src/server.js";
import { JsonBlockReplyParser } from "../src/versions/update.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function fakeReply(newHash: string): string {
  const result: UpdatePassResult = {
    revisedCards: [{
      cardId: "c-a",
      revision: 2,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: "revised for new code" }, citations: [] }],
    }],
    recheckedFindings: [{ pageId: "f-1", verdict: "still-applies", evidence: "still holds" }],
    newFindings: [{
      pageId: "f-new",
      title: "New issue",
      confidence: "medium",
      summary: "new code risk",
      cards: [{
        id: "c-new", pageId: "f-new", title: "New", level: "standard", collapsed: false,
        revision: 1, blocks: [], undoStack: [],
      }],
    }],
    hunkSummaries: { [newHash]: "regenerated one-liner" },
  };
  return `Revised the card, rechecked the finding.\n\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n`;
}

describe("update pass", () => {
  it("enqueues, runs on the fake base runner, and applies the result", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-m5u-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
    await git(dir, "commit", "-am", "change");

    const queue = new JobQueue();
    const seenPrompts: string[] = [];
    const baseRunner = {
      runUpdatePrompt: async (prompt: string) => {
        seenPrompts.push(prompt);
        const snap = (globalThis as { __snap?: ReviewSnapshot }).__snap;
        const newHash = snap ? snap.files[0].hunks[0].contentHash : "deadbeef";
        return fakeReply(newHash);
      },
    };
    const { app, ctx } = await createApp("tok", {runner: real, jobs: queue, baseRunner, autoPipeline: false});
    try {
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch: "feature" } });
      const loading = created.json() as ReviewSnapshot;
      const id = loading.review.id;
      // #92: wait for the background ingest (update refuses loading).
      {
        const start = Date.now();
        while (Date.now() - start < 15000) {
          const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
          if (got.statusCode === 200) {
            const snap = got.json() as ReviewSnapshot;
            if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Fresh review: update is 409 (nothing stale).
      const fresh = await app.inject({ method: "POST", url: `/api/reviews/${id}/update`, headers: authed });
      expect(fresh.statusCode).toBe(409);

      // Seed a stale card + finding + stale hunk, then force stale status.
      await ctx.reviews.mutate(id, (draft) => {
        const h = draft.files[0].hunks[0];
        const hk = `h:${draft.files[0].fileKey}:${h.contentHash}`;
        draft.hunkStates.push({ contentHash: h.contentHash, folded: false, reviewed: false, stale: true, needsSummary: true });
        draft.pages.push({
          id: "p-root", kind: "root", title: "Guide", saved: false,
          cards: [{
            id: "c-a", pageId: "p-root", title: "A", level: "standard", collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "old prose" }, citations: [{ target: hk }] }],
            undoStack: [],
            stale: true, staleChangedHunks: 1, staleHunks: [hk],
          }],
        });
        draft.pages.push({
          id: "f-1", kind: "finding", title: "Finding", saved: false, confidence: "medium",
          summary: "something", cards: [], needsRecheck: true, recheckStatus: "pending",
        });
        draft.versionStatus = {
          stale: true, fromVersion: 1, toVersion: 1, unchangedHunks: 0, changedHunks: 1,
          newHunks: 0, removedHunks: 0, renamedFiles: [], changedOldIds: [hk], changedNewIds: [hk],
          rangeDiff: "", fetchedAt: Date.now(),
        };
      });
      (globalThis as { __snap?: ReviewSnapshot }).__snap = ctx.reviews.getSnapshot(id) ?? undefined;

      const enq = await app.inject({ method: "POST", url: `/api/reviews/${id}/update`, headers: authed });
      expect(enq.statusCode).toBe(202);
      const { jobId } = enq.json() as { jobId: string };
      expect(typeof jobId).toBe("string");

      await queue.drain(5000);
      const job = queue.get(jobId)!;
      expect(job.state).toBe("done");
      expect(job.promptSnapshot).toContain("Changed and new hunks");
      expect(seenPrompts).toHaveLength(1);

      const after = ctx.reviews.getSnapshot(id)!;
      const card = after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-a")!;
      expect(card.revision).toBe(2);
      expect(card.stale).toBe(false);
      expect(card.blocks[0].type).toBe("paragraph");
      const finding = after.pages.find((p) => p.id === "f-1")!;
      expect(finding.recheckStatus).toBe("still-applies");
      expect(finding.needsRecheck).toBe(false);
      expect(after.pages.some((p) => p.id === "f-new")).toBe(true);
      const newHash = after.files[0].hunks[0].contentHash;
      expect(after.hunkStates.find((s) => s.contentHash === newHash)?.summary).toBe("regenerated one-liner");
      expect(after.versionStatus?.stale).toBe(false);
    } finally {
      await app.close();
      delete (globalThis as { __snap?: ReviewSnapshot }).__snap;
    }
  });

  it("JsonBlockReplyParser parses the trailing block and rejects bad verdicts", () => {
    const parser = new JsonBlockReplyParser();
    const ok = parser.parseReply('prose\n```json\n{"revisedCards":[],"recheckedFindings":[],"newFindings":[],"hunkSummaries":{"ab":"s"}}\n```\n');
    expect(ok.hunkSummaries).toEqual({ ab: "s" });
    expect(() => parser.parseReply("no block here")).toThrow(/expected format/);
    expect(() =>
      parser.parseReply('```json\n{"recheckedFindings":[{"pageId":"f","verdict":"bogus"}]}\n```'),
    ).toThrow(/bad finding verdict/);
  });
});
