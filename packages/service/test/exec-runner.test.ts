/**
 * RealCommandRunner working-directory errors: a moved/deleted checkout must
 * produce a specific message naming the directory, not a bare ENOENT.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RealCommandRunner } from "../src/exec/runner.js";

describe("RealCommandRunner missing cwd", () => {
  it("names a deleted directory instead of ENOENT", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-gone-"));
    fs.rmSync(dir, { recursive: true, force: true });
    const runner = new RealCommandRunner();
    await expect(runner.run("git", { args: ["status"], cwd: dir })).rejects.toThrow(
      new RegExp(`directory not found: .*${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*moved or deleted`),
    );
  });

  it("still runs when the directory exists", async () => {
    const runner = new RealCommandRunner();
    const res = await runner.run("git", { args: ["--version"], cwd: os.tmpdir() });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/git version/);
  });
});
