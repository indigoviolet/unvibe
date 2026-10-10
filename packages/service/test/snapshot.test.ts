import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTargets } from "@unvibe/shared";
import { buildSnapshot } from "../src/replay/snapshot.js";
import { createSnapshotLookup, validateReply } from "../src/validate/index.js";

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
    expect(counts).toHaveLength(51);
    expect(snapshot.files.map((f) => [f.fileKey, f.hunks.length])).toEqual([
      ["conn", 2],
      ["tconn", 3],
      ["tsock", 2],
      ["log", 1],
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

    // Seed state survived: tconn hunk 3 reviewed+folded, conn hunk 2 noted.
    const tconn = snapshot.files.find((f) => f.fileKey === "tconn")!;
    const conn = snapshot.files.find((f) => f.fileKey === "conn")!;
    const reviewed = snapshot.hunkStates.find((s) => s.contentHash === tconn.hunks[2].contentHash)!;
    expect(reviewed).toMatchObject({ reviewed: true, folded: true });
    const noted = snapshot.hunkStates.find((s) => s.contentHash === conn.hunks[1].contentHash)!;
    expect(noted.note).toMatch(/Only call site/);

    // Independent re-validation: every citation in the snapshot validates.
    const lookup = createSnapshotLookup(snapshot, {
      aliases: { conn: "conn", tconn: "tconn", tsock: "tsock", log: "log" },
      descTexts: {
        "d-intro": "x",
        "d-norm": "x",
        "d-sync": "x",
        "d-tests": "x",
        "d-scope": "x",
        "d-valid": "x",
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
});
