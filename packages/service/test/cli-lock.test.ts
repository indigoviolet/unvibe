import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive, readLock, removeLock, removeOwnLock, writeLock } from "../src/cli/lock.js";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-lock-"));
}

describe("service lock", () => {
  it("write → read round-trips; missing dir reads as null", () => {
    const dir = tmpDataDir();
    expect(readLock(dir)).toBeNull();
    writeLock(dir, { pid: 1234, port: 4517, startedAt: "2026-01-01T00:00:00.000Z" });
    expect(readLock(dir)).toEqual({ pid: 1234, port: 4517, startedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("corrupt lock reads as null (treated as no lock)", () => {
    const dir = tmpDataDir();
    fs.writeFileSync(path.join(dir, "unvibe.lock"), "not json{{{");
    expect(readLock(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, "unvibe.lock"), JSON.stringify({ pid: "x", port: 1 }));
    expect(readLock(dir)).toBeNull();
  });

  it("removeOwnLock never steals a successor's lock", () => {
    const dir = tmpDataDir();
    writeLock(dir, { pid: 111, port: 1, startedAt: "" });
    removeOwnLock(dir, 222);
    expect(readLock(dir)?.pid).toBe(111);
    removeOwnLock(dir, 111);
    expect(readLock(dir)).toBeNull();
    removeLock(dir); // missing: no throw
  });

  it("isPidAlive sees this process, not a dead pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    // A very large pid is (practically) never alive; either way no throw.
    expect(() => isPidAlive(2 ** 30)).not.toThrow();
  });
});
