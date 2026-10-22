/**
 * Update seam units (issue #36, step 2): fake backend semantics, failure
 * injection, data-dir state files, build identity, lease check.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  FakeUpdater,
  RealUpdater,
  createUpdaterFromEnv,
} from "../src/update/updater.js";
import {
  clearPendingSwitch,
  hasAnySubmitLease,
  isSwitchPending,
  readPendingSwitch,
  readSwitchOutcome,
  writeCurrentRef,
  writePendingSwitch,
  writeSwitchOutcome,
} from "../src/update/state.js";
import { fakeBuildInfo, resolveBuildInfo } from "../src/update/build-info.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-update-"));
}

describe("FakeUpdater", () => {
  it("marks the installed ref current and switches it", async () => {
    const dir = tempDir();
    const updater = new FakeUpdater(dir);
    const before = await updater.listChannels();
    expect(before.find((c) => c.ref === "release")?.current).toBe(true);
    expect(before.find((c) => c.ref === "preview/feat-x")?.current).toBe(false);

    const res = await updater.switchTo("preview/feat-x");
    expect(res).toEqual({ from: "release", to: "preview/feat-x" });
    const after = await updater.listChannels();
    expect(after.find((c) => c.ref === "preview/feat-x")?.current).toBe(true);

    // A second process over the same data dir sees the same ref.
    expect(await new FakeUpdater(dir).listChannels().then((l) => l.find((c) => c.current)?.ref)).toBe(
      "preview/feat-x",
    );
  });

  it("reads the channel list from fake-channels.json when present", async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "update", "fake-channels.json"),
      JSON.stringify([
        { ref: "release", version: "0.0.1" },
        { ref: "preview/e2e", version: "0.0.1-preview.e2e.deadbee", sourceBranch: "e2e", commit: "deadbee" },
      ]),
    );
    const updater = new FakeUpdater(dir);
    const list = await updater.listChannels();
    expect(list.map((c) => c.ref)).toEqual(["release", "preview/e2e"]);
    expect(list[1].kind).toBe("preview");
    await expect(updater.switchTo("preview/nope")).rejects.toThrow('unknown update channel "preview/nope"');
  });

  it("install failure injection throws; health injection reports success without advancing", async () => {
    const dir = tempDir();
    process.env.UNVIBE_UPDATE_FAKE_FAIL = "install:preview/feat-x";
    try {
      await expect(new FakeUpdater(dir).switchTo("preview/feat-x")).rejects.toThrow("fake install");
      expect(await new FakeUpdater(dir).listChannels().then((l) => l.find((c) => c.current)?.ref)).toBe("release");
    } finally {
      delete process.env.UNVIBE_UPDATE_FAKE_FAIL;
    }
    process.env.UNVIBE_UPDATE_FAKE_FAIL = "health:preview/feat-x";
    try {
      const res = await new FakeUpdater(dir).switchTo("preview/feat-x");
      expect(res).toEqual({ from: "release", to: "preview/feat-x" });
      // Installed ref did NOT advance: the restarted service still reports the old build.
      expect(await new FakeUpdater(dir).listChannels().then((l) => l.find((c) => c.current)?.ref)).toBe("release");
      // Rollback to another ref behaves normally.
      const back = await new FakeUpdater(dir).switchTo("release");
      expect(back).toEqual({ from: "release", to: "release" });
    } finally {
      delete process.env.UNVIBE_UPDATE_FAKE_FAIL;
    }
  });

  it("switching to the current ref is a no-op success", async () => {
    const res = await new FakeUpdater().switchTo("release");
    expect(res).toEqual({ from: "release", to: "release" });
  });
});

describe("backend selection + real updater", () => {
  it("fake is opt-in via UNVIBE_UPDATER_BACKEND; default is real", () => {
    const dir = tempDir();
    expect(createUpdaterFromEnv(dir, { env: {} })).toBeInstanceOf(RealUpdater);
    expect(createUpdaterFromEnv(dir, { env: { UNVIBE_UPDATER_BACKEND: "fake" } })).toBeInstanceOf(FakeUpdater);
  });

  it("real updater rejects unknown channels without touching npm", async () => {
    const dir = tempDir();
    const runner = new FakeCommandRunner();
    const real = new RealUpdater({ runner, dataDir: dir, serviceScriptPath: undefined, serviceVersion: "0.0.1" });
    await expect(real.switchTo("bogus")).rejects.toThrow('unknown update channel "bogus"');
    expect(runner.calls).toHaveLength(0);
  });

  it("real updater lists through the channels file override (no gh)", async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    const channels = [
      { ref: "release", version: "0.0.1" },
      { ref: "preview/a", version: "0.0.1-preview.a.1", sourceBranch: "a", commit: "c1" },
    ];
    const file = path.join(dir, "update", "channels.json");
    fs.writeFileSync(file, JSON.stringify(channels));
    const prev = process.env.UNVIBE_UPDATE_CHANNELS_FILE;
    process.env.UNVIBE_UPDATE_CHANNELS_FILE = file;
    try {
      const runner = new FakeCommandRunner();
      const real = new RealUpdater({ runner, dataDir: dir, serviceScriptPath: undefined, serviceVersion: "0.0.1" });
      const list = await real.listChannels();
      expect(list.map((c) => c.ref)).toEqual(["release", "preview/a"]);
      expect(runner.calls).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_UPDATE_CHANNELS_FILE;
      else process.env.UNVIBE_UPDATE_CHANNELS_FILE = prev;
    }
  });
});

describe("update state files", () => {
  it("pending round-trips; corrupt reads as absent", () => {
    const dir = tempDir();
    expect(readPendingSwitch(dir)).toBeNull();
    expect(isSwitchPending(dir)).toBe(false);
    writePendingSwitch(dir, { from: "release", to: "preview/a", startedAt: "2026-10-12T00:00:00.000Z" });
    expect(isSwitchPending(dir)).toBe(true);
    expect(readPendingSwitch(dir)).toEqual({ from: "release", to: "preview/a", startedAt: "2026-10-12T00:00:00.000Z" });
    clearPendingSwitch(dir);
    expect(readPendingSwitch(dir)).toBeNull();
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    fs.writeFileSync(path.join(dir, "update", "pending.json"), "not json");
    expect(readPendingSwitch(dir)).toBeNull();
  });

  it("outcome round-trips and validates status", () => {
    const dir = tempDir();
    expect(readSwitchOutcome(dir)).toBeNull();
    writeSwitchOutcome(dir, {
      status: "rolled-back",
      from: "release",
      to: "preview/a",
      reason: "boom",
      finishedAt: "2026-10-12T00:00:00.000Z",
    });
    expect(readSwitchOutcome(dir)?.status).toBe("rolled-back");
    fs.writeFileSync(path.join(dir, "update", "outcome.json"), JSON.stringify({ status: "bogus", from: "a", to: "b" }));
    expect(readSwitchOutcome(dir)).toBeNull();
  });
});

describe("build identity", () => {
  it("fake mode follows the installed fake channel", () => {
    const dir = tempDir();
    // No channels file: the default seed's release carries a version, so
    // the default install reports it.
    expect(fakeBuildInfo(dir)?.version).toBe("0.0.1");
    writeCurrentRef(dir, "preview/feat-x");
    const info = fakeBuildInfo(dir);
    expect(info?.version).toBe("0.0.1-preview.feat-x.abc1234");
    expect(info?.sourceBranch).toBe("feat/x");
  });

  it("fake-installed.json stages an installed build older than published (#231)", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "update", "fake-channels.json"),
      JSON.stringify([{ ref: "release", version: "0.0.2", commit: "newcommit", builtAt: "2026-10-12T12:00:00.000Z" }]),
    );
    // Without the override the install matches the published spec.
    expect(fakeBuildInfo(dir)?.version).toBe("0.0.2");
    fs.writeFileSync(
      path.join(dir, "update", "fake-installed.json"),
      JSON.stringify({ version: "0.0.1", commit: "oldcommit", builtAt: "2026-10-11T12:00:00.000Z" }),
    );
    expect(fakeBuildInfo(dir)).toMatchObject({
      version: "0.0.1",
      channel: "release",
      commit: "oldcommit",
      builtAt: "2026-10-11T12:00:00.000Z",
    });
    // Corrupt override: ignored, install matches published again.
    fs.writeFileSync(path.join(dir, "update", "fake-installed.json"), "not json");
    expect(fakeBuildInfo(dir)?.version).toBe("0.0.2");
  });

  it("UNVIBE_UPDATE_FAKE_FAIL=list makes listChannels throw (#231)", async () => {
    const dir = tempDir();
    const prev = process.env.UNVIBE_UPDATE_FAKE_FAIL;
    process.env.UNVIBE_UPDATE_FAKE_FAIL = "list";
    try {
      await expect(new FakeUpdater(dir).listChannels()).rejects.toThrow("fake channel listing failed");
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_UPDATE_FAKE_FAIL;
      else process.env.UNVIBE_UPDATE_FAKE_FAIL = prev;
    }
    // Untouched afterwards.
    expect((await new FakeUpdater(dir).listChannels()).length).toBeGreaterThan(0);
  });

  it("resolveBuildInfo reads the installed package, else null", () => {
    const dir = tempDir();
    // No install at the script path: null (source checkout shape).
    expect(
      resolveBuildInfo({ dataDir: dir, serviceScriptPath: path.join(dir, "nope.js"), serviceVersion: "0.0.1", env: {} }),
    ).toBeNull();
    const inst = tempDir();
    fs.mkdirSync(path.join(inst, "packages", "service", "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(inst, "package.json"),
      JSON.stringify({
        name: "unvibe",
        version: "0.0.1-preview.x.y",
        unvibe: { channel: "preview/x", sourceBranch: "x", commit: "y", builtAt: "2026-10-12T00:00:00.000Z" },
      }),
    );
    const scriptPath = path.join(inst, "packages", "service", "dist", "index.js");
    fs.writeFileSync(scriptPath, "");
    expect(
      resolveBuildInfo({ dataDir: dir, serviceScriptPath: scriptPath, serviceVersion: "0.0.1", env: {} }),
    ).toEqual({
      version: "0.0.1-preview.x.y",
      channel: "preview/x",
      sourceBranch: "x",
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      commit: "y",
      builtAt: "2026-10-12T00:00:00.000Z",
    });
  });
});

describe("hasAnySubmitLease", () => {
  it("false with no table, false when empty, true with a row", () => {
    const db = openDatabase(":memory:");
    expect(hasAnySubmitLease(db)).toBe(false);
    migrate(db);
    expect(hasAnySubmitLease(db)).toBe(false);
    db.prepare("INSERT INTO submit_leases (review_id, started_at, commit_id, payload) VALUES (?, ?, ?, ?)").run(
      "r1",
      Date.now(),
      "abc",
      "{}",
    );
    expect(hasAnySubmitLease(db)).toBe(true);
    db.close();
  });
});
