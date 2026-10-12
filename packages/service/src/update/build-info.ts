/**
 * Running-build identity (issue #36, step 2).
 *
 * Surfaced on `GET /api/health` (`build`) and `GET /api/update/status`
 * (`build`), so the web app can show which build it talks to and the
 * helper can poll for the target version after a restart. Null when the
 * build carries no preview metadata (plain release / dev / unwired — the
 * plain `version` field still carries `SERVICE_VERSION`).
 *
 * Sources, in order:
 * 1. Fake backend (`UNVIBE_UPDATER_BACKEND=fake`, test-only): the current
 *    fake channel (same `loadFakeSpecs` + `current-ref` the `FakeUpdater`
 *    uses), so a fake switch visibly changes the reported version.
 * 2. Stamped `build-info.json` beside the loaded bundle (`dist/`): the
 *    merge seam where step 1's `scripts/release.mjs` records the preview
 *    version, source branch, commit and build time. Best-effort — absent
 *    or corrupt means null.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UpdateBuildInfo } from "@unvibe/shared";
import { defaultFakeChannels, loadFakeSpecs } from "./updater.js";
import { readCurrentRef } from "./state.js";

export interface BuildInfoInputs {
  dataDir: string;
  /** Directory holding `build-info.json`. Defaults to the loaded bundle's dir. */
  distDir?: string;
  env?: NodeJS.ProcessEnv;
}

/** dist dir of the currently loaded bundle (`dist/` in prod, `src/update/` under vitest). */
export function bundleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

interface StampedBuild {
  version?: unknown;
  sourceBranch?: unknown;
  commit?: unknown;
  builtAt?: unknown;
}

function fromStamp(stamp: StampedBuild): UpdateBuildInfo | null {
  if (typeof stamp.version !== "string" || stamp.version === "") return null;
  return {
    version: stamp.version,
    sourceBranch: typeof stamp.sourceBranch === "string" ? stamp.sourceBranch : null,
    commit: typeof stamp.commit === "string" ? stamp.commit : null,
    builtAt: typeof stamp.builtAt === "string" ? stamp.builtAt : null,
  };
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
  const dir = inputs.distDir ?? bundleDir();
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, "build-info.json"), "utf8");
  } catch {
    return null;
  }
  try {
    return fromStamp(JSON.parse(raw) as StampedBuild);
  } catch {
    return null;
  }
}
