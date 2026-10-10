/**
 * Single-instance lock (PRD §14): a JSON pid file in the data dir with
 * stale-lock detection. A second `unvibe start` reuses the running service
 * instead of starting another one.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export interface ServiceLock {
  pid: number;
  port: number;
  startedAt: string;
}

export function lockFilePath(dataDir: string): string {
  return path.join(dataDir, "unvibe.lock");
}

/** Read the lock, or null when missing or corrupt (treated as no lock). */
export function readLock(dataDir: string): ServiceLock | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockFilePath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceLock>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.port !== "number" ||
      !Number.isInteger(parsed.port)
    ) {
      return null;
    }
    return { pid: parsed.pid, port: parsed.port, startedAt: String(parsed.startedAt ?? "") };
  } catch {
    return null;
  }
}

export function writeLock(dataDir: string, lock: ServiceLock): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lockFilePath(dataDir), JSON.stringify(lock) + "\n");
}

/** Remove the lock only when it belongs to `pid` (never steal a successor). */
export function removeOwnLock(dataDir: string, pid: number): void {
  const current = readLock(dataDir);
  if (current && current.pid !== pid) return;
  removeLock(dataDir);
}

export function removeLock(dataDir: string): void {
  try {
    fs.unlinkSync(lockFilePath(dataDir));
  } catch {
    // missing already: fine
  }
}

/**
 * True when a process with this pid exists. `kill(pid, 0)` throws ESRCH
 * for a dead pid; EPERM means it exists but belongs to another user.
 * Never throws.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

/** True when something answers `/api/health` on 127.0.0.1:port. */
export function isHealthOk(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });
}

/**
 * Wait (polling) until `/api/health` answers or the deadline passes.
 * Resolves true on success, false on timeout.
 */
export async function waitForHealth(
  port: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isHealthOk(port)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
