import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTargets } from "@unvibe/shared";
import { buildSnapshot } from "../src/replay/snapshot.js";
import { createSnapshotLookup, validateReply } from "../src/validate/index.js";
import { createApp } from "../src/server.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);

describe("snapshot build", () => {
  it("builds urllib3#5020 with zero unverified citations", () => {
    const { snapshot, counts } = buildSnapshot(fixturesDir);
    // 51 base recordings + 3 second-opinion recordings (blind ×2, check ×1)
    // + 1 expansion-depth recording (audit #10 principle E2E).
    expect(counts).toHaveLength(56);
    expect(snapshot.files.map((f) => [f.fileKey, f.hunks.length])).toEqual([
      ["src-urllib3-connection.py", 2],
      ["test-test_connection.py", 3],
      ["test-with_dummyserver-test_socketlevel.py", 2],
      ["changelog-1362.bugfix.rst", 1],
    ]);
    expect(snapshot.pages.map((p) => p.id).sort()).toEqual(
      [
        "root",
        "c-obs-fold",
        "c-http-headers",
        "c-header-injection",
        "c-regex-performance",
        "c-ows-rws",
        "c-set-cookie",
        "c-requests-cookies",
        "f-lf",
        "f-perf",
      ].sort(),
    );
    const root = snapshot.pages.find((p) => p.id === "root")!;
    expect(root.cards.map((c) => c.id)).toEqual([
      "problem",
      "central",
      "buildup",
      "decisions",
      "g-flow",
      "g-design",
      "g-regex",
      "g-check",
    ]);
    const finding = snapshot.pages.find((p) => p.id === "f-lf")!;
    expect(finding.confidence).toBe("medium");
    expect(snapshot.annotations.map((a) => a.id).sort()).toEqual(
      ["t-diff", "t-seed", "t-sgperf", "t-sglf", "x-seed"].sort(),
    );

    // Seed state survived: tconn hunk 3 reviewed+folded (hunk notes are
    // gone, issue #162 — no hunk carries one).
    const tconn = snapshot.files.find((f) => f.fileKey === "test-test_connection.py")!;
    const reviewed = snapshot.hunkStates.find((s) => s.contentHash === tconn.hunks[2].contentHash)!;
    expect(reviewed).toMatchObject({ reviewed: true, folded: true });
    expect(snapshot.hunkStates.every((s) => !("note" in s))).toBe(true);

    // Independent re-validation: every citation in the snapshot validates
    // (same alias mapping the builder uses for the short recording keys).
    const lookup = createSnapshotLookup(snapshot, {
      aliases: {
        conn: "src-urllib3-connection.py",
        tconn: "test-test_connection.py",
        tsock: "test-with_dummyserver-test_socketlevel.py",
        log: "changelog-1362.bugfix.rst",
      },
      descTexts: {
        "d-p1": "x",
        "d-p2": "x",
        "d-p3": "x",
        "d-p4": "x",
        "d-p5": "x",
      },
      concepts: [
        "obs-fold",
        "http-headers",
        "header-injection",
        "regex-performance",
        "ows-rws",
        "set-cookie",
        "requests-cookies",
      ],
    });
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        const report = validateReply(card.blocks, lookup);
        expect(report.tokens.filter((t) => t.status === "unverified")).toEqual([]);
      }
    }
    // Sanity: the snapshot really contains citations (deduped per card).
    const total = snapshot.pages.flatMap((p) =>
      p.cards.flatMap((c) => collectTargets(c.blocks).citations),
    );
    expect(total.length).toBeGreaterThan(30);
  });

  it("serves GET /api/prompts?review= for the stored snapshot (no 501)", async () => {
    const { snapshot } = buildSnapshot(fixturesDir);
    const { app, ctx } = await createApp("test-token");
    try {
      ctx.reviews.putSnapshot(snapshot.review.id, snapshot);
      const res = await app.inject({
        method: "GET",
        url: `/api/prompts?review=${snapshot.review.id}`,
        headers: { authorization: "Bearer test-token" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        templates: { name: string }[];
        expanded: { name: string; expanded: string }[];
      };
      expect(body.templates).toHaveLength(18);
      expect(body.expanded).toHaveLength(18);
      const blind = body.expanded.find((e) => e.name === "second_opinion_blind")!;
      expect(blind.expanded).toContain("Folds that end in a bare LF are not unfolded");
      const reader = body.expanded.find((e) => e.name === "reader")!;
      expect(reader.expanded).toContain("src-urllib3-connection.py");
    } finally {
      await app.close();
    }
  });
});
