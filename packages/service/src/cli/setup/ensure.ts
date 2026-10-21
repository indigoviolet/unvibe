/**
 * Setup-once-per-version (issue #42).
 *
 * The release package declares no lifecycle scripts (a script makes
 * npm link a git install to its temporary preparation clone and then
 * delete the clone, dangling the bin), so setup cannot run at install
 * time. The marker `<dataDir>/setup-version` records the version setup
 * last completed for; `unvibe start` (and `open`) run setup when the
 * marker does not match the running version, and every successful
 * setup — manual `unvibe setup`, update-time setup — records it.
 * Idempotent (setup itself is) and quiet: nothing is printed when the
 * marker already matches, and a failure only warns — start must not
 * fail because setup could not run.
 */
import fs from "node:fs";
import path from "node:path";
import { installSetup, type SetupPaths, type SetupRunner } from "./index.js";

export function setupVersionPath(dataDir: string): string {
  return path.join(dataDir, "setup-version");
}

/** Version setup last completed for, or null when never recorded. */
export function readSetupVersion(dataDir: string): string | null {
  try {
    const v = fs.readFileSync(setupVersionPath(dataDir), "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Record that setup completed for `version`. Best-effort. */
export function writeSetupVersion(dataDir: string, version: string): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(setupVersionPath(dataDir), `${version}\n`);
  } catch {
    // A marker that cannot be written just means start checks again.
  }
}

export interface EnsureSetupDeps {
  version: string;
  dataDir: string;
  port: number;
  homeDir: string | null;
  platform: string;
  paths: SetupPaths;
  runner?: SetupRunner;
  ensureToken: (dataDir: string) => void;
  log: (line: string) => void;
  install?: typeof installSetup;
}

/**
 * Run setup when it has not been done for this version. Returns true
 * when setup ran. Never throws.
 */
export async function ensureSetupForVersion(deps: EnsureSetupDeps): Promise<boolean> {
  if (!deps.version || readSetupVersion(deps.dataDir) === deps.version) return false;
  if (!deps.homeDir || (deps.platform !== "darwin" && deps.platform !== "linux")) {
    deps.log("setup has not run for this version yet; run `unvibe setup` to finish installing.");
    return false;
  }
  try {
    deps.ensureToken(deps.dataDir);
    const install = deps.install ?? installSetup;
    await install(deps.paths, deps.runner, deps.platform, { port: deps.port, dataDir: deps.dataDir });
    writeSetupVersion(deps.dataDir, deps.version);
    return true;
  } catch {
    deps.log("setup has not run for this version yet; run `unvibe setup` to finish installing.");
    return false;
  }
}
