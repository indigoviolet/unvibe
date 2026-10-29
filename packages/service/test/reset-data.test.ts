/**
 * #311: `unvibe reset-data` flow + release-notes reset section.
 * Scratch data dirs only; the moved-aside data is never deleted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runResetDataFlow } from "../src/cli/reset-data.js";
import { runDoctor } from "../src/cli/doctor.js";
import { migrate, openDatabase } from "../src/store/index.js";
// @ts-expect-error plain-ESM script lib, typed in scripts-libs.d.ts by pattern
import { dataResetSection, parseDataFormat } from "../../../scripts/release-notes-lib.mjs";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedOldData(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "unvibe.db"));
  migrate(db);
  db.close();
}

describe("runResetDataFlow", () => {
  it("does nothing when there is no data or the format matches", async () => {
    const empty = tmp("unvibe-reset-");
    const a = await runResetDataFlow({ dataDir: empty, yes: true, isRunning: () => false, confirm: async () => false });
    expect(a.code).toBe(0);
    expect(a.lines.join(" ")).toContain("nothing to reset");
  });

  it("refuses while the service is running, with stop guidance", async () => {
    const dir = tmp("unvibe-reset-");
    seedOldData(dir);
    const out = await runResetDataFlow({ dataDir: dir, yes: true, isRunning: () => true, confirm: async () => true });
    expect(out.code).toBe(1);
    expect(out.lines.join("\n")).toContain("unvibe stop");
    expect(fs.existsSync(path.join(dir, "unvibe.db"))).toBe(true);
  });

  it("without --yes a declined prompt moves nothing", async () => {
    const dir = tmp("unvibe-reset-");
    seedOldData(dir);
    const out = await runResetDataFlow({ dataDir: dir, yes: false, isRunning: () => false, confirm: async () => false });
    expect(out.code).toBe(1);
    expect(fs.existsSync(path.join(dir, "unvibe.db"))).toBe(true);
  });

  it("with --yes moves the data aside and recreates an empty dir", async () => {
    const parent = tmp("unvibe-reset-");
    const dir = path.join(parent, "unvibe");
    seedOldData(dir);
    const out = await runResetDataFlow({ dataDir: dir, yes: true, isRunning: () => false, confirm: async () => false });
    expect(out.code).toBe(0);
    const moved = out.lines[0].replace("moved your data to ", "");
    expect(fs.existsSync(path.join(moved, "unvibe.db"))).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("unvibe doctor on a scratch data dir", () => {
  it("reports the format mismatch with reset guidance", async () => {
    const dir = tmp("unvibe-doctor-");
    seedOldData(dir);
    const checks = await runDoctor({ port: 0, dataDir: dir });
    const fmt = checks.find((c) => c.name === "data format");
    expect(fmt?.status).toBe("warn");
    expect(fmt?.detail).toContain("unvibe reset-data");
  }, 60_000);
});

describe("release-notes reset section", () => {
  it("parses DATA_FORMAT from shared source", () => {
    expect(parseDataFormat("export const DATA_FORMAT = 3;")).toBe(3);
    expect(parseDataFormat("nothing here")).toBeNull();
  });

  it("appears only when the format changed; unstamped previous counts as 0", () => {
    expect(dataResetSection(1, 1, "0.0.13")).toBeNull();
    expect(dataResetSection(null, null, "0.0.13")).toBeNull();
    const s = dataResetSection(null, 1, "0.0.13");
    expect(s).toContain("## Data reset needed");
    expect(s).toContain("0 → 1");
    expect(s).toContain("unvibe reset-data");
    expect(s).toContain("npm install -g github:indigoviolet/unvibe#release");
    expect(s).toContain("unvibe-0.0.13.tgz");
    expect(dataResetSection(1, 2, "0.0.13")).toContain("1 → 2");
  });
});
