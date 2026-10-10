/**
 * versions/refresh: real-git integration (real `git`, no `gh`).
 *
 * (a) rebase onto a moved base, no conflicts → zero changed hunks, state
 *     and anchors preserved, version recorded but not stale.
 * (b) amend changing one hunk → reviewed cleared, note kept+flagged, its
 *     comment outdated, citing cards stale, everything else untouched.
 * (c) new commit adding a file + shifting lines → anchors moved by offsets.
 * (d) file rename → anchors/citations follow the rename.
 * (e) force-push dropping a commit → dropped hunks removed, survivors kept.
 * Old versions stay retrievable via `GET ?version=n`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function initRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-m5-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  return dir;
}

async function openReview(app: Awaited<ReturnType<typeof createApp>>["app"], dir: string, branch: string): Promise<{ id: string; snap: ReviewSnapshot }> {
  const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
  const repoId = (added.json() as { repos: { id: string }[] }).repos[0].id;
  const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch } });
  expect(created.statusCode).toBe(201);
  const snap = created.json() as ReviewSnapshot;
  return { id: snap.review.id, snap };
}

function hunkHashFor(snap: ReviewSnapshot, filePath: string, index = 0): { fileKey: string; hash: string; newStart: number } {
  const f = snap.files.find((x) => x.path === filePath);
  if (!f) throw new Error(`no file ${filePath} in ${snap.files.map((x) => x.path).join(",")}`);
  const h = f.hunks[index];
  if (!h) throw new Error(`no hunk ${index} in ${filePath}`);
  return { fileKey: f.fileKey, hash: h.contentHash, newStart: h.newStart };
}

describe("refresh integration", () => {
  it("(a) rebase with no conflicts → zero changed, state preserved", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change");

    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      const { fileKey, hash } = hunkHashFor(snap, "a.py");

      // Reader state to preserve: reviewed hunk + note + diff comment + card citation.
      await ctx.reviews.mutate(id, (draft) => {
        draft.hunkStates.push({ contentHash: hash, folded: false, reviewed: true, summary: "adds y", note: "looks good" });
        draft.annotations.push({
          id: "ann-1",
          type: "thread",
          anchor: { host: { kind: "diff-line", fileKey, line: 2 }, quotedText: "y = 2", prefix: "x = 1", suffix: "", position: 2, version: 1, hunkHash: hash },
          open: true,
          messages: [{ who: "you", text: "why?" }],
          post: false,
          note: true,
        });
        draft.pages.push({
          id: "p-root",
          kind: "root",
          title: "Guide",
          saved: false,
          cards: [{
            id: "c1", pageId: "p-root", title: "Change", level: "standard", read: false, collapsed: false,
            revision: 1, blocks: [{ type: "paragraph", id: "b1", text: { standard: "adds y" }, citations: [{ target: `h:${fileKey}:${hash}` }] }],
            undoStack: [],
          }],
        });
      });

      // Move main elsewhere, rebase feature (no conflicts).
      await git(dir, "checkout", "main");
      fs.writeFileSync(path.join(dir, "main_only.txt"), "hello\n");
      await git(dir, "add", ".");
      await git(dir, "commit", "-m", "main moves");
      await git(dir, "checkout", "feature");
      await git(dir, "rebase", "main");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ newVersion: true });
      expect(res.json().comparison).toMatchObject({ changedHunks: 0, newHunks: 0, removedHunks: 0 });

      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.version.n).toBe(2);
      expect(after.versionStatus?.stale).toBe(false);
      // State preserved: still reviewed, note unflagged, comment moved not outdated.
      expect(after.hunkStates.find((s) => s.contentHash === hash)?.reviewed).toBe(true);
      const ann = after.annotations.find((a) => a.id === "ann-1")!;
      expect(ann.outdated).not.toBe(true);
      expect(after.pages.flatMap((p) => p.cards).find((c) => c.id === "c1")?.stale).not.toBe(true);

      // Old version stays retrievable.
      const old = await app.inject({ method: "GET", url: `/api/reviews/${id}?version=1`, headers: authed });
      expect(old.statusCode).toBe(200);
      expect((old.json() as ReviewSnapshot).version.n).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("(b) amend changing one hunk → cleared review, flagged note, outdated comment, stale card", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 0\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 9\n");
    await git(dir, "commit", "-am", "change");

    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      // Two hunks? Force two by using two files: keep a.py change + b.py change.
      void snap;
      fs.writeFileSync(path.join(dir, "b.py"), "other = 1\n");
      await git(dir, "add", ".");
      await git(dir, "commit", "--amend", "--no-edit");
      await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });

      const snap2 = ctx.reviews.getSnapshot(id)!;
      const aHash = hunkHashFor(snap2, "a.py").hash;
      const bHash = hunkHashFor(snap2, "b.py").hash;
      const aKey = hunkHashFor(snap2, "a.py").fileKey;

      await ctx.reviews.mutate(id, (draft) => {
        draft.hunkStates.push({ contentHash: aHash, folded: false, reviewed: true, summary: "tweaks z", note: "check z" });
        draft.hunkStates.push({ contentHash: bHash, folded: false, reviewed: true, summary: "adds b" });
        draft.annotations.push({
          id: "ann-a",
          type: "thread",
          anchor: { host: { kind: "diff-line", fileKey: aKey, line: 3 }, quotedText: "z = 9", prefix: "y = 2", suffix: "", position: 3, version: snap2.version.n, hunkHash: aHash },
          open: true,
          messages: [{ who: "you", text: "z?" }],
          post: false,
          note: true,
        });
        draft.pages.push({
          id: "p-root",
          kind: "root",
          title: "Guide",
          saved: false,
          cards: [{
            id: "c-a", pageId: "p-root", title: "A", level: "standard", read: false, collapsed: false,
            revision: 1, blocks: [{ type: "paragraph", id: "b1", text: { standard: "touches a" }, citations: [{ target: `h:${aKey}:${aHash}` }] }],
            undoStack: [],
          }, {
            id: "c-b", pageId: "p-root", title: "B", level: "standard", read: false, collapsed: false,
            revision: 1, blocks: [{ type: "paragraph", id: "b2", text: { standard: "touches b" }, citations: [{ target: `h:${hunkHashFor(snap2, "b.py").fileKey}:${bHash}` }] }],
            undoStack: [],
          }],
        });
      });

      // Amend: change only the a.py hunk.
      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 10\n");
      await git(dir, "commit", "-am", "amend z", "--amend", "--no-edit");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });

      const after = ctx.reviews.getSnapshot(id)!;
      // The changed hunk's carried state: reviewed cleared, note kept+flagged.
      const changedNew = after.versionStatus?.changedNewIds ?? [];
      expect(changedNew.length).toBeGreaterThan(0);
      const carried = after.hunkStates.find((s) => changedNew.includes(`h:${hunkHashFor(after, "a.py").fileKey}:${s.contentHash}`));
      expect(carried?.reviewed).toBe(false);
      expect(carried?.note).toBe("check z");
      expect(carried?.noteStale).toBe(true);
      // Untouched hunk keeps its reviewed flag.
      expect(after.hunkStates.find((s) => s.contentHash === bHash)?.reviewed).toBe(true);
      // Its comment is outdated with the snippet kept.
      const ann = after.annotations.find((a) => a.id === "ann-a")!;
      expect(ann.outdated).toBe(true);
      expect(ann.originalSnippet).toBe("z = 9");
      // Citing card is stale; the other is not.
      expect(after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-a")?.stale).toBe(true);
      expect(after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-b")?.stale).not.toBe(true);
    } finally {
      await app.close();
    }
  });

  it("(c) new commit adding a file + shifting lines → anchors move by offsets", async () => {
    const dir = await initRepo();
    const body = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, "a.py"), body);
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), body + "tail = 1\n");
    await git(dir, "commit", "-am", "tail");

    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      const { fileKey, hash } = hunkHashFor(snap, "a.py");
      await ctx.reviews.mutate(id, (draft) => {
        draft.annotations.push({
          id: "ann-tail",
          type: "thread",
          anchor: { host: { kind: "diff-line", fileKey, line: 21 }, quotedText: "tail = 1", prefix: "line20", suffix: "", position: 21, version: 1, hunkHash: hash },
          open: true,
          messages: [{ who: "you", text: "tail?" }],
          post: false,
          note: true,
        });
      });

      // New commit: prepend 5 lines (shifts tail by +5) + add a new file.
      const shifted = "h1\nh2\nh3\nh4\nh5\n" + body + "tail = 1\n";
      fs.writeFileSync(path.join(dir, "a.py"), shifted);
      fs.writeFileSync(path.join(dir, "new.py"), "fresh = True\n");
      await git(dir, "add", ".");
      await git(dir, "commit", "-m", "shift + new file");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      const ann = after.annotations.find((a) => a.id === "ann-tail")!;
      // Moved, not outdated; line shifted by +5 (or found by quote search).
      expect(ann.outdated).not.toBe(true);
      expect(ann.anchor.host).toMatchObject({ kind: "diff-line" });
      if (ann.anchor.host.kind === "diff-line") {
        expect(ann.anchor.host.line).toBe(26);
      }
      expect(after.files.some((f) => f.path === "new.py")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("(d) file rename → comparison records it, anchors follow", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "old.py"), "x = 1\ny = 2\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "old.py"), "x = 1\ny = 2\nz = 3\n");
    await git(dir, "commit", "-am", "change");

    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      const { fileKey, hash } = hunkHashFor(snap, "old.py");
      await ctx.reviews.mutate(id, (draft) => {
        draft.annotations.push({
          id: "ann-r",
          type: "thread",
          anchor: { host: { kind: "diff-line", fileKey, line: 3 }, quotedText: "z = 3", prefix: "y = 2", suffix: "", position: 3, version: 1, hunkHash: hash },
          open: true,
          messages: [{ who: "you", text: "z?" }],
          post: false,
          note: true,
        });
      });

      await git(dir, "mv", "old.py", "new.py");
      await git(dir, "commit", "-m", "rename");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.versionStatus?.renamedFiles).toMatchObject([{ oldPath: "old.py", newPath: "new.py" }]);
      const ann = after.annotations.find((a) => a.id === "ann-r")!;
      expect(ann.outdated).not.toBe(true);
      if (ann.anchor.host.kind === "diff-line") {
        const f = after.files.find((x) => x.fileKey === ann.anchor.host.fileKey);
        expect(f?.path).toBe("new.py");
      }
    } finally {
      await app.close();
    }
  });

  it("(e) force-push dropping a commit → dropped hunks removed from the diff", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "first");
    fs.writeFileSync(path.join(dir, "b.py"), "drop = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "second (to drop)");

    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const { id } = await openReview(app, dir, "feature");
      const before = ctx.reviews.getSnapshot(id)!;
      expect(before.files.some((f) => f.path === "b.py")).toBe(true);

      // Drop the second commit (force-push equivalent locally).
      await git(dir, "reset", "--hard", "HEAD~1");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.files.some((f) => f.path === "b.py")).toBe(false);
      expect(after.files.some((f) => f.path === "a.py")).toBe(true);
      expect((res.json().comparison as { removedHunks: number }).removedHunks).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
