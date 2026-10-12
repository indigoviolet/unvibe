/**
 * Global npm install of an update channel ref (issue #36).
 *
 * One small step: build the `npm install -g github:<repo>#<ref>` command
 * for a validated channel and run it through the injectable command
 * runner (tests stub it; production passes the real one). No service
 * lifecycle here — callers refuse while the service runs and never
 * restart it (the step-2 branch owns any restart behaviour).
 */
import type { CommandRunner, RunResult } from "../exec/index.js";
import { UNVIBE_REPO, channelRef, isChannelName } from "./channels.js";

/** `npm install -g` spec for a channel. Throws on invalid names. */
export function installSpec(channel: string): string {
  if (!isChannelName(channel)) throw new Error(`unknown channel: ${JSON.stringify(channel)}`);
  return `github:${UNVIBE_REPO}#${channelRef(channel)}`;
}

/** Install the channel's ref globally. The caller reports the result. */
export async function installRef(runner: CommandRunner, channel: string): Promise<RunResult> {
  return runner.run("npm", { args: ["install", "-g", installSpec(channel)] });
}
