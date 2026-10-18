/**
 * #176: the bundled demo's working copy must contain the demo PR's head
 * files, so `get_code` / Read / Grep beyond the diff work and the reader
 * does not degrade. The fixture carries only the diff; `ingestDemo`
 * materializes each changed file from its hunks (real lines at real
 * numbers, unknown lines blank), and `readCodeSlice` serves a non-git
 * working copy from disk.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RealCommandRunner } from "../src/exec/index.js";
import { readCodeSlice } from "../src/mcp/read.js";
import { ingestDemo } from "../src/pipeline/demo.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const real = new RealCommandRunner();

describe("demo working copy (#176)", () => {
  it("materializes head files with real code at real line numbers", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-demo176-"));
    try {
      const ingested = ingestDemo(fixturesDir, "rv_demo176", dataDir);
      const conn = fs.readFileSync(path.join(ingested.worktreePath, "src/urllib3/connection.py"), "utf8").split("\n");
      // The new helper (reader cites diff:conn:91-110) is really there.
      expect(conn[90]).toContain("_normalize_header_value");
      expect(conn.join("\n")).toContain("_normalize_header_values(httplib_response.msg)");
      // Lines the fixture does not know stay blank, never invented code.
      expect(conn[200]).toBe("");
      const tests = fs.readFileSync(path.join(ingested.worktreePath, "test/test_connection.py"), "utf8");
      expect(tests).toContain("test_normalize_header_value");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("serves get_code slices from the demo working copy", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-demo176-"));
    try {
      const ingested = ingestDemo(fixturesDir, "rv_demo176", dataDir);
      const slice = await readCodeSlice(
        real,
        ingested.worktreePath,
        ingested.version.headSha,
        "src/urllib3/connection.py",
        91,
        95,
      );
      expect(slice).not.toHaveProperty("error");
      if ("text" in slice) expect(slice.text).toContain("_normalize_header_value");
      const missing = await readCodeSlice(
        real,
        ingested.worktreePath,
        ingested.version.headSha,
        "src/urllib3/fields.py",
        1,
        5,
      );
      expect(missing).toEqual({ error: "not-found" });
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("never serves on-disk files for a real git checkout whose rev is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-demo176-git-"));
    try {
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(path.join(dir, "a.py"), "real\n");
      const slice = await readCodeSlice(real, dir, "deadbeef", "a.py", 1, 1);
      expect(slice).toEqual({ error: "not-found" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
