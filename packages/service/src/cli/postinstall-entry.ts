#!/usr/bin/env node
/**
 * Bundled npm `postinstall` entry (issue #42), built to
 * `dist/postinstall.js` and shipped only in the release tree — the
 * source tree declares no lifecycle scripts, so `npm install` in a dev
 * checkout never runs it. npm runs it with the installed package as cwd
 * after a global install; it delegates to `runPostinstall`, whose guards
 * (see `cli/setup/postinstall.ts`) decide whether setup may run.
 *
 * It must never fail the install: every path exits 0, and any setup
 * failure prints one line naming `unvibe setup` instead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { isPidAlive, readLock } from "./lock.js";
import { pendingPath } from "../update/state.js";
import { installedCliPath, isInstalledLayout, POSTINSTALL_HINT, runPostinstall } from "./setup/postinstall.js";
import { realSetupRunner, type SetupPaths } from "./setup/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  let homeDir: string | null = null;
  try {
    homeDir = os.homedir() || null;
  } catch {
    homeDir = null;
  }
  const lock = readLock(config.dataDir);
  const paths: SetupPaths = {
    homeDir: homeDir ?? "",
    nodePath: process.execPath,
    cliPath: installedCliPath(path.dirname(fileURLToPath(import.meta.url))),
  };
  await runPostinstall({
    env: process.env,
    platform: process.platform,
    homeDir,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    switchPending: fs.existsSync(pendingPath(config.dataDir)),
    serviceRunning: lock !== null && isPidAlive(lock.pid),
    inInstalledLayout: isInstalledLayout(path.dirname(fileURLToPath(import.meta.url))),
    paths,
    port: config.port,
    dataDir: config.dataDir,
    runner: realSetupRunner(),
    ensureToken: (dataDir) => void loadOrCreateToken(dataDir),
    log: (line) => console.log(line),
  });
}

main().then(
  () => process.exit(0),
  () => {
    console.log(POSTINSTALL_HINT);
    process.exit(0);
  },
);
