/**
 * Running-build identity (issue #36).
 *
 * Surfaced on `GET /api/health` (`build`) and `GET /api/update/status`
 * (`build`), so the web app can show which build it talks to and the
 * helper can poll for the target version after a restart. Null when the
 * install carries no channel record (source checkout, old build — the
 * plain `version` field still carries `SERVICE_VERSION`).
 *
 * One source: the installed package.json (`unvibe` field, written by
 * `scripts/release.mjs`), read with step 1's `readInstalledBuild` — the
 * same record the CLI and the switch core use. No second stamp mechanism.
 * The fake backend (`UNVIBE_UPDATER_BACKEND=fake`, test-only) resolves the
 * current fake channel instead, so a fake switch visibly changes the
 * reported version.
 */
import type { UpdateBuildInfo } from "@unvibe/shared";
import { readInstalledBuild } from "./channels.js";
import { defaultFakeChannels, loadFakeSpecs } from "./updater.js";
import { readCurrentRef } from "./state.js";

export interface BuildInfoInputs {
  dataDir: string;
  /** Service entry path (`process.argv[1]` of the service process). */
  serviceScriptPath?: string;
  serviceVersion: string;
  env?: NodeJS.ProcessEnv;
}

/** Test-only: resolve the fake backend's current channel without an Updater instance (health path). */
export function fakeBuildInfo(dataDir: string): UpdateBuildInfo | null {
  const specs = loadFakeSpecs(dataDir, defaultFakeChannels());
  const current = readCurrentRef(dataDir) ?? "release";
  const found = specs.find((c) => c?.ref === current);
  if (!found || typeof found.version !== "string" || found.version === "") return null;
  return {
    version: found.version,
    sourceBranch: typeof found.sourceBranch === "string" ? found.sourceBranch : null,
    commit: typeof found.commit === "string" ? found.commit : null,
    builtAt: typeof found.builtAt === "string" ? found.builtAt : null,
  };
}

export function resolveBuildInfo(inputs: BuildInfoInputs): UpdateBuildInfo | null {
  const env = inputs.env ?? process.env;
  if (env.UNVIBE_UPDATER_BACKEND === "fake") {
    return fakeBuildInfo(inputs.dataDir);
  }
  const installed = readInstalledBuild(inputs.serviceScriptPath, inputs.serviceVersion);
  if (!installed.channel) return null;
  return {
    version: installed.version,
    sourceBranch: installed.sourceBranch,
    commit: installed.commit,
    builtAt: installed.builtAt,
  };
}
