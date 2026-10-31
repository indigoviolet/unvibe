/**
 * #323 leak test: seed a review full of recognisable canaries in every
 * text field, then assert none of them — nor any 6+ character substring
 * — reaches the export, through the builder, the HTTP route and the
 * CLI file writer. Also: no ISO dates, no epoch timestamps, no 40-char
 * hex, salt differs per export, and the data dir is untouched.
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobStore } from "../src/jobs/store.js";
import { buildStatsExport, buildStatsExportFromDb } from "../src/stats/export.js";
import { runStatsExport } from "../src/cli/stats-export.js";
import { createApp } from "../src/server.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const T0 = 1_700_000_000_000;
const CANARIES = [
  "CANARYTITLEZEBRA",
  "CANARYCARDTEXTX",
  "CANARYQUESTIONX",
  "CANARYDRAFTXXXX",
  "CANARYPATHFILE",
  "CANARYBRANCHX",
  "CANARYOWNERX",
  "CANARYREPOX",
  "CANARYLOCALPATH",
  "CANARYERRORMSGX",
  "CANARYSETTINGX",
  "CANARYPROMPTX",
  "CANARYREPLYX",
  "CANARYSESSIONX",
  "987654",
  SHA,
];

function seededSnapshot(): ReviewSnapshot {
  return {
    review: {
      id: "rv-CANARYREVIEWID",
      repoId: "repo-CANARYREPOX",
      branch: "CANARYBRANCHX",
      prNumber: 987654,
      versions: [{ n: 1, headSha: SHA, mergeBaseSha: SHA, baseRef: "CANARYBRANCHX", fetchedAt: T0, idMapping: {} }],
      currentVersion: 1,
      createdAt: T0,
    },
    version: { n: 1, headSha: SHA, mergeBaseSha: SHA, baseRef: "CANARYBRANCHX", fetchedAt: T0, idMapping: {} },
    files: [
      {
        fileKey: "fk1",
        path: "canary/CANARYPATHFILE.py",
        category: "source",
        hunks: [
          {
            contentHash: "hcanary",
            header: "@@ CANARYTITLEZEBRA @@",
            newStart: 1, newEnd: 3, oldStart: 1, oldEnd: 1, added: 2, removed: 0,
            lines: [{ kind: "add", newLine: 1, text: "CANARYCARDTEXTX" }],
          },
        ],
      },
    ],
    ingest: { status: "ready" },
    pages: [
      {
        id: "root", kind: "root", title: "CANARYTITLEZEBRA",
        cards: [
          {
            id: "c1", pageId: "root", title: "CANARYTITLEZEBRA", collapsed: false,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "CANARYCARDTEXTX" }, citations: [] }],
            level: "standard", revision: 1, undoStack: [],
          },
        ],
      },
    ],
    annotations: [
      {
        type: "thread", id: "t1",
        anchor: { host: { kind: "block", blockId: "c1#b1" }, quotedText: "CANARYCARDTEXTX", prefix: "", suffix: "", position: 0, version: 1 },
        open: true, pinned: false, post: true, draft: "CANARYDRAFTXXXX", sessionId: "sess-CANARYSESSIONX",
        replies: [
          {
            id: "r1", kind: "comment", who: "you", question: null,
            blocks: [{ type: "paragraph", id: "b2", text: { standard: "CANARYCARDTEXTX" }, citations: [] }],
            level: "standard", revision: 1, undoStack: [],
          },
          {
            id: "ans_1", kind: "ask", who: "agent", question: "CANARYQUESTIONX",
            blocks: [{ type: "paragraph", id: "b3", text: { standard: "CANARYCARDTEXTX" }, citations: [] }],
            level: "standard", revision: 1, undoStack: [],
          },
        ],
      },
    ],
    hunkStates: [], fileStates: [],
    viewPrefs: { showExistingComments: false, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
    jobs: [], contributions: [], logTail: [], rev: 1,
  } as unknown as ReviewSnapshot;
}

function seededJob(): Job {
  return {
    id: "job-CANARYJOBID",
    kind: "ask",
    model: "claude-opus-test",
    provider: "claude",
    effort: "high",
    reviewId: "rv-CANARYREVIEWID",
    priority: 100,
    state: "error",
    sessionId: "sess-CANARYSESSIONX",
    promptSnapshot: "CANARYPROMPTX",
    replySnapshot: "CANARYREPLYX",
    error: "CANARYERRORMSGX blew up in CANARYPATHFILE",
    usage: { inputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 10, outputTokens: 25 },
    attempts: 2,
    queuedAt: T0 + 1000, startedAt: T0 + 2000, finishedAt: T0 + 9000,
    tools: [{ name: "Read", detail: "Read canary/CANARYPATHFILE.py:10-20" }],
    turnRecords: [
      {
        label: "repair", output: "CANARYREPLYX", outputOriginalLength: 12,
        tools: [{ name: "Read", detail: "canary/CANARYPATHFILE.py" }],
        startedAt: T0 + 2000, finishedAt: T0 + 9000,
      },
    ],
  };
}

function seedDb(db: ReturnType<typeof openDatabase>): void {
  migrate(db);
  db.prepare("INSERT INTO repos (id, owner, name, local_path, last_opened, managed) VALUES (?, ?, ?, ?, ?, 0)")
    .run("repo-CANARYREPOX", "CANARYOWNERX", "CANARYREPOX", "/CANARYLOCALPATH/x", T0);
  db.prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, 1, ?, '{}')")
    .run("rv-CANARYREVIEWID", "repo-CANARYREPOX", "CANARYBRANCHX", 987654, T0);
  const snap = seededSnapshot();
  db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, 1, ?, ?)")
    .run(snap.review.id, JSON.stringify(snap), T0);
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO settings (key, value) VALUES ('canary', 'CANARYSETTINGX')").run();
  new JobStore(db).save(seededJob());
}

function assertLeakClean(text: string): void {
  for (const canary of CANARIES) {
    expect(text, `canary leaked: ${canary}`).not.toContain(canary);
    for (let i = 0; i + 6 <= canary.length; i++) {
      const sub = canary.slice(i, i + 6);
      expect(text, `canary substring leaked: ${sub}`).not.toContain(sub);
    }
  }
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // ISO dates
  expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i); // SHAs
  const walk = (v: unknown): void => {
    if (typeof v === "number") expect(Math.abs(v)).toBeLessThan(1e12); // no epoch ms/s
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(JSON.parse(text));
}

describe("stats export (#323)", () => {
  it("builder output is leak-clean and keeps only enums/hashes/numbers", () => {
    const db = openDatabase(":memory:");
    seedDb(db);
    const out = buildStatsExportFromDb(db);
    const text = JSON.stringify(out);
    assertLeakClean(text);
    expect(out.schemaVersion).toBe(1);
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0]).toMatchObject({ kind: "change", files: 1, hunks: 1, threads: 1, replies: 2, outboxThreads: 1 });
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0]).toMatchObject({ kind: "ask", state: "error", provider: "claude", model: "claude-opus-test", failure: "other", repairTurns: 1, attempts: 2, offsetMs: 2000, durationMs: 7000, queuedMs: 1000 });
    expect(out.jobs[0]!.reads.length).toBeGreaterThan(0);
    expect(out.jobs[0]!.reads[0]).toMatchObject({ lines: 11, insideDiff: true });
    // Every string is a salted hash (16 hex), an enum/token, or "".
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(out);
    for (const s of strings) {
      expect(/^[0-9a-f]{16}$/.test(s) || s === "" || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s), `unexpected string: ${s}`).toBe(true);
    }
    db.close();
  });

  it("hostile free-form model/tool values fail closed to other", () => {
    const out = buildStatsExport([], [{ ...seededJob(), model: "CANARY MODEL/with spaces", tools: [{ name: "x y/z" }] }]);
    expect(out.jobs[0]!.model).toBe("other");
    assertLeakClean(JSON.stringify(out));
  });

  it("salt differs per export and the data dir is never written", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-stats-"));
    try {
      const db = openDatabase(path.join(dir, "unvibe.db"));
      seedDb(db);
      db.close();
      const hashDir = (): string => {
        const h = crypto.createHash("sha256");
        for (const f of fs.readdirSync(dir).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
        return h.digest("hex");
      };
      const before = hashDir();
      const outFile = path.join(dir, "out.json");
      const a = runStatsExport({ dataDir: dir, out: outFile });
      expect(a.reviews).toBe(1);
      const first = fs.readFileSync(outFile, "utf8");
      assertLeakClean(first);
      const second = runStatsExport({ dataDir: dir, out: outFile });
      expect(second.jobs).toBe(1);
      const secondText = fs.readFileSync(outFile, "utf8");
      // Same review, different salt ⇒ different hashes across exports.
      expect(JSON.parse(secondText).reviews[0].id).not.toBe(JSON.parse(first).reviews[0].id);
      expect(hashDir()).not.toBe(before); // only out.json was added
      fs.rmSync(outFile);
      expect(hashDir()).toBe(before); // DB bytes untouched: read-only, salt never persisted
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/stats/export is token-gated and leak-clean", async () => {
    const db = openDatabase(":memory:");
    seedDb(db);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-stats-data-"));
    const { app } = await createApp("tok-stats-test", { db, dataDir });
    try {
      const anon = await app.inject({ method: "GET", url: "/api/stats/export" });
      expect(anon.statusCode).toBe(401);
      const res = await app.inject({
        method: "GET", url: "/api/stats/export",
        headers: { authorization: `Bearer ${"tok"}-stats-test` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toContain("unvibe-stats.json");
      assertLeakClean(res.body);
      expect((res.json() as { totals: { reviews: number } }).totals.reviews).toBe(1);
    } finally {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
