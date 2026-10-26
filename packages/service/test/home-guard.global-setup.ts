/**
 * Real-home guard (issue #280).
 *
 * Snapshots the metadata (existence + mtime) of the real home's login-unit
 * locations before the suite and fails afterwards on any change. Metadata
 * only: never reads or prints file contents. Cheap (three stat calls) and
 * macOS/Linux-safe (missing files snapshot as absent).
 *
 * Watched (from the real `os.homedir()`, never a temp root):
 * - `~/.config/systemd/user/unvibe.service` (Linux unit)
 * - `~/Library/LaunchAgents/com.unvibe.service.plist` (macOS unit)
 * - `~/.local/share/applications/unvibe-open.desktop` (Linux handler)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Snapshot {
  exists: boolean;
  mtimeMs: number | null;
}

function watchedPaths(home: string): string[] {
  return [
    path.join(home, ".config", "systemd", "user", "unvibe.service"),
    path.join(home, "Library", "LaunchAgents", "com.unvibe.service.plist"),
    path.join(home, ".local", "share", "applications", "unvibe-open.desktop"),
  ];
}

function snapshot(paths: string[]): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      out.set(p, { exists: true, mtimeMs: st.mtimeMs });
    } catch {
      out.set(p, { exists: false, mtimeMs: null });
    }
  }
  return out;
}

export default async function homeGuard(): Promise<() => Promise<void>> {
  // Real home at suite start (globalSetup runs before the per-file temp-root
  // patch, in the main process — never a test's scratch dir).
  const home = os.homedir();
  const paths = watchedPaths(home);
  const before = snapshot(paths);
  return async () => {
    const after = snapshot(paths);
    const changed: string[] = [];
    for (const p of paths) {
      const b = before.get(p);
      const a = after.get(p);
      if (!b || !a) continue;
      if (b.exists !== a.exists) {
        changed.push(`${p}: existed=${b.exists} now=${a.exists}`);
      } else if (b.exists && a.exists && b.mtimeMs !== a.mtimeMs) {
        changed.push(`${p}: mtime ${String(b.mtimeMs)} -> ${String(a.mtimeMs)}`);
      }
    }
    if (changed.length > 0) {
      throw new Error(
        `real-home guard (#280): the suite touched the real home's login-unit locations:\n` +
          changed.join("\n"),
      );
    }
  };
}
