/** Service runtime config: env → resolved values. */
import { PINNED_EXTENSION_ID } from "@unvibe/shared";
import { DEFAULT_IDLE_MS } from "./lifecycle/index.js";
import { assertNotRealHomeForWrite, isTestRun, realDataDir, realHomeDir } from "./update/service-manager.js";

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
  /**
   * #322: the one Chrome extension id whose exact origin
   * (`chrome-extension://<id>`) may call `/api/extension/pr-status`.
   * Env `UNVIBE_EXTENSION_ID`; defaults to the pinned id in
   * `extension/manifest.json`. An invalid value allows no extension.
   */
  extensionId: string;
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return realDataDir(env);
}

/**
 * Real-home guard (#313) for the service's data-dir resolution.
 * Throws under a test marker when `dataDir` is the real data dir.
 * Exported so `serve()` can check the resolved config before any write.
 */
export function assertNotRealDataDir(dataDir: string, env: NodeJS.ProcessEnv = process.env): void {
  assertNotRealHomeForWrite({ dataDir }, env);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const port = Number(env.UNVIBE_PORT ?? "4517");
  const idleMs = Number(env.UNVIBE_IDLE_MS ?? String(DEFAULT_IDLE_MS));
  const dataDir = env.UNVIBE_DATA_DIR ?? defaultDataDir(env);
  // Fail fast (#313): an explicitly-pointed real data dir under any test
  // marker, or any real data dir under the harness marker UNVIBE_TEST=1,
  // is refused here. Pure port-only reads pass a bare env without markers
  // (e.g. `{ UNVIBE_PORT }`), so they are unaffected.
  if (env.UNVIBE_DATA_DIR !== undefined && isTestRun(env)) {
    assertNotRealHomeForWrite({ dataDir }, env);
  } else if (env.UNVIBE_TEST === "1") {
    assertNotRealHomeForWrite({ dataDir }, env);
  }
  return {
    host: "127.0.0.1",
    port: Number.isSafeInteger(port) ? port : 4517,
    dataDir,
    idleMs: Number.isFinite(idleMs) ? idleMs : DEFAULT_IDLE_MS,
    extensionId: (env.UNVIBE_EXTENSION_ID ?? PINNED_EXTENSION_ID).trim(),
  };
}

export { realHomeDir };
