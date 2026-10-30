/**
 * `unvibe update` flows (issue #36): thin CLI composition over the shared
 * `../update/switch.ts` core. The in-app picker's `Updater` calls the same
 * core through a service route; nothing here restarts the service — a live
 * service is refused with a pointer to `unvibe stop`.
 */
import os from "node:os";
import type { CommandRunner } from "../exec/index.js";
import { loadConfig } from "../config.js";
import {
  formatChannelList,
  isChannelName,
  listChannels,
  readInstalledBuild,
} from "../update/channels.js";
import { runSwitchCore } from "../update/switch.js";
import { DB_RULE } from "../update/data-backup.js";
import { refreshLoginUnitIfManaged } from "../update/service-manager.js";
import { isNpxCachePath, UPDATE_NPX_MESSAGE } from "./npx.js";

export const UPDATE_USAGE = [
  "unvibe update: install a different channel",
  "",
  "Usage: unvibe update --list",
  "       unvibe update <channel>",
  "",
  "  --list       list release and preview/* channels, marking the installed one",
  "  <channel>    install github:indigoviolet/unvibe#<channel> globally with npm",
  "",
  DB_RULE,
  "Stop the service first (`unvibe stop`) and start it again afterwards (`unvibe start`).",
].join("\n");

export interface UpdateDeps {
  runner: CommandRunner;
  dataDir: string;
  cliScriptPath: string | undefined;
  serviceVersion: string;
  /**
   * Login-shell-merged PATH for the npm spawn (issue #170), resolved by the
   * caller (`cli/commands.ts`) so this flow stays pure for tests. Undefined
   * inherits the process env.
   */
  updateEnv?: { PATH: string };
  /**
   * Home dir for the login-unit refresh (issue #280). Production omits it
   * (real `os.homedir()`); tests pass a scratch dir so a managed real home
   * is never rewritten.
   */
  /** #311: the user accepted the data-reset warning for a format-changing update (`--yes`). */
  acceptDataReset?: boolean;
  homeDir?: string;
  /**
   * Platform for the login-unit refresh (issue #280). Production omits it
   * (real `process.platform`); tests pass an explicit value with the scratch
   * home.
   */
  platform?: string;
}

export interface UpdateOutcome {
  code: number;
  lines: string[];
}

/** List channels via `gh`, marking the installed one. */
export async function runUpdateListFlow(deps: UpdateDeps): Promise<UpdateOutcome> {
  const installed = readInstalledBuild(deps.cliScriptPath, deps.serviceVersion);
  try {
    const channels = await listChannels(deps.runner, installed);
    return {
      code: 0,
      lines: [
        `installed: ${installed.channel ?? "(unknown channel)"} ${installed.version}`,
        ...formatChannelList(channels, installed),
      ],
    };
  } catch (err) {
    return {
      code: 1,
      lines: [
        err instanceof Error ? err.message : String(err),
        "check the network and retry; a broken gh login can also cause this (`gh auth login`)",
      ],
    };
  }
}

/** Install a channel: backup, npm install (verified), keep the live DB. Never runs live. */
export async function runUpdateChannelFlow(deps: UpdateDeps, channel: string): Promise<UpdateOutcome> {
  // Issue #277: refuse before touching anything (backup, npm) — an npx
  // install has no prefix to pin, so npm would write into whatever global
  // prefix happens to be default while the npx copy keeps running.
  if (isNpxCachePath(deps.cliScriptPath)) {
    return { code: 1, lines: [UPDATE_NPX_MESSAGE] };
  }
  if (!isChannelName(channel)) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "use release or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const result = await runSwitchCore({
    ...(deps.acceptDataReset ? { acceptDataReset: true } : {}),
    runner: deps.runner,
    dataDir: deps.dataDir,
    serviceScriptPath: deps.cliScriptPath,
    serviceVersion: deps.serviceVersion,
    channel,
    env: deps.updateEnv,
    ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
    log: () => {},
  });
  if (result.code === 2) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "use release or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const lines = [...result.lines];
  if (result.code === 0 && result.installed) {
    // No automatic setup (issue #220): `unvibe setup` is a manual step.
    lines.push("run `unvibe start` to launch the new build.");
    // The global install can move the installed files (and a Node upgrade
    // moves the node binary): refresh the login unit with the fresh paths
    // (Q2). The entry is renewed in place under the pinned prefix, so the
    // running CLI's own path is the new one; the node is this process's.
    const cliPath = deps.cliScriptPath;
    if (cliPath) {
      const refreshed = refreshLoginUnitIfManaged(deps.homeDir ?? os.homedir(), deps.platform ?? process.platform, {
        nodePath: process.execPath,
        cliPath,
        // Port only: a bare env avoids the #313 data-dir guard in loadConfig.
        port: loadConfig({ UNVIBE_PORT: process.env.UNVIBE_PORT }).port,
        dataDir: deps.dataDir,
      });
      if (refreshed) lines.push("login start refreshed for the new build.");
    }
  }
  return { code: result.code, lines };
}
