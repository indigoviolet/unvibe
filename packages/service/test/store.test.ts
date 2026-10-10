import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/db.js";
import { currentVersion, migrate } from "../src/store/migrate.js";
import { ensureReviewDir } from "../src/store/paths.js";

describe("store migrations", () => {
  it("applies 001 and is idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-db-"));
    const db = openDatabase(path.join(dir, "test.db"));
    try {
      expect(migrate(db)).toEqual([1, 2, 3, 4]);
      expect(currentVersion(db)).toBe(4);
      expect(migrate(db)).toEqual([]);
      db.prepare("INSERT INTO repos (id, owner, name, local_path) VALUES (?, ?, ?, ?)").run(
        "r1",
        "o",
        "n",
        "/tmp/x",
      );
      const row = db.prepare("SELECT id FROM repos WHERE id = ?").get("r1") as { id: string };
      expect(row.id).toBe("r1");
    } finally {
      db.close();
    }
  });
});

describe("review folders", () => {
  it("builds <owner>/<repo>/<review-id>/ paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-rev-"));
    const out = ensureReviewDir(dir, "acme", "app", "rev1");
    expect(out).toBe(path.join(dir, "reviews", "acme", "app", "rev1"));
    expect(fs.statSync(out).isDirectory()).toBe(true);
  });
});
