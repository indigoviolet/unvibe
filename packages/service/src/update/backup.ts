/**
 * Per-channel database backups (issue #36).
 *
 * Migrations are forward-only and numbered, so two branches can each add a
 * different "version 2": a database migrated by one channel is wrong for
 * another. Each channel therefore keeps its own copy under
 * `<dataDir>/channel-backups/<slot>/`. Switching backs up the old channel
 * first, then restores the new channel's copy when one exists. Slots are
 * never deleted by this module — at worst a channel's own slot is
 * overwritten by a newer backup of that same channel.
 *
 * Plain `node:fs` copies (no SQLite handle): `unvibe update` refuses to run
 * while the service is live, so the files are quiescent and the main file
 * plus `-wal`/`-shm` together form a consistent snapshot. Restore removes
 * the live `-wal`/`-shm` first so a stale journal can never shadow a
 * restored main file.
 *
 * The live database is `<dataDir>/unvibe.db` (`dbFilePath`); very old
 * installs may still carry `unvibe.sqlite` (the name `DEVELOPMENT.md`
 * uses), so both basenames are backed up and restored when present.
 */
import fs from "node:fs";
import path from "node:path";
import { dbFilePath } from "../store/paths.js";

/** Slot for installs with no channel record (source checkouts, old builds). */
export const UNKNOWN_CHANNEL_SLOT = "_unknown";

const LEGACY_BASE = "unvibe.sqlite";
const SUFFIXES = ["", "-wal", "-shm"];

function liveBases(dataDir: string): string[] {
  const primary = path.basename(dbFilePath(dataDir));
  return primary === LEGACY_BASE ? [primary] : [primary, LEGACY_BASE];
}

/** Every database filename handled, e.g. `unvibe.db`, `unvibe.db-wal`. */
export function dbFileNames(dataDir: string): string[] {
  const out: string[] = [];
  for (const base of liveBases(dataDir)) {
    for (const suffix of SUFFIXES) out.push(`${base}${suffix}`);
  }
  return out;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * `<dataDir>/channel-backups/<slot>/`, where `/` in channel names becomes
 * `-` (`preview/feat-x` -> `preview-feat-x`). Null (unknown install)
 * maps to the reserved `_unknown` slot, which no valid channel can collide
 * with (channel names never contain `_`).
 */
export function channelSlotDir(dataDir: string, channel: string | null): string {
  const slot = channel ? channel.replace(/\//g, "-") : UNKNOWN_CHANNEL_SLOT;
  return path.join(dataDir, "channel-backups", slot);
}

export interface BackupResult {
  dir: string;
  files: string[];
}

/** Copy the live database files into the channel's slot. */
export function backupChannel(dataDir: string, channel: string | null): BackupResult {
  const dir = channelSlotDir(dataDir, channel);
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const name of dbFileNames(dataDir)) {
    const src = path.join(dataDir, name);
    if (!isFile(src)) continue;
    fs.copyFileSync(src, path.join(dir, name));
    files.push(name);
  }
  return { dir, files };
}

/** True when the channel's slot holds a database worth restoring. */
export function hasBackup(dataDir: string, channel: string): boolean {
  const dir = channelSlotDir(dataDir, channel);
  return liveBases(dataDir).some((base) => isFile(path.join(dir, base)));
}

/**
 * Restore a channel's slot over the live data dir. Removes the live
 * database files first (never the slot), then copies the slot back.
 */
export function restoreChannel(dataDir: string, channel: string): BackupResult {
  const dir = channelSlotDir(dataDir, channel);
  for (const name of dbFileNames(dataDir)) {
    try {
      fs.rmSync(path.join(dataDir, name), { force: true });
    } catch {
      // Already gone: fine.
    }
  }
  const files: string[] = [];
  for (const name of dbFileNames(dataDir)) {
    const backup = path.join(dir, name);
    if (!isFile(backup)) continue;
    fs.copyFileSync(backup, path.join(dataDir, name));
    files.push(name);
  }
  return { dir, files };
}
