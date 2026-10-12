/**
 * `unvibe update` flows (issue #36): thin CLI composition over the shared
 * `../update/switch.ts` core. The in-app picker's `Updater` calls the same
 * core through a service route; nothing here restarts the service — a live
 * service is refused with a pointer to `unvibe stop`.
 */
import type { CommandRunner } from "../exec/index.js";
import {
  formatChannelList,
  isChannelName,
  listChannels,
  readInstalledBuild,
} from "../update/channels.js";
import { runSwitchCore } from "../update/switch.js";
import { DB_RULE } from "../update/data-backup.js";

export const UPDATE_USAGE = [
  "unvibe update: install a different channel",
  "",
  "Usage: unvibe update --list",
  "       unvibe update <channel>",
  "",
  "  --list       list release, release-rc and preview/* channels, marking the installed one",
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
        "fix with: gh auth login (then gh auth setup-git so git can fetch)",
      ],
    };
  }
}

/** Install a channel: backup, npm install (verified), keep the live DB. Never runs live. */
export async function runUpdateChannelFlow(deps: UpdateDeps, channel: string): Promise<UpdateOutcome> {
  if (!isChannelName(channel)) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "use release, release-rc or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const result = await runSwitchCore({
    runner: deps.runner,
    dataDir: deps.dataDir,
    serviceScriptPath: deps.cliScriptPath,
    serviceVersion: deps.serviceVersion,
    channel,
    log: () => {},
  });
  if (result.code === 2) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "use release, release-rc or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const lines = [...result.lines];
  if (result.code === 0 && result.installed) lines.push("run `unvibe start` to launch the new build.");
  return { code: result.code, lines };
}
