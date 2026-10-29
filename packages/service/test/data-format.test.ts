/**
 * #311: data-format check, stamping, move-aside (never deletes) and the
 * combined Outbox export read from a stored DB. Scratch dirs only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_FORMAT } from "@unvibe/shared";
import {
  buildCombinedOutboxExport,
  checkDataFormat,
  dataFormatDoctorCheck,
  moveDataAside,
  stampDataFormat,
} from "../src/data-format.js";
import { migrate, openDatabase } from "../src/store/index.js";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedDb(dataDir: string, opts: { stamp?: number; withReview?: boolean } = {}): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, "unvibe.db"));
  migrate(db);
  if (opts.withReview) {
    db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?)").run(
      "rv_1",
      1,
      JSON.stringify({
        review: { id: "rv_1", repoId: "repo", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
        version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
        files: [{ fileKey: "fk1", path: "src/app.py", category: "source", hunks: [] }],
        ingest: { status: "ready" },
        pages: [{ id: "root", kind: "root", title: "Guide title", cards: [] }],
        annotations: [
          {
            type: "thread",
            id: "t1",
            anchor: { host: { kind: "diff-line", fileKey: "fk1", line: 2 }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
            open: true,
            pinned: false,
            post: true,
            replies: [
              {
                id: "r1",
                kind: "comment",
                who: "you",
                question: null,
                blocks: [{ type: "paragraph", id: "b1", text: { standard: "Unposted draft text" }, citations: [] }],
                level: "standard",
                revision: 1,
                undoStack: [],
              },
            ],
          },
        ],
        hunkStates: [],
        fileStates: [],
        viewPrefs: {},
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
      }),
      0,
    );
  }
  if (opts.stamp !== undefined) db.exec(`PRAGMA user_version = ${opts.stamp}`);
  db.close();
}

describe("checkDataFormat", () => {
  it("none when the dir does not exist or is empty", () => {
    const dir = path.join(tmp("unvibe-df-"), "missing");
    expect(checkDataFormat(dir)).toEqual({ state: "none", expected: DATA_FORMAT, stored: null, hasData: false });
    const empty = tmp("unvibe-df-");
    expect(checkDataFormat(empty).state).toBe("none");
  });

  it("match after a fresh DB is stamped", () => {
    const dir = tmp("unvibe-df-");
    const db = openDatabase(path.join(dir, "unvibe.db"));
    migrate(db);
    stampDataFormat(db);
    db.close();
    expect(checkDataFormat(dir)).toEqual({ state: "match", expected: DATA_FORMAT, stored: DATA_FORMAT, hasData: true });
  });

  it("mismatch when existing data has no stamp (pre-#311 data)", () => {
    const dir = tmp("unvibe-df-");
    seedDb(dir, { withReview: true });
    const s = checkDataFormat(dir);
    expect(s.state).toBe("mismatch");
    expect(s.stored).toBeNull();
    expect(s.hasData).toBe(true);
  });

  it("mismatch when the stored format differs", () => {
    const dir = tmp("unvibe-df-");
    seedDb(dir, { stamp: DATA_FORMAT + 1 });
    expect(checkDataFormat(dir).state).toBe("mismatch");
    expect(checkDataFormat(dir).stored).toBe(DATA_FORMAT + 1);
  });

  it("none when only token/lock/probe-scratch entries exist without a DB", () => {
    const dir = tmp("unvibe-df-");
    fs.writeFileSync(path.join(dir, "token"), "x\n");
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    expect(checkDataFormat(dir).state).toBe("none");
  });

  it("mismatch when data files exist without a DB", () => {
    const dir = tmp("unvibe-df-");
    fs.mkdirSync(path.join(dir, "reviews"), { recursive: true });
    expect(checkDataFormat(dir).state).toBe("mismatch");
  });
});

describe("moveDataAside", () => {
  it("moves the whole dir aside, never deletes, and recreates an empty dir", () => {
    const parent = tmp("unvibe-df-");
    const dir = path.join(parent, "unvibe");
    seedDb(dir, { stamp: 999, withReview: true });
    fs.writeFileSync(path.join(dir, "token"), "secret-token\n");
    const moved = moveDataAside(dir, new Date("2026-10-29T12:00:00.000Z"));
    expect(moved).toContain(".bak-");
    expect(fs.existsSync(path.join(moved, "unvibe.db"))).toBe(true);
    expect(fs.readFileSync(path.join(moved, "token"), "utf8")).toContain("secret-token");
    expect(fs.readdirSync(dir)).toEqual([]);
    // The moved-aside data still reports its old format.
    expect(checkDataFormat(moved).stored).toBe(999);
  });

  it("does not collide when moved twice at the same time", () => {
    const parent = tmp("unvibe-df-");
    const dir = path.join(parent, "unvibe");
    seedDb(dir, { stamp: 999 });
    const now = new Date("2026-10-29T12:00:00.000Z");
    const first = moveDataAside(dir, now);
    seedDb(dir, { stamp: 998 });
    const second = moveDataAside(dir, now);
    expect(second).not.toBe(first);
    expect(fs.existsSync(path.join(first, "unvibe.db"))).toBe(true);
    expect(fs.existsSync(path.join(second, "unvibe.db"))).toBe(true);
  });
});

describe("combined Outbox export + doctor line", () => {
  it("exports unposted drafts from the stored DB", () => {
    const dir = tmp("unvibe-df-");
    seedDb(dir, { withReview: true });
    const db = openDatabase(path.join(dir, "unvibe.db"));
    const out = buildCombinedOutboxExport(db);
    db.close();
    expect(out.count).toBe(1);
    expect(out.markdown).toContain("Unposted draft text");
    expect(out.markdown).toContain("src/app.py:2");
  });

  it("doctor check names match, mismatch and none", () => {
    expect(dataFormatDoctorCheck({ state: "match", expected: 1, stored: 1, hasData: true }).status).toBe("ok");
    const bad = dataFormatDoctorCheck({ state: "mismatch", expected: 1, stored: null, hasData: true });
    expect(bad.status).toBe("warn");
    expect(bad.detail).toContain("unvibe reset-data");
    expect(dataFormatDoctorCheck({ state: "none", expected: 1, stored: null, hasData: false }).status).toBe("ok");
  });
});
