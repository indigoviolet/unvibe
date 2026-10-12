/**
 * Temp-dir guard (issue #24): fails the run if the leak machinery
 * regresses. Trap-safe: it judges only exact paths this file created —
 * never globs the system temp dir, so parallel worktrees' suites cannot
 * cause false positives.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("temp guard (#24)", () => {
  it("runs inside a per-run temp root", () => {
    const tmp = os.tmpdir();
    expect(tmp).toMatch(/unvibe-test-/);
    expect(fs.existsSync(tmp)).toBe(true);
  });

  it("redirects mkdtemp into the per-run root", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guardcheck-"));
    expect(dir.startsWith(os.tmpdir() + path.sep)).toBe(true);
    // Left for the per-file root teardown (no per-test cleanup needed).
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("createApp removes its default data dir on close, keeps an explicit one", async () => {
    const owned = await createApp("tok", {});
    const ownedDir = owned.ctx.dataDir;
    expect(ownedDir).toMatch(/unvibe-data-/);
    await owned.app.close();
    expect(fs.existsSync(ownedDir)).toBe(false);

    const keep = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guardcheck-"));
    const explicit = await createApp("tok", { dataDir: keep });
    await explicit.app.close();
    // Explicit dirs belong to the caller (here: the per-run root teardown).
    expect(fs.existsSync(keep)).toBe(true);
  });
});
