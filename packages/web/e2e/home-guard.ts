/**
 * Playwright real-home guard (issue #313, extends #280 to e2e).
 *
 * `globalSetup` snapshots the real login-unit locations' metadata and
 * the real data dir's top-level metadata (exists, mtime, size only —
 * never contents), and the returned teardown fails the run if any
 * changed. The real home is captured at harness start from
 * `os.userInfo().homedir` (falling back to `os.homedir()`), never from
 * a scratch `HOME` a spec may set for its service.
 *
 * Also sets the test markers for the whole run (`UNVIBE_TEST=1` and
 * `UNVIBE_REAL_HOME`) so spawned services/helpers refuse real-home
 * writes at the source (#313).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Meta {
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
}

function realHome(): string {
  try {
    const info = os.userInfo();
    if (info && typeof info.homedir === "string" && info.homedir) return info.homedir;
  } catch {
    // fall through
  }
  return os.homedir();
}

function watchedPaths(home: string): string[] {
  return [
    path.join(home, ".config", "systemd", "user", "unvibe.service"),
    path.join(home, "Library", "LaunchAgents", "com.unvibe.service.plist"),
    // Real data dir: only its top-level mtime/existence is judged.
    path.join(home, ".local", "share", "unvibe"),
  ];
}

function snapshot(paths: string[]): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      out.set(p, { exists: true, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      out.set(p, { exists: false, mtimeMs: null, size: null });
    }
  }
  return out;
}

export default async function homeGuardGlobalSetup(): Promise<() => Promise<void>> {
  const home = realHome();
  // Markers for workers/services spawned by this run. Set here (main
  // process, before workers fork) and also in playwright.config.ts.
  process.env.UNVIBE_TEST = "1";
  if (!process.env.UNVIBE_REAL_HOME) process.env.UNVIBE_REAL_HOME = home;
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
      } else if (b.exists && a.exists && (b.mtimeMs !== a.mtimeMs || b.size !== a.size)) {
        changed.push(`${p}: mtime ${String(b.mtimeMs)} -> ${String(a.mtimeMs)}, size ${String(b.size)} -> ${String(a.size)}`);
      }
    }
    if (changed.length > 0) {
      throw new Error(
        `real-home guard (#313): the e2e run touched the real home's login-unit/data locations:\n` +
          changed.join("\n"),
      );
    }
  };
}
