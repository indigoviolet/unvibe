/** Service runtime config: env → resolved values. */
import os from "node:os";
import path from "node:path";

export interface ServiceConfig {
  /** Bind host: always 127.0.0.1 (PRD §14). */
  host: string;
  port: number;
  dataDir: string;
}

export function defaultDataDir(): string {
  return path.join(os.homedir(), ".local", "share", "unvibe");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const port = Number(env.UNVIBE_PORT ?? "4517");
  return {
    host: "127.0.0.1",
    port: Number.isSafeInteger(port) ? port : 4517,
    dataDir: env.UNVIBE_DATA_DIR ?? defaultDataDir(),
  };
}
