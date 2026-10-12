/**
 * Update data-dir files (issue #36, step 2).
 *
 * All switch coordination between the service and the detached helper goes
 * through `<dataDir>/update/` (plain JSON, macOS + Linux safe):
 * - `pending.json` — written by the service when it commits to a switch,
 *   cleared by the helper when the outcome is recorded. While present, the
 *   service refuses another switch and idle exit is suppressed.
 * - `outcome.json` — the helper's verdict (`ok` / `rolled-back` /
 *   `failed` + reason + log path), surfaced by `GET /api/update/status`.
 *   Overwritten by each switch; never cleared by the service.
 * - `current-ref` — the fake backend's installed-ref tracking (test-only).
 * - `fake-channels.json` — optional fake channel list (test-only).
 * - `helper-*.js` / `helper-args-*.json` / `switch-*.log` — per-switch
 *   helper copies, args and logs.
 */
import fs from "node:fs";
import path from "node:path";
import type { SwitchOutcome, UpdatePendingSwitch } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";

export function updateDir(dataDir: string): string {
  return path.join(dataDir, "update");
}

export function pendingPath(dataDir: string): string {
  return path.join(updateDir(dataDir), "pending.json");
}

export function outcomePath(dataDir: string): string {
  return path.join(updateDir(dataDir), "outcome.json");
}

/** Test-only: fake backend's installed ref. */
export function currentRefPath(dataDir: string): string {
  return path.join(updateDir(dataDir), "current-ref");
}

/** Test-only: fake backend's channel list override. */
export function fakeChannelsPath(dataDir: string): string {
  return path.join(updateDir(dataDir), "fake-channels.json");
}

function readJsonFile<T>(file: string): T | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function readPendingSwitch(dataDir: string): UpdatePendingSwitch | null {
  const parsed = readJsonFile<UpdatePendingSwitch>(pendingPath(dataDir));
  if (!parsed || typeof parsed.from !== "string" || typeof parsed.to !== "string") return null;
  return parsed;
}

export function writePendingSwitch(dataDir: string, pending: UpdatePendingSwitch): void {
  writeJsonFile(pendingPath(dataDir), pending);
}

export function clearPendingSwitch(dataDir: string): void {
  try {
    fs.unlinkSync(pendingPath(dataDir));
  } catch {
    // Already gone: fine.
  }
}

export function isSwitchPending(dataDir: string): boolean {
  return readPendingSwitch(dataDir) !== null;
}

export function readSwitchOutcome(dataDir: string): SwitchOutcome | null {
  const parsed = readJsonFile<SwitchOutcome>(outcomePath(dataDir));
  if (!parsed || typeof parsed.from !== "string" || typeof parsed.to !== "string") return null;
  if (parsed.status !== "ok" && parsed.status !== "rolled-back" && parsed.status !== "failed") return null;
  return parsed;
}

export function writeSwitchOutcome(dataDir: string, outcome: SwitchOutcome): void {
  writeJsonFile(outcomePath(dataDir), outcome);
}

/** Test-only: installed ref tracked by the fake backend (null = default). */
export function readCurrentRef(dataDir: string): string | null {
  try {
    const raw = fs.readFileSync(currentRefPath(dataDir), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

/** Test-only: record the fake backend's installed ref. */
export function writeCurrentRef(dataDir: string, ref: string): void {
  fs.mkdirSync(updateDir(dataDir), { recursive: true });
  fs.writeFileSync(currentRefPath(dataDir), ref + "\n");
}

/**
 * True when any submit lease row exists (a Submit is in flight somewhere).
 * The leases table may not exist yet (migration 004 runs in production;
 * in-memory test DBs may predate it) — then there is no lease.
 */
export function hasAnySubmitLease(db: DatabaseSync): boolean {
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='submit_leases'")
      .get() as { name: string } | undefined;
    if (!tables) return false;
    const row = db.prepare("SELECT 1 AS one FROM submit_leases LIMIT 1").get() as { one: number } | undefined;
    return !!row;
  } catch {
    return false;
  }
}
