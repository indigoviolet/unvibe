/** Service runtime config: env → resolved values. */
import os from "node:os";
import path from "node:path";
import { DEFAULT_IDLE_MS } from "./lifecycle/index.js";

export interface ServiceConfig {
  /**
   * Primary bind host: always 127.0.0.1 (PRD §14). `listen()` adds a `::1`
   * companion socket on the same port (issue #108) so the service answers
   * however the browser resolves `unvibe.localhost`. There is deliberately
   * no host knob: no environment variable can move the bind to a routable
   * address.
   */
  host: string;
  port: number;
  dataDir: string;
  /**
   * Idle-exit period in ms (PRD §14, default 10 minutes). The service exits
   * after this long with no open window and no running jobs. Zero or
   * negative disables idle exit. Env `UNVIBE_IDLE_MS`.
   */
  idleMs: number;
}

export function defaultDataDir(): string {
  return path.join(os.homedir(), ".local", "share", "unvibe");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const port = Number(env.UNVIBE_PORT ?? "4517");
  const idleMs = Number(env.UNVIBE_IDLE_MS ?? String(DEFAULT_IDLE_MS));
  return {
    host: "127.0.0.1",
    port: Number.isSafeInteger(port) ? port : 4517,
    dataDir: env.UNVIBE_DATA_DIR ?? defaultDataDir(),
    idleMs: Number.isFinite(idleMs) ? idleMs : DEFAULT_IDLE_MS,
  };
}
