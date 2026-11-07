/**
 * Stats-shaped trace spans (issue #366): job spans carry every former
 * stats job field, review spans carry the review size buckets, the
 * export scrubs them (hashes for ids/paths, enums verbatim, unknown
 * enums to `other`), and `stats:summary` reports the same summary from
 * a trace export as it used to from a stats export.
 */
import { ensureTracingSetup } from "../src/traces/loader.js";
await ensureTracingSetup();
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { JobQueue } from "../src/jobs/queue.js";
import {
  extractRawReads,
  jobEndAttributes,
  jobStartAttributes,
  reviewAttributes,
  setActiveTracer,
} from "../src/traces/index.js";
import { TraceRecorder } from "../src/traces/recorder.js";
import { spansFile } from "../src/traces/paths.js";

afterEach(() => {
  setActiveTracer(null);
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-traces-stats-"));
}

const T0 = 1_700_000_000_000;

function snapshot(): ReviewSnapshot {
  return {
    review: {
      id: "rv-many", repoId: "repo-1", branch: "b", currentVersion: 1, createdAt: T0,
      versions: [{ n: 1, headSha: "s", mergeBaseSha: "s", baseRef: "b", fetchedAt: T0, idMapping: {} }],
    },
    version: { n: 1, headSha: "s", mergeBaseSha: "s", baseRef: "b", fetchedAt: T0, idMapping: {} },
    files: [
      {
        fileKey: "fk1", path: "src/many.py", category: "source",
        hunks: [
          {
            contentHash: "h1", header: "@@ -1,3 +1,4 @@",
            newStart: 1, newEnd: 4, oldStart: 1, oldEnd: 3, added: 1, removed: 0, lines: [],
          },
        ],
      },
    ],
    ingest: { status: "ready" },
    pages: [{ id: "root", kind: "root", title: "t", cards: [{ id: "c1", pageId: "root", title: "t", collapsed: false, blocks: [], level: "standard", revision: 1, undoStack: [] }] }],
    annotations: [
      {
        type: "thread", id: "t1", anchor: { host: { kind: "block", blockId: "c1#b1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
        open: true, pinned: false, post: true, replies: [{ id: "r1", kind: "comment", who: "you", question: null, blocks: [], level: "standard", revision: 1, undoStack: [] }],
      },
    ],
    hunkStates: [{ contentHash: "h1", summary: "s1" }],
    fileStates: [],
    viewPrefs: { showExistingComments: false, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
    jobs: [], contributions: [], logTail: [], rev: 1,
  } as unknown as ReviewSnapshot;
}

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-1", kind: "ask", model: "claude-opus-test", provider: "claude", effort: "high",
    reviewId: "rv-many", priority: 100, state: "done", sessionId: "sess-1",
    accessMode: "lockdown",
    usage: { inputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 10, outputTokens: 25 },
    attempts: 2, queuedAt: T0 + 1000, startedAt: T0 + 2000, finishedAt: T0 + 9000,
    tools: [
      { name: "mcp__unvibe__get_code", detail: JSON.stringify({ path: "src/many.py", startLine: 10, endLine: 20, sha: "abc123" }) },
      { name: "Bash", detail: "git log" },
    ],
    turnRecords: [
      {
        label: "repair", output: "ok", outputOriginalLength: 2,
        tools: [{ name: "Read", detail: "Read src/many.py:1-4" }],
        startedAt: T0 + 2000, finishedAt: T0 + 9000,
      },
    ],
    ...over,
  } as Job;
}

/** Scrubbed attribute map of the single exported span. */
function exportedAttrs(rec: TraceRecorder): Map<string, string | number> {
  const spans = rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans;
  expect(spans).toHaveLength(1);
  const m = new Map<string, string | number>();
  for (const a of spans[0]!.attributes ?? []) {
    if (typeof a.value.intValue === "string") m.set(a.key, Number(a.value.intValue));
    else if (typeof a.value.doubleValue === "number") m.set(a.key, a.value.doubleValue);
    else if (typeof a.value.stringValue === "string") m.set(a.key, a.value.stringValue);
  }
  return m;
}

describe("stats-shaped trace spans (#366)", () => {
  it("job spans carry every former stats field, scrubbed on export", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      const snap = snapshot();
      const j = job();
      // Raw recording keeps review ids and paths verbatim.
      rec.startSpan("job ask", { ...jobStartAttributes(j, 1), session: "sess-1" }).end(jobEndAttributes(j, snap));
      const raw = fs.readFileSync(spansFile(dir), "utf8");
      expect(raw).toContain("rv-many");
      expect(raw).toContain("src/many.py");
      const m = exportedAttrs(rec);
      // Enums verbatim; ids hashed; tokens numeric.
      expect(m.get("job.kind")).toBe("ask");
      expect(m.get("job.state")).toBe("done");
      expect(m.get("job.provider")).toBe("claude");
      expect(m.get("job.model")).toBe("claude-opus-test");
      expect(m.get("job.effort")).toBe("high");
      expect(m.get("job.access")).toBe("lockdown");
      expect(m.get("job.id")).toMatch(/^[0-9a-f]{16}$/);
      expect(m.get("job.review")).toMatch(/^[0-9a-f]{16}$/);
      expect(m.get("job.session")).toMatch(/^[0-9a-f]{16}$/);
      expect(m.get("job.tokens.input")).toBe(100);
      expect(m.get("job.tokens.cached_read")).toBe(40);
      expect(m.get("job.tokens.cached_write")).toBe(10);
      expect(m.get("job.tokens.output")).toBe(25);
      // Tool counts by sanitized name.
      expect(m.get("job.tool.mcp__unvibe__get_code")).toBe(1);
      expect(m.get("job.tool.Bash")).toBe(1);
      expect(m.get("job.tool.Read")).toBe(1);
      // Reads: hashed file, line range, diff membership.
      expect(m.get("job.read.0.file")).toMatch(/^[0-9a-f]{16}$/);
      expect(m.get("job.read.0.lines")).toBe(11);
      expect(m.get("job.read.0.inside")).toBe("true");
      expect(m.get("job.read.1.file")).toMatch(/^[0-9a-f]{16}$/);
      expect(m.get("job.read.1.lines")).toBe(4);
      expect(m.get("job.read.1.inside")).toBe("true");
      // Turns, repairs, attempts, timings; no failure on success.
      expect(m.get("job.turns")).toBe(1);
      expect(m.get("job.repairs")).toBe(1);
      expect(m.get("job.attempts")).toBe(2);
      expect(m.get("job.queued_ms")).toBe(1000);
      expect(m.get("job.duration_ms")).toBe(7000);
      expect(m.has("job.failure")).toBe(false);
      const text = JSON.stringify(rec.exportOtlp());
      expect(text).not.toContain("rv-many");
      expect(text).not.toContain("src/many.py");
      expect(text).not.toContain("sess-1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failed jobs record the failure class; hostile values fail closed", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      const j = job({
        state: "error", error: "boom in the night",
        model: "EVIL MODEL/with spaces", provider: "evilcorp", effort: "a b",
        tools: [{ name: "x y/z" }],
      });
      rec.startSpan("job ask", jobStartAttributes(j, 1)).end(jobEndAttributes(j, snapshot()));
      const m = exportedAttrs(rec);
      expect(m.get("job.failure")).toBe("other");
      expect(m.get("job.model")).toBe("other");
      expect(m.get("job.provider")).toBe("other");
      expect(m.get("job.effort")).toBe("other");
      expect(m.get("job.tool.other")).toBe(1);
      const text = JSON.stringify(rec.exportOtlp());
      expect(text).not.toContain("EVIL MODEL");
      expect(text).not.toContain("evilcorp");
      expect(text).not.toContain("x y/z");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("review spans carry the size buckets, scrubbed on export", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      const snap = snapshot();
      rec.startSpan("refresh", { review: snap.review.id, ...reviewAttributes(snap) }).end();
      const raw = fs.readFileSync(spansFile(dir), "utf8");
      expect(raw).toContain("rv-many");
      const m = exportedAttrs(rec);
      expect(m.get("review.kind")).toBe("change");
      expect(m.get("review.files")).toBe(1);
      expect(m.get("review.hunks")).toBe(1);
      expect(m.get("review.skipped")).toBe(0);
      expect(m.get("review.added")).toBe(1);
      expect(m.get("review.removed")).toBe(0);
      expect(m.get("review.pages")).toBe(1);
      expect(m.get("review.cards")).toBe(1);
      expect(m.get("review.threads")).toBe(1);
      expect(m.get("review.replies")).toBe(1);
      expect(m.get("review.outbox")).toBe(1);
      expect(m.get("review.versions")).toBe(1);
      expect(m.get("review")).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(rec.exportOtlp())).not.toContain("rv-many");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads resolve hunk ids and token-form ranges like the old exporter", () => {
    const snap = snapshot();
    const reads = extractRawReads(
      job(),
      new Set(snap.files!.map((f) => f.path)),
      new Map([["h1", { path: "src/many.py", lines: 4 }]]),
    );
    // get_code JSON names the range; the bare `git log` detail names no
    // file (no path-like token), so only two reads land.
    expect(reads).toHaveLength(2);
    expect(reads[0]).toEqual({ file: "src/many.py", lines: 11, insideDiff: true });
    expect(reads[1]).toEqual({ file: "src/many.py", lines: 4, insideDiff: true });
  });

  it("the queue records job spans with stats fields while on, silent while off", async () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      setActiveTracer(rec);
      const quiet = new JobQueue();
      quiet.enqueue({ reviewId: "rv-quiet", kind: "reader", provider: "pi", model: "m", effort: "", priority: 1, run: () => Promise.resolve() });
      await quiet.drain();
      expect(rec.status().spans).toBe(0);
      rec.setEnabled(true);
      const queue = new JobQueue({
        getReviewSnapshot: (id) => (id === "rv-seam" ? snapshot() : undefined),
      });
      queue.enqueue({
        reviewId: "rv-seam", kind: "ask", provider: "claude", model: "claude-opus-test", effort: "",
        priority: 1,
        run: (ctx) => {
          ctx.reportUsage({ inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 5 });
          ctx.reportTool("Read", "Read src/many.py:1-4");
          ctx.beginTurn("first");
          ctx.endTurn();
          return Promise.resolve();
        },
      });
      await queue.drain();
      const spans = rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans;
      const names = spans.map((s) => s.name);
      expect(names).toContain("job ask");
      const ended = spans.find((s) => s.name === "job ask")!;
      const m = new Map(ended.attributes!.map((a) => [a.key, a.value.stringValue ?? a.value.intValue]));
      expect(m.get("job.kind")).toBe("ask");
      expect(m.get("job.state")).toBe("done");
      expect(m.get("job.provider")).toBe("claude");
      expect(m.get("job.tokens.input")).toBe("10");
      expect(m.get("job.tokens.output")).toBe("5");
      // The call lands on the flat list and on the open turn (the old
      // exporter counted both too).
      expect(m.get("job.tool.Read")).toBe("2");
      expect(m.get("job.read.0.lines")).toBe("4");
      expect(m.get("job.read.0.inside")).toBe("true");
      // The pre-turn tool call opens an implicit turn; begin/end adds the named one.
      expect(m.get("job.turns")).toBe("2");
      expect(m.get("job.queued_ms")).not.toBeUndefined();
      expect(m.get("job.duration_ms")).not.toBeUndefined();
      expect(JSON.stringify(ended)).not.toContain("rv-seam");
      expect(JSON.stringify(ended)).not.toContain("src/many.py");
    } finally {
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forged stats keys drop on export, even numeric ones", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      const accepted = rec.ingestBrowser({
        spans: [{
          kind: "fetch", name: "job ask", traceId: "a".repeat(32), spanId: "b".repeat(16),
          attributes: {
            "job.kind": "ask",
            "job.evil-key": "CANARYX",
            "job.tool.evil key": 3,
            "job.read.9.exfiltrate": "CANARYX",
          },
        }],
      });
      expect(accepted).toEqual({ accepted: 1, rejected: 0 });
      const text = JSON.stringify(rec.exportOtlp());
      expect(text).toContain("job ask");
      expect(text).not.toContain("evil-key");
      expect(text).not.toContain("evil key");
      expect(text).not.toContain("exfiltrate");
      expect(text).not.toContain("CANARYX");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stats:summary reports the same summary from the trace export", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixture = path.join(here, "fixtures", "traces-stats-export.json");
    const script = path.join(here, "..", "..", "..", "scripts", "stats-summary.mjs");
    const out = execFileSync("node", [script, fixture], { encoding: "utf8" });
    const lines = out.trim().split("\n");
    // Same report the old exporter produced: counts, tokens, kinds,
    // providers, re-reads, per-kind duration/output, failures, repairs.
    expect(lines).toContain("Reviews: 2  Jobs: 3");
    expect(lines).toContain("Tokens: input 800, cached read 50, cached write 10, output 205");
    expect(lines).toContain("  ask: 2");
    expect(lines).toContain("  reader: 1");
    expect(lines).toContain("  claude: 2");
    expect(lines).toContain("  pi: 1");
    expect(lines).toContain("Reads: 4 (2 outside the diff)");
    expect(lines).toContain("Re-read rate: 2/2 files read more than once (100.0%)");
    expect(lines).toContain("Reads outside the diff per ask: 1.00 (2/2 asks)");
    expect(lines).toContain("  ask: n=2, duration 6000 ms, output 43");
    expect(lines).toContain("  reader: n=1, duration 7000 ms, output 120");
    expect(lines).toContain("Failure rate: 33.3% (1/3)");
    expect(lines).toContain("Repair rate: 33.3% (1 jobs with repair turns)");
    expect(lines).toContain("  other: 1");
  });
});
