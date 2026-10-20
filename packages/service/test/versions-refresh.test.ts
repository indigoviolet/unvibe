/**
 * versions/refresh: real-git integration (real `git`, no `gh`).
 *
 * (a) rebase onto a moved base, no conflicts → zero changed hunks, state
 *     and anchors preserved, version recorded but not stale.
 * (b) amend changing one hunk → reviewed cleared, its
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
  const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;
  const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch } });
  expect([201, 202]).toContain(created.statusCode);
  const loading = created.json() as ReviewSnapshot;
  const id = loading.review.id;
  // #92: async open — poll until the background ingest lands.
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (got.statusCode === 200) {
      const snap = got.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) {
        return { id, snap };
      }
      if ((snap.ingest?.status ?? "") === "failed") throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for ingest");
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

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      const { fileKey, hash } = hunkHashFor(snap, "a.py");

      // Reader state to preserve: reviewed hunk + diff comment + card citation.
      await ctx.reviews.mutate(id, (draft) => {
        draft.hunkStates.push({ contentHash: hash, folded: false, reviewed: true, summary: "adds y" });
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
      // State preserved: still reviewed, comment moved not outdated.
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

  it("(b) amend changing one hunk → cleared review, outdated comment, stale card", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 0\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 9\n");
    await git(dir, "commit", "-am", "change");

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
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
        draft.hunkStates.push({ contentHash: aHash, folded: false, reviewed: true, summary: "tweaks z" });
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
      // The changed hunk's carried state: reviewed cleared, summary kept
      // and flagged for regeneration.
      const changedNew = after.versionStatus?.changedNewIds ?? [];
      expect(changedNew.length).toBeGreaterThan(0);
      const carried = after.hunkStates.find((s) => changedNew.includes(`h:${hunkHashFor(after, "a.py").fileKey}:${s.contentHash}`));
      expect(carried?.reviewed).toBe(false);
      expect(carried?.summary).toBe("tweaks z");
      expect(carried?.needsSummary).toBe(true);
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

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
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

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
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

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
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

  it("(f) demo refresh is a no-op (no remote to fetch, never a 502)", async () => {
    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const dir = await initRepo();
      try {
        fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
        await git(dir, "add", ".");
        await git(dir, "commit", "-m", "base");
        // #179: opening "main" itself is now an empty diff, so open a
        // branch with a change and mark that review as the demo.
        await git(dir, "checkout", "-b", "feature");
        fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
        await git(dir, "commit", "-am", "change");
        const { id } = await openReview(app, dir, "feature");
        // Demo reviews carry DB rows (for jobs joins) but no remote: mark
        // this one demo and refresh must short-circuit before git.
        await ctx.reviews.mutate(id, (draft) => {
          draft.review.repoId = "demo";
        });
        const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ newVersion: false });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      await app.close();
    }
  });

  it("(g) pins remap by content; empty-text pins flag needsRepining", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\nw = 4\n");
    await git(dir, "commit", "-am", "tail");

    const { app, ctx } = await createApp("tok", {runner: real, autoPipeline: false});
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push(
          { path: "a.py", start: 2, end: 3, sha: snap.version.headSha, text: "y = 2\nz = 3" },
          { path: "a.py", start: 1, end: 1, sha: snap.version.headSha, text: "" },
        );
      });

      // New commit: prepend two lines, shifting the pinned block to 4-5.
      fs.writeFileSync(path.join(dir, "a.py"), "h1\nh2\nx = 1\ny = 2\nz = 3\nw = 4\n");
      await git(dir, "commit", "-am", "shift");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      // Text pin: found again by content at its shifted location.
      const textPin = after.pinnedCode!.find((p) => p.text === "y = 2\nz = 3")!;
      expect(textPin.needsRepining).not.toBe(true);
      expect(textPin.remappedStart).toBe(4);
      expect(textPin.remappedEnd).toBe(5);
      expect(textPin.remappedSha).toBe(after.version.headSha);
      // Empty-text pin: nothing to match, so flagged — never remapped to
      // a spurious blank line.
      const emptyPin = after.pinnedCode!.find((p) => p.text === "")!;
      expect(emptyPin.needsRepining).toBe(true);
      expect(emptyPin.remappedSha).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("(h) #52 pin in untouched file unchanged → kept, not flagged", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "b.py"), "p = 1\nq = 2\nr = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push({
          path: "b.py",
          start: 2,
          end: 2,
          sha: snap.version.headSha,
          text: "q = 2",
        });
      });

      // New commit touches only a.py; b.py not in the new diff.
      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "change a again");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      const pin = after.pinnedCode!.find((p) => p.path === "b.py")!;
      expect(pin.needsRepining).not.toBe(true);
      expect(pin.needsRepining).toBe(false);
      expect(pin.remappedSha).toBe(after.version.headSha);
      expect(pin.remappedStart).toBe(2);
      expect(pin.remappedEnd).toBe(2);
      // Excerpt text stays consistent with the range.
      expect(pin.text).toBe("q = 2");
    } finally {
      await app.close();
    }
  });

  it("(i) #52 pin in untouched file moved by upstream base change → remapped", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "b.py"), "line1\nline2\nline3\nline4\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push({
          path: "b.py",
          start: 3,
          end: 3,
          sha: snap.version.headSha,
          text: "line3",
        });
      });

      // Upstream moves: prepend two lines to b.py on main, then rebase.
      // After rebase b.py at the new head has the shift, but the PR diff
      // (base..head) still touches only a.py.
      await git(dir, "checkout", "main");
      fs.writeFileSync(path.join(dir, "b.py"), "top1\ntop2\nline1\nline2\nline3\nline4\n");
      await git(dir, "commit", "-am", "upstream b");
      await git(dir, "checkout", "feature");
      await git(dir, "rebase", "main");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.files.some((f) => f.path === "b.py")).toBe(false);
      const pin = after.pinnedCode!.find((p) => p.path === "b.py")!;
      expect(pin.needsRepining).not.toBe(true);
      expect(pin.remappedStart).toBe(5);
      expect(pin.remappedEnd).toBe(5);
      expect(pin.remappedSha).toBe(after.version.headSha);
      expect(pin.text).toBe("line3");
    } finally {
      await app.close();
    }
  });

  it("(j) #52 pin text gone / file deleted upstream → flagged, no throw", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "b.py"), "keep = 1\ngone = 2\ntail = 3\n");
    fs.writeFileSync(path.join(dir, "c.py"), "c = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push(
          { path: "b.py", start: 2, end: 2, sha: snap.version.headSha, text: "gone = 2" },
          { path: "c.py", start: 1, end: 1, sha: snap.version.headSha, text: "c = 1" },
          { path: "missing.py", start: 1, end: 1, sha: snap.version.headSha, text: "nope" },
        );
      });

      // Upstream: delete the pinned line in b.py and delete c.py outright,
      // then rebase. Neither file enters the PR diff (both heads equal the
      // new base there), so both pins go through the untouched fallback.
      await git(dir, "checkout", "main");
      fs.writeFileSync(path.join(dir, "b.py"), "keep = 1\ntail = 3\n");
      await git(dir, "rm", "-q", "c.py");
      await git(dir, "commit", "-am", "upstream removes");
      await git(dir, "checkout", "feature");
      await git(dir, "rebase", "main");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.pinnedCode!.find((p) => p.path === "b.py")!.needsRepining).toBe(true);
      expect(after.pinnedCode!.find((p) => p.path === "c.py")!.needsRepining).toBe(true);
      expect(after.pinnedCode!.find((p) => p.path === "missing.py")!.needsRepining).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("(k) #52 pin follows a PR rename → remapped, not flagged", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "old.py"), "x = 1\ny = 2\nz = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "old.py"), "x = 1\ny = 2\nz = 3\nw = 4\n");
    await git(dir, "commit", "-am", "change");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push({
          path: "old.py",
          start: 2,
          end: 3,
          sha: snap.version.headSha,
          text: "y = 2\nz = 3",
        });
      });

      await git(dir, "mv", "old.py", "new.py");
      await git(dir, "commit", "-m", "rename");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.versionStatus?.renamedFiles).toMatchObject([{ oldPath: "old.py", newPath: "new.py" }]);
      const pin = after.pinnedCode!.find((p) => p.text === "y = 2\nz = 3")!;
      expect(pin.needsRepining).not.toBe(true);
      expect(pin.remappedSha).toBe(after.version.headSha);
    } finally {
      await app.close();
    }
  });

  it("(l) #52 binary / very large / unreadable pins flag without throwing", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    // Binary blob (NUL) — git treats it as binary.
    fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00]));
    // Very large file (>1 MiB guard in refresh): pin cannot be remapped by scan.
    fs.writeFileSync(path.join(dir, "big.txt"), `${"bigline\n".repeat(140000)}`);
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push(
          { path: "bin.dat", start: 1, end: 1, sha: snap.version.headSha, text: "hello" },
          { path: "big.txt", start: 1, end: 1, sha: snap.version.headSha, text: "bigline" },
          { path: "../escape.py", start: 1, end: 1, sha: snap.version.headSha, text: "x" },
        );
      });

      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "change a again");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.pinnedCode!.find((p) => p.path === "bin.dat")!.needsRepining).toBe(true);
      expect(after.pinnedCode!.find((p) => p.path === "big.txt")!.needsRepining).toBe(true);
      expect(after.pinnedCode!.find((p) => p.path === "../escape.py")!.needsRepining).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("(n) #112 code citation in untouched file unchanged → new ID at new head, not stale", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        draft.pages.push({
          id: "p-root", kind: "root", title: "Guide", saved: false,
          cards: [{
            id: "c-code", pageId: "p-root", title: "Helper", level: "standard", read: false, collapsed: false,
            revision: 1, blocks: [{ type: "paragraph", id: "b1", text: { standard: "uses beta" }, citations: [{ target: `code:helper.py:2@${snap.version.headSha}` }] }],
            undoStack: [],
          }],
        });
      });
      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "change a again");
      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.files.some((f) => f.path === "helper.py")).toBe(false);
      const card = after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-code")!;
      expect(card.stale).not.toBe(true);
      const cit = card.blocks[0].type === "paragraph" ? card.blocks[0].citations[0] : undefined;
      expect(cit).toEqual({ target: `code:helper.py:2@${after.version.headSha}` });
    } finally {
      await app.close();
    }
  });

  it("(o) #112 code citation in untouched file moved upstream → remapped lines", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        draft.pages.push({
          id: "p-root", kind: "root", title: "Guide", saved: false,
          cards: [{
            id: "c-code", pageId: "p-root", title: "Helper", level: "standard", read: false, collapsed: false,
            revision: 1, blocks: [{ type: "paragraph", id: "b1", text: { standard: "uses beta" }, citations: [{ target: `code:helper.py:2@${snap.version.headSha}` }] }],
            undoStack: [],
          }],
        });
      });
      await git(dir, "checkout", "main");
      fs.writeFileSync(path.join(dir, "helper.py"), "top1\ntop2\nalpha = 1\nbeta = 2\ngamma = 3\n");
      await git(dir, "commit", "-am", "upstream helper");
      await git(dir, "checkout", "feature");
      await git(dir, "rebase", "main");
      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.files.some((f) => f.path === "helper.py")).toBe(false);
      const card = after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-code")!;
      expect(card.stale).not.toBe(true);
      const cit = card.blocks[0].type === "paragraph" ? card.blocks[0].citations[0] : undefined;
      expect(cit).toEqual({ target: `code:helper.py:4@${after.version.headSha}` });
      // The remapped lines really hold the cited text at the new head.
      const shown = await real.run("git", { args: ["show", `${after.version.headSha}:helper.py`], cwd: dir });
      expect(shown.stdout.split("\n")[3]).toBe("beta = 2");
    } finally {
      await app.close();
    }
  });

  it("(p) #112 code citation text gone / file deleted upstream → unverified + stale, no throw", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    fs.writeFileSync(path.join(dir, "gone.py"), "gone = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      await ctx.reviews.mutate(id, (draft) => {
        draft.pages.push({
          id: "p-root", kind: "root", title: "Guide", saved: false,
          cards: [
            {
              id: "c-gone-text", pageId: "p-root", title: "GoneText", level: "standard", read: false, collapsed: false,
              revision: 1, blocks: [{ type: "paragraph", id: "b1", text: { standard: "uses beta" }, citations: [{ target: `code:helper.py:2@${snap.version.headSha}` }] }],
              undoStack: [],
            },
            {
              id: "c-gone-file", pageId: "p-root", title: "GoneFile", level: "standard", read: false, collapsed: false,
              revision: 1, blocks: [{ type: "paragraph", id: "b2", text: { standard: "uses gone" }, citations: [{ target: `code:gone.py:1@${snap.version.headSha}` }] }],
              undoStack: [],
            },
          ],
        });
      });
      await git(dir, "checkout", "main");
      fs.writeFileSync(path.join(dir, "helper.py"), "alpha = 1\ngamma = 3\n");
      await git(dir, "rm", "-q", "gone.py");
      await git(dir, "commit", "-am", "upstream removes");
      await git(dir, "checkout", "feature");
      await git(dir, "rebase", "main");
      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      for (const cid of ["c-gone-text", "c-gone-file"]) {
        const card = after.pages.flatMap((p) => p.cards).find((c) => c.id === cid)!;
        expect(card.stale, cid).toBe(true);
        const cit = card.blocks[0].type === "paragraph" ? card.blocks[0].citations[0] : undefined;
        expect(cit?.unverified, cid).toBe(true);
        expect(cit?.target, cid).toContain(`@${snap.version.headSha}`);
      }
    } finally {
      await app.close();
    }
  });

  it("(m) #52 remap keeps excerpt text consistent with the new range", async () => {
    const dir = await initRepo();
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(dir, "b.py"), "p = 1\nq = 2\nr = 3\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change a");

    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const { id, snap } = await openReview(app, dir, "feature");
      // Whitespace-stripped excerpt: matches by the loop's insensitive
      // equality, but the stored text must end up as the exact file content.
      await ctx.reviews.mutate(id, (draft) => {
        (draft.pinnedCode ??= []).push({
          path: "b.py",
          start: 2,
          end: 2,
          sha: snap.version.headSha,
          text: "q=2",
        });
      });

      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "change a again");

      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(res.json()).toMatchObject({ newVersion: true });
      const after = ctx.reviews.getSnapshot(id)!;
      const pin = after.pinnedCode!.find((p) => p.path === "b.py")!;
      expect(pin.needsRepining).not.toBe(true);
      expect(pin.text).toBe("q = 2");
      const { RealCommandRunner: RCR } = await import("../src/exec/index.js");
      const runner = new RCR();
      const shown = await runner.run("git", { args: ["show", `${after.version.headSha}:b.py`], cwd: dir });
      const fileLines = shown.stdout.split("\n");
      const atRemapped = fileLines
        .slice((pin.remappedStart ?? pin.start) - 1, (pin.remappedEnd ?? pin.end))
        .join("\n");
      expect(atRemapped).toBe(pin.text);
    } finally {
      await app.close();
    }
  });
});
