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
import fs from "node:fs";
import type { UpdateBuildInfo } from "@unvibe/shared";
import { readInstalledBuild } from "./channels.js";
import { defaultFakeChannels, type FakeInstalledOverride, loadFakeSpecs } from "./updater.js";
import { fakeInstalledPath, readCurrentRef } from "./state.js";

export interface BuildInfoInputs {
  dataDir: string;
  /** Service entry path (`process.argv[1]` of the service process). */
  serviceScriptPath?: string;
  serviceVersion: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Test-only installed-build override (issue #231): partial fields from
 * `<dataDir>/update/fake-installed.json`, so the installed build can read
 * older than the published spec on the same ref. Unknown shape (or an
 * unreadable file) means no override.
 */
export function readFakeInstalledOverride(dataDir: string): FakeInstalledOverride | null {
  let raw: string;
  try {
    raw = fs.readFileSync(fakeInstalledPath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as FakeInstalledOverride;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Test-only: resolve the fake backend's current channel without an Updater instance (health path). */
export function fakeBuildInfo(dataDir: string): UpdateBuildInfo | null {
  const specs = loadFakeSpecs(dataDir, defaultFakeChannels());
  const current = readCurrentRef(dataDir) ?? "release";
  const found = specs.find((c) => c?.ref === current);
  if (!found || typeof found.version !== "string" || found.version === "") return null;
  const over = readFakeInstalledOverride(dataDir);
  return {
    version: strOrNull(over?.version) ?? found.version,
    channel: strOrNull(over?.channel) ?? current,
    sourceBranch: strOrNull(over?.sourceBranch) ?? (typeof found.sourceBranch === "string" ? found.sourceBranch : null),
    sourceCommit: strOrNull(over?.sourceCommit) ?? (typeof found.sourceCommit === "string" ? found.sourceCommit : null),
    baseBranch: strOrNull(over?.baseBranch) ?? (typeof found.baseBranch === "string" ? found.baseBranch : null),
    baseCommit: strOrNull(over?.baseCommit) ?? (typeof found.baseCommit === "string" ? found.baseCommit : null),
    commit: strOrNull(over?.commit) ?? (typeof found.commit === "string" ? found.commit : null),
    builtAt: strOrNull(over?.builtAt) ?? (typeof found.builtAt === "string" ? found.builtAt : null),
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
    channel: installed.channel,
    sourceBranch: installed.sourceBranch,
    sourceCommit: installed.sourceCommit,
    baseBranch: installed.baseBranch,
    baseCommit: installed.baseCommit,
    commit: installed.commit,
    builtAt: installed.builtAt,
  };
}
