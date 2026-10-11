/**
 * Shared harness for the real-service Playwright specs.
 *
 * Spawns the built service (`mise run build` first) on an ephemeral port
 * with a caller-provided data dir, parses its origin + token from stdout,
 * and tees all child output to `test-results/service-logs/` so CI can
 * upload service logs as artifacts on failure.
 *
 * Conventions (AGENTS.md / DEVELOPMENT.md):
 * - `UNVIBE_AGENT` is always explicit (`none` unless the spec passes
 *   `agent: "replay"`): no spec may start real agents.
 * - `GITHUB_TOKEN` is never passed through: `gh` must use the login, never
 *   the ambient CI token (PRD §15).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_ENTRY = fileURLToPath(new URL("../../service/dist/index.js", import.meta.url));

const LOG_DIR = fileURLToPath(new URL("../test-results/service-logs", import.meta.url));

export interface RunningService {
  origin: string;
  token: string;
  /** Path of the tee'd service log (kept under test-results/ for CI upload). */
  logFile: string;
  stop: () => Promise<void>;
}

export interface StartServiceOptions {
  /** Agent mode for the spawned service. Default `"none"` (pipeline disabled). */
  agent?: string;
  /** Extra env entries for the child (e.g. the fake-gh SHELL/PATH stub). */
  extraEnv?: Record<string, string | undefined>;
  /** Log-file tag. Defaults to the data dir's basename. */
  label?: string;
}

/** Spawn the built service on an ephemeral port; parse origin + token. */
export async function startService(dataDir: string, opts: StartServiceOptions = {}): Promise<RunningService> {
  if (!existsSync(SERVICE_ENTRY)) {
    throw new Error(`service not built: run \`mise run build\` first (missing ${SERVICE_ENTRY})`);
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const label = (opts.label ?? path.basename(dataDir)).replace(/[^A-Za-z0-9_.-]+/g, "_");
  const logFile = path.join(LOG_DIR, `service-${label}.log`);
  const log = (chunk: Buffer | string) => {
    try {
      appendFileSync(logFile, chunk);
    } catch {
      // Logging must never fail the test.
    }
  };
  log(`--- startService dataDir=${dataDir} agent=${opts.agent ?? "none"} at ${new Date().toISOString()} ---\n`);

  const env: Record<string, string | undefined> = { ...process.env, ...opts.extraEnv };
  delete env.GITHUB_TOKEN;
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...env,
      UNVIBE_DATA_DIR: dataDir,
      UNVIBE_PORT: "0",
      UNVIBE_REPO_ROOTS: "",
      // No agent behaviour under test unless the spec opts into replay:
      // a background pipeline must not mutate the review mid-test.
      UNVIBE_AGENT: opts.agent ?? "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const started = new Promise<{ origin: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start (see ${logFile}): ${out}`)), 30_000);
    proc.stdout?.on("data", (d: Buffer) => {
      log(d);
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.stderr?.on("data", (d: Buffer) => {
      log(d);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code} (see ${logFile}): ${out}`));
      }
    });
  });
  const { origin, token } = await started;
  return {
    origin,
    token,
    logFile,
    stop: () =>
      new Promise<void>((resolve) => {
        log(`--- stop at ${new Date().toISOString()} ---\n`);
        proc.on("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
          resolve();
        }, 5000).unref?.();
      }),
  };
}
