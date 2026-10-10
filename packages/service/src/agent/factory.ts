/**
 * AgentRunner factory (M3 pipeline).
 *
 * Runner selection: `UNVIBE_AGENT=replay` (or the `UNVIBE_AGENT` env set to
 * `replay`) uses the recorded-session runner over
 * `fixtures/urllib3-5020/`, so the whole product runs without tokens in
 * tests and demo mode. Any other value selects the real ACP runner.
 *
 * ACP SEAM (not yet merged): the real branch lives in `src/agent/acp/` and
 * is owned by a parallel agent. This factory deliberately does NOT import
 * ACP. When that branch merges, replace `acpNotMerged` with
 * `new AcpAgentRunner(...)` (it will also expose `listModels(provider)` for
 * Settings → Models; see `settings/models.ts`). Until then, non-replay
 * selection fails with a helpful error instead of a missing-import crash.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunner } from "@unvibe/shared";
import { ReplayAgentRunner } from "../replay/runner.js";

export interface CreateRunnerOptions {
  env?: NodeJS.ProcessEnv;
  /** Override for tests. */
  fixturesDir?: string;
  /** Streaming delay for demo realism (ms between chunks). */
  delayMs?: number;
  /** Text-chunk size for streaming. */
  chunkChars?: number;
}

export function defaultFixturesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromDist = path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020");
  if (fs.existsSync(fromDist)) return fromDist;
  return path.resolve(process.cwd(), "fixtures", "urllib3-5020");
}

export function isReplayEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.UNVIBE_AGENT ?? "").toLowerCase() === "replay";
}

function acpNotMerged(): never {
  throw new Error(
    "ACP AgentRunner not yet merged (branch `acp-runner` owns src/agent/acp/). " +
      "Run with UNVIBE_AGENT=replay for the recorded demo, or wait for the ACP branch. " +
      "When it merges, this factory returns the ACP runner (with listModels(provider)) instead of throwing.",
  );
}

/**
 * Create the configured AgentRunner. Tests inject fakes directly and never
 * call this; production (`src/index.ts`) and `createApp` call it when no
 * explicit runner is provided.
 */
export function createAgentRunner(opts: CreateRunnerOptions = {}): AgentRunner {
  const env = opts.env ?? process.env;
  if (isReplayEnv(env)) {
    const dir =
      opts.fixturesDir ??
      (() => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const fromDist = path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020");
        if (fs.existsSync(fromDist)) return fromDist;
        const fromCwd = path.resolve(process.cwd(), "fixtures", "urllib3-5020");
        if (fs.existsSync(fromCwd)) return fromCwd;
        return fromDist;
      })();
    return new ReplayAgentRunner({
      fixturesDir: dir,
      ...(opts.chunkChars !== undefined ? { chunkChars: opts.chunkChars } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : { delayMs: 5 }),
    });
  }
  return acpNotMerged();
}

/** True when the runner serves recordings (replay/demo path). */
export function isReplayRunner(runner: AgentRunner): boolean {
  // ReplayAgentRunner has a `resolve(prompt)` method; the interface does not.
  return typeof (runner as unknown as { resolve?: unknown }).resolve === "function";
}
