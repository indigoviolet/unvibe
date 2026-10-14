/**
 * AgentRunner factory (M3 pipeline + ACP default).
 *
 * Runner selection:
 * - `UNVIBE_AGENT=replay` uses the recorded-session runner over
 *   `fixtures/urllib3-5020/`, so the whole product runs without tokens in
 *   tests and demo mode. On a non-fixture repo the recordings still match
 *   (they are keyword/marker matched, not repo scoped), so replay writes
 *   the fixture's guide content there — only use it on the fixture or in
 *   specs that test agent behaviour (demo review, second opinion).
 * - `UNVIBE_AGENT=none` disables the pipeline: `startReview`/`resumeReview`
 *   enqueue nothing and every agent call fails fast with a clear "no agent
 *   configured" error. Use it in real-service specs that do not test agent
 *   behaviour (comments, diff, versions), so no background pipeline mutates
 *   the review mid-test.
 * - The default (unset or anything else) is the real ACP runner
 *   (`src/agent/acp/`, via `createAcpRunner()`): one subprocess per
 *   provider (claude/codex), multiplexing all sessions.
 *
 * Provider + model per role come from settings (main, small, second
 * opinion); the pipeline passes them to `runner.start({provider, model,
 * ...})` and the ACP runner selects them via `session/set_config_option`.
 * `listModels(provider)` is wired into the settings model catalog (see
 * `src/app.ts: AcpModelCatalog`).
 *
 * This module never imports `@agentclientprotocol/*` directly
 * (lint-enforced): it goes through `./acp-runner.js`, which re-exports the
 * runner built inside `acp/`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunner } from "@unvibe/shared";
import { NoAgentRunner } from "./none.js";
import { ReplayAgentRunner } from "../replay/runner.js";
import { createAcpRunner } from "./acp-runner.js";

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
  return resolveFixturesDir();
}

/**
 * Locate `fixtures/urllib3-5020` relative to the module when possible (so
 * the esbuild bundle + global install find it outside the repo), falling
 * back to the cwd (dev/tests running from the repo root).
 */
export function resolveFixturesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src layout:  packages/service/src/agent/ → ../../../../fixtures
  // dist bundle: packages/service/dist/index.js → ../../../fixtures
  // (esbuild bundles to a single dist/index.js, so 3 ups reach the root).
  const candidates = [
    path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020"),
    path.resolve(here, "..", "..", "..", "fixtures", "urllib3-5020"),
    path.resolve(process.cwd(), "fixtures", "urllib3-5020"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "manifest.json"))) return c;
    } catch {
      // try next
    }
  }
  return candidates[0];
}

export function isReplayEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.UNVIBE_AGENT ?? "").toLowerCase() === "replay";
}

export function isNoneEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.UNVIBE_AGENT ?? "").toLowerCase() === "none";
}

/**
 * Create the configured AgentRunner. Tests inject fakes directly and never
 * call this; `buildApp` calls it when no explicit runner is provided.
 */
export function createAgentRunner(opts: CreateRunnerOptions = {}): AgentRunner {
  const env = opts.env ?? process.env;
  if (isNoneEnv(env)) {
    return new NoAgentRunner();
  }
  if (isReplayEnv(env)) {
    const dir = opts.fixturesDir ?? resolveFixturesDir();
    // Test/drill-only pacing overrides (issue #126 timing runs): stream
    // the recordings at a chosen chunk size and delay. Never read by the
    // UI; production stays at the 5 ms default.
    const envDelay = Number(env["UNVIBE_REPLAY_DELAY_MS"] ?? "");
    const envChunks = Number(env["UNVIBE_REPLAY_CHUNK_CHARS"] ?? "");
    return new ReplayAgentRunner({
      fixturesDir: dir,
      ...(opts.chunkChars !== undefined
        ? { chunkChars: opts.chunkChars }
        : Number.isSafeInteger(envChunks) && envChunks > 0
          ? { chunkChars: envChunks }
          : {}),
      ...(opts.delayMs !== undefined
        ? { delayMs: opts.delayMs }
        : Number.isSafeInteger(envDelay) && envDelay >= 0
          ? { delayMs: envDelay }
          : { delayMs: 5 }),
    });
  }
  return createAcpRunner();
}

/** True when the runner serves recordings (replay/demo path). */
export function isReplayRunner(runner: AgentRunner): boolean {
  // ReplayAgentRunner has a `resolve(prompt)` method; the interface does not.
  return typeof (runner as unknown as { resolve?: unknown }).resolve === "function";
}

/** True when the pipeline is disabled (`UNVIBE_AGENT=none`). */
export function isNoneRunner(runner: AgentRunner): boolean {
  return (runner as unknown as { none?: unknown }).none === true;
}

/** True when the runner is the real ACP runner (has listModels/dispose). */
export function isAcpRunner(
  runner: AgentRunner,
): runner is AgentRunner & { listModels: (p: string) => Promise<unknown[]>; dispose: () => Promise<void> } {
  const r = runner as unknown as { listModels?: unknown; dispose?: unknown };
  return typeof r.listModels === "function" && typeof r.dispose === "function";
}
