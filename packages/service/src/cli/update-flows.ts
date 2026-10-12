/**
 * `unvibe update` flows (issue #36, step 1): thin composition of the plain
 * `../update/` modules for the CLI. The step-2 `Updater.switchTo` will
 * compose the same modules through a service route; nothing here restarts
 * the service — a live service is refused with a pointer to `unvibe stop`.
 */
import type { CommandRunner } from "../exec/index.js";
import { isPidAlive, readLock } from "./lock.js";
import { DB_RULE, backupChannel, hasBackup, restoreChannel, seedFromSlot } from "../update/data-backup.js";
import {
  fetchRefPackage,
  formatChannelList,
  isChannelName,
  isPreviewChannel,
  listChannels,
  readInstalledBuild,
  shortCommit,
} from "../update/channels.js";
import type { InstalledBuild } from "../update/channels.js";
import { installPrefixForPackage, installRef, installSpec } from "../update/install.js";

export const UPDATE_USAGE = [
  "unvibe update — switch the installed build between channels (issue #36)",
  "",
  "Usage: unvibe update --list",
  "       unvibe update <channel> [--keep-data]",
  "",
  "  --list       list release, release-rc and preview/* channels, marking the installed one",
  "  <channel>    install github:indigoviolet/unvibe#<channel> globally with npm",
  "  --keep-data  keep the live database instead of restoring the target channel's copy",
  "",
  "Each channel keeps its own database copy under <dataDir>/channel-backups/: " +
    "switching restores the target's copy when one exists, and a new preview never " +
    "inherits another preview's database (it starts from the release copy, or the " +
    "switch stops first — --keep-data keeps the live database instead).",
  "Stop the service first (`unvibe stop`), then `unvibe start` afterwards.",
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

export interface UpdateChannelOptions {
  keepData: boolean;
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

/** Install a channel: backup, npm install (verified), restore. Never runs live. */
export async function runUpdateChannelFlow(
  deps: UpdateDeps,
  channel: string,
  opts: UpdateChannelOptions,
): Promise<UpdateOutcome> {
  if (!isChannelName(channel)) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "want release, release-rc, or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const lock = readLock(deps.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    const flag = opts.keepData ? " --keep-data" : "";
    return {
      code: 1,
      lines: [
        `the service is running (pid ${lock.pid} on port ${lock.port}) — stop it first:`,
        "  unvibe stop",
        `  unvibe update ${channel}${flag}`,
        "  unvibe start",
      ],
    };
  }
  const before = readInstalledBuild(deps.cliScriptPath, deps.serviceVersion);
  // Remote metadata for the target: same-build compare and post-install
  // verification. Unreadable metadata only weakens the checks, never blocks.
  const remote = await fetchRefPackage(deps.runner, channel);

  if (before.channel === channel) {
    return runSameChannelReinstall(deps, channel, before, remote.commit);
  }

  // Different channel: decide the database plan BEFORE installing, so a
  // missing seed stops the switch while the live database is still intact.
  const plan = dbPlanForSwitch(deps.dataDir, channel, before.channel, opts.keepData);
  if (plan.kind === "abort") {
    return {
      code: 1,
      lines: [
        `no database copy for ${channel}, and no release or release-rc copy to start it from — refusing to install (the live ${before.channel} database would carry over).`,
        `switch via release first, or pass --keep-data to keep the live database anyway: unvibe update ${channel} --keep-data`,
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`current: ${before.channel ?? "(unknown channel)"} ${before.version}`);
  const backup = backupChannel(deps.dataDir, before.channel);
  if (backup.files.length > 0) {
    lines.push(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  } else {
    lines.push(`no database in ${deps.dataDir} to back up (fresh machine?)`);
  }
  if (plan.kind === "seed") {
    lines.push(`no copy for ${channel} yet — will start it from the ${plan.from} copy after install`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  lines.push(`installing ${installSpec(channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(deps.runner, channel, { prefix });
  if (inst.code !== 0) {
    const tail = `${inst.stdout}\n${inst.stderr}`.trim().split("\n").slice(-10).join("\n");
    lines.push(`npm install failed (exit ${inst.code}):`);
    if (tail) lines.push(tail);
    lines.push(
      backup.files.length > 0
        ? `the live database is untouched; the pre-switch copy is in ${backup.dir}`
        : "the live database is untouched.",
    );
    return { code: 1, lines };
  }
  // Verify the install landed where this binary lives: npm uses whatever
  // prefix is first on PATH, which may not be ours (multiple node
  // versions, minimal-PATH helpers). Never swap databases on a miss.
  const after = readInstalledBuild(deps.cliScriptPath, before.version);
  if (after.channel !== channel || (remote.commit && after.commit !== remote.commit)) {
    const prefixOut = await npmGlobalPrefix(deps.runner);
    lines.push(`installed ${channel} ${after.version} (was ${before.version})`);
    lines.push(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    lines.push(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(channel)}. ` +
        `The live database is untouched` +
        (backup.files.length > 0 ? `; the pre-switch copy is in ${backup.dir}` : "."),
    );
    return { code: 1, lines };
  }
  lines.push(`installed ${channel} ${after.version} (was ${before.version})`);
  if (plan.kind === "keep") {
    if (opts.keepData) {
      lines.push(
        `--keep-data: keeping the live database (the ${before.channel ?? "previous"} copy stays in ${backup.dir})`,
      );
    } else {
      lines.push(`no backup for ${channel} yet — keeping the live database`);
    }
  } else if (plan.kind === "restore") {
    const restored = restoreChannel(deps.dataDir, channel);
    lines.push(`restored ${restored.files.join(", ")} from ${restored.dir}`);
  } else {
    const seeded = seedFromSlot(deps.dataDir, plan.from);
    lines.push(`started ${channel} from the ${plan.from} copy (${seeded.files.join(", ")})`);
  }
  lines.push(DB_RULE);
  lines.push("run `unvibe start` to launch the new build.");
  return { code: 0, lines };
}

type DbPlan =
  | { kind: "keep" }
  | { kind: "restore" }
  | { kind: "seed"; from: string }
  | { kind: "abort" };

/**
 * Database plan for leaving `from` for `to` (decided before installing).
 * A new preview never inherits another preview's database: with no copy
 * of its own it starts from the release copy (release-rc fallback), and
 * the switch aborts when neither exists. Leaving release/release-rc (or a
 * source checkout, channel unknown) keeps the live database.
 */
export function dbPlanForSwitch(
  dataDir: string,
  to: string,
  from: string | null,
  keepData: boolean,
): DbPlan {
  if (keepData) return { kind: "keep" };
  if (hasBackup(dataDir, to)) return { kind: "restore" };
  if (from === "release" || from === "release-rc" || from === null) return { kind: "keep" };
  if (isPreviewChannel(from)) {
    if (hasBackup(dataDir, "release")) return { kind: "seed", from: "release" };
    if (hasBackup(dataDir, "release-rc")) return { kind: "seed", from: "release-rc" };
    return { kind: "abort" };
  }
  return { kind: "keep" };
}

/**
 * Same channel: reinstall only when the published commit differs (or is
 * unreadable) — the preview loop is publish, try, fix, publish, update.
 * Same data, so no backup/restore swap; the slot backup is still taken so
 * a bad build can be undone.
 */
async function runSameChannelReinstall(
  deps: UpdateDeps,
  channel: string,
  before: InstalledBuild,
  remoteCommit: string | null,
): Promise<UpdateOutcome> {
  if (before.commit && remoteCommit && before.commit === remoteCommit) {
    return {
      code: 0,
      lines: [`already on ${channel} (${before.version}, ${shortCommit(before.commit)}) — nothing to do.`],
    };
  }
  const lines: string[] = [];
  lines.push(
    remoteCommit
      ? `reinstalling ${channel}: installed ${shortCommit(before.commit)} vs published ${shortCommit(remoteCommit)}`
      : `reinstalling ${channel}: could not read the published commit, reinstalling to be sure`,
  );
  const backup = backupChannel(deps.dataDir, before.channel);
  if (backup.files.length > 0) {
    lines.push(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  lines.push(`installing ${installSpec(channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(deps.runner, channel, { prefix });
  if (inst.code !== 0) {
    const tail = `${inst.stdout}\n${inst.stderr}`.trim().split("\n").slice(-10).join("\n");
    lines.push(`npm install failed (exit ${inst.code}):`);
    if (tail) lines.push(tail);
    lines.push("the live database is untouched.");
    return { code: 1, lines };
  }
  const after = readInstalledBuild(deps.cliScriptPath, before.version);
  if (after.channel !== channel || (remoteCommit && after.commit !== remoteCommit)) {
    const prefixOut = await npmGlobalPrefix(deps.runner);
    lines.push(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    lines.push(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(channel)}. ` +
        "The live database is untouched.",
    );
    return { code: 1, lines };
  }
  lines.push(`reinstalled ${channel} ${after.version} (was ${before.version})`);
  lines.push(`same channel: database left in place (backed up to ${backup.dir})`);
  lines.push("run `unvibe start` to launch the new build.");
  return { code: 0, lines };
}

/** `npm prefix -g` for mismatch messages; never throws. */
async function npmGlobalPrefix(runner: CommandRunner): Promise<string> {
  try {
    const res = await runner.run("npm", { args: ["prefix", "-g"] });
    const out = res.stdout.trim();
    return out || "(empty)";
  } catch {
    return "(could not run npm prefix -g)";
  }
}
