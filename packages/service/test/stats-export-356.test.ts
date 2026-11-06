/**
 * Stats-export gaps (#356): conversation turns of every flavor stay in the
 * export with the same fields, `get_code`/`get_hunk` details record line
 * ranges, and each review counts its cap-skipped hunk summaries.
 */
import { describe, expect, it } from "vitest";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { HUNK_PASS_FANOUT_LIMIT } from "@unvibe/shared";
import { buildStatsExport } from "../src/stats/export.js";

const T0 = 1_700_000_000_000;

function snapshotWith(hunks: number, summarized: number): ReviewSnapshot {
  const files = [
    {
      fileKey: "fk1",
      path: "src/many.py",
      category: "source",
      hunks: Array.from({ length: hunks }, (_, i) => ({
        contentHash: `h${i}`,
        header: `@@ -${i + 1},3 +${i + 1},4 @@`,
        newStart: i + 1, newEnd: i + 4, oldStart: i + 1, oldEnd: i + 3, added: 1, removed: 0,
        lines: [],
      })),
    },
  ];
  return {
    review: {
      id: "rv-many", repoId: "repo-1", branch: "b", currentVersion: 1, createdAt: T0,
      versions: [{ n: 1, headSha: "s", mergeBaseSha: "s", baseRef: "b", fetchedAt: T0, idMapping: {} }],
    },
    version: { n: 1, headSha: "s", mergeBaseSha: "s", baseRef: "b", fetchedAt: T0, idMapping: {} },
    files,
    ingest: { status: "ready" },
    pages: [], annotations: [],
    hunkStates: Array.from({ length: summarized }, (_, i) => ({ contentHash: `h${i}`, summary: `s${i}` })),
    fileStates: [],
    viewPrefs: { showExistingComments: false, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
    jobs: [], contributions: [], logTail: [], rev: 1,
  } as unknown as ReviewSnapshot;
}

function jobWith(over: Partial<Job>): Job {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    kind: "ask",
    model: "m",
    provider: "pi",
    effort: "",
    priority: 1,
    state: "done",
    queuedAt: T0, startedAt: T0 + 10, finishedAt: T0 + 20,
    ...over,
  } as Job;
}

describe("stats export gaps (#356)", () => {
  it("keeps every conversation job kind with the same fields", () => {
    const snap = snapshotWith(1, 1);
    const jobs = (["ask", "depth", "examples", "diagram", "persona", "reader", "critic", "go-deeper"] as const).map(
      (kind, i) =>
        jobWith({ id: `job-${kind}`, kind, reviewId: "rv-many", sessionId: `sess-${i}`, usage: { inputTokens: 1, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 1 } }),
    );
    const out = buildStatsExport([snap], jobs);
    expect(out.schemaVersion).toBe(2);
    expect(out.reviews[0]).toMatchObject({ files: 1, hunks: 1, skippedHunkSummaries: 0, jobs: jobs.length });
    const byKind = new Map(out.jobs.map((j) => [j.kind, j]));
    for (const kind of ["ask", "depth", "examples", "diagram", "persona", "reader", "critic", "go-deeper"]) {
      const j = byKind.get(kind as Job["kind"]);
      expect(j, `missing kind ${kind}`).toBeDefined();
      expect(j!.review).toHaveLength(16);
      expect(j!.session).toHaveLength(16);
      expect(j!.tokens).toEqual({ input: 1, cachedRead: 0, cachedWrite: 0, output: 1 });
      expect(j!.turns).toBe(0);
    }
  });

  it("records get_code line ranges and get_hunk spans from JSON details", () => {
    const snap = snapshotWith(2, 2);
    const out = buildStatsExport(
      [snap],
      [
        jobWith({
          reviewId: "rv-many",
          tools: [{ name: "mcp__unvibe__get_code", detail: JSON.stringify({ path: "src/many.py", startLine: 10, endLine: 20, sha: "abc123" }) }],
          turnRecords: [
            {
              label: "first", output: "ok", outputOriginalLength: 2,
              tools: [{ name: "mcp__unvibe__get_hunk", detail: JSON.stringify({ hunkId: "h:fk1:h1" }) }],
              startedAt: T0, finishedAt: T0 + 5,
            },
          ],
        }),
      ],
    );
    const reads = out.jobs[0]!.reads;
    expect(reads).toHaveLength(2);
    // get_code 10-20 → 11 lines in the diff file.
    expect(reads[0]).toMatchObject({ lines: 11, insideDiff: true });
    // get_hunk h1 → new-side span (2..5) → 4 lines, in the diff.
    expect(reads[1]).toMatchObject({ lines: 4, insideDiff: true });
    // Same file ⇒ same salted hash in one export; ranges tell re-reads apart.
    expect(reads[0]!.file).toBe(reads[1]!.file);
  });

  it("counts cap-skipped hunk summaries only past the fan-out cap", () => {
    const big = snapshotWith(HUNK_PASS_FANOUT_LIMIT + 3, 2);
    const small = snapshotWith(3, 1);
    const out = buildStatsExport([big, small], []);
    const [bigOut, smallOut] = out.reviews;
    expect(bigOut!.hunks).toBe(HUNK_PASS_FANOUT_LIMIT + 3);
    expect(bigOut!.skippedHunkSummaries).toBe(HUNK_PASS_FANOUT_LIMIT + 1);
    // Under the cap, one missing summary is pending work, not a cap skip.
    expect(smallOut!.skippedHunkSummaries).toBe(0);
  });

  it("hostile tool details still hash paths and stay leak-clean", () => {
    const snap = snapshotWith(1, 1);
    const out = buildStatsExport(
      [snap],
      [
        jobWith({
          reviewId: "rv-many",
          tools: [{ name: "Read", detail: JSON.stringify({ path: "canary/CANARYPATHFILE.py", startLine: 1, endLine: 9 }) }],
        }),
      ],
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain("CANARYPATHFILE");
    expect(text).not.toContain("canary/CANARYPATHFILE.py");
    expect(out.jobs[0]!.reads[0]).toMatchObject({ lines: 9, insideDiff: false });
  });
});
