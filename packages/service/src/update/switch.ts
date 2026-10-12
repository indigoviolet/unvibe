/**
 * Shared channel-switch core (issue #36, step 1 logic, step 2 seam).
 *
 * One function — `runSwitchCore` — owns the sequencing both callers need:
 * the `unvibe update` CLI (`cli/update-flows.ts`, which keeps its
 * line-by-line console output) and the in-app picker's `Updater` (which
 * throws with a useful message on failure and streams the same lines to
 * the switch log). Do not duplicate this sequencing elsewhere.
 *
 * Order matters, and is the same for both callers:
 * 1. refuse while the service runs (backup needs a quiet store; npm must
 *    not replace code under a live process);
 * 2. back up the old channel, install with a prefix pinned to this
 *    binary's own prefix, verify the install landed there. Same channel
 *    reinstalls only when the published commit differs (or is unreadable;
 *    no-op when it matches).
 * 3. the live database stays in place and the new build opens it;
 *    `restoreBackupOf` (rollback only) restores that channel's backup
 *    over the live files after the install, so the old build never opens
 *    a database the new build may have migrated.
 */
import type { CommandRunner } from "../exec/index.js";
import { isPidAlive, readLock } from "../cli/lock.js";
import { DB_RULE, backupChannel, restoreChannel } from "./data-backup.js";
import {
  fetchRefPackage,
  isChannelName,
  readInstalledBuild,
  shortCommit,
  type InstalledBuild,
} from "./channels.js";
import { installPrefixForPackage, installRef, installSpec } from "./install.js";

export interface SwitchCoreRequest {
  runner: CommandRunner;
  dataDir: string;
  /**
   * Service entry path the install is verified against
   * (`process.argv[1]` of the switching service — never the helper copy's
   * own location).
   */
  serviceScriptPath: string | undefined;
  serviceVersion: string;
  channel: string;
  /**
   * Rollback only: after the install verifies, restore this channel's
   * backup slot over the live files. The helper passes the channel being
   * rolled back to, so the old build reopens its pre-switch database.
   */
  restoreBackupOf?: string;
  /** Receives every output line as it is produced (console or switch log). */
  log: (line: string) => void;
}

export interface SwitchCoreResult {
  /** 0 ok, 1 failure, 2 unknown channel. */
  code: number;
  lines: string[];
  /** Installed build before the attempt. */
  from: InstalledBuild;
  /** True when an install/reinstall ran and verified (the new build needs launching). */
  installed: boolean;
}

/** Install a channel: backup, npm install (verified), keep the live DB. Never runs live. */
export async function runSwitchCore(req: SwitchCoreRequest): Promise<SwitchCoreResult> {
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
    try {
      req.log(line);
    } catch {
      // A wedged log sink must not stop the switch.
    }
  };
  const done = (code: number, from: InstalledBuild, installed = false): SwitchCoreResult => ({
    code,
    lines,
    from,
    installed,
  });

  if (!isChannelName(req.channel)) {
    return done(2, readInstalledBuild(req.serviceScriptPath, req.serviceVersion));
  }
  const lock = readLock(req.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    log(`the service is running (pid ${lock.pid} on port ${lock.port}) — stop it first:`);
    log("  unvibe stop");
    log(`  unvibe update ${req.channel}`);
    log("  unvibe start");
    return done(1, readInstalledBuild(req.serviceScriptPath, req.serviceVersion));
  }
  const before = readInstalledBuild(req.serviceScriptPath, req.serviceVersion);
  // Remote metadata for the target: same-build compare and post-install
  // verification. Unreadable metadata only weakens the checks, never blocks.
  const remote = await fetchRefPackage(req.runner, req.channel);

  if (before.channel === req.channel) {
    return runSameChannelReinstall(req, log, done, before, remote.commit);
  }

  log(`current: ${before.channel ?? "(unknown channel)"} ${before.version}`);
  const backup = backupChannel(req.dataDir, before.channel);
  if (backup.files.length > 0) {
    log(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  } else {
    log(`no database in ${req.dataDir} to back up (fresh machine?)`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  log(`installing ${installSpec(req.channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(req.runner, req.channel, { prefix });
  if (inst.code !== 0) {
    const tail = `${inst.stdout}\n${inst.stderr}`.trim().split("\n").slice(-10).join("\n");
    log(`npm install failed (exit ${inst.code}):`);
    if (tail) log(tail);
    log(
      backup.files.length > 0
        ? `the live database is untouched; the pre-switch copy is in ${backup.dir}`
        : "the live database is untouched.",
    );
    return done(1, before);
  }
  // Verify the install landed where this binary lives: npm uses whatever
  // prefix is first on PATH, which may not be ours (multiple node
  // versions, minimal-PATH helpers). Never swap databases on a miss.
  const after = readInstalledBuild(req.serviceScriptPath, before.version);
  if (after.channel !== req.channel || (remote.commit && after.commit !== remote.commit)) {
    const prefixOut = await npmGlobalPrefix(req.runner);
    log(`installed ${req.channel} ${after.version} (was ${before.version})`);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. ` +
        `The live database is untouched` +
        (backup.files.length > 0 ? `; the pre-switch copy is in ${backup.dir}` : "."),
    );
    return done(1, before);
  }
  log(`installed ${req.channel} ${after.version} (was ${before.version})`);
  if (req.restoreBackupOf) {
    const restored = restoreChannel(req.dataDir, req.restoreBackupOf);
    if (restored.files.length > 0) {
      log(`restored the pre-switch backup from ${restored.dir} (${restored.files.join(", ")})`);
    } else {
      log(`no pre-switch backup in ${restored.dir} to restore; the live database is unchanged`);
    }
  } else {
    log(`database left in place (backed up to ${backup.dir})`);
  }
  log(DB_RULE);
  return done(0, before, true);
}

/**
 * Same channel: reinstall only when the published commit differs (or is
 * unreadable) — the preview loop is publish, try, fix, publish, update.
 * The live database stays in place; the slot backup is still taken first
 * so a bad build can be undone.
 */
async function runSameChannelReinstall(
  req: SwitchCoreRequest,
  log: (line: string) => void,
  done: (code: number, from: InstalledBuild, installed?: boolean) => SwitchCoreResult,
  before: InstalledBuild,
  remoteCommit: string | null,
): Promise<SwitchCoreResult> {
  if (before.commit && remoteCommit && before.commit === remoteCommit) {
    log(`already on ${req.channel} (${before.version}, ${shortCommit(before.commit)}) — nothing to do.`);
    return done(0, before);
  }
  log(
    remoteCommit
      ? `reinstalling ${req.channel}: installed ${shortCommit(before.commit)} vs published ${shortCommit(remoteCommit)}`
      : `reinstalling ${req.channel}: could not read the published commit, reinstalling to be sure`,
  );
  const backup = backupChannel(req.dataDir, before.channel);
  if (backup.files.length > 0) {
    log(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  log(`installing ${installSpec(req.channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(req.runner, req.channel, { prefix });
  if (inst.code !== 0) {
    const tail = `${inst.stdout}\n${inst.stderr}`.trim().split("\n").slice(-10).join("\n");
    log(`npm install failed (exit ${inst.code}):`);
    if (tail) log(tail);
    log("the live database is untouched.");
    return done(1, before);
  }
  const after = readInstalledBuild(req.serviceScriptPath, before.version);
  if (after.channel !== req.channel || (remoteCommit && after.commit !== remoteCommit)) {
    const prefixOut = await npmGlobalPrefix(req.runner);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. ` +
        "The live database is untouched.",
    );
    return done(1, before);
  }
  log(`reinstalled ${req.channel} ${after.version} (was ${before.version})`);
  if (req.restoreBackupOf) {
    const restored = restoreChannel(req.dataDir, req.restoreBackupOf);
    if (restored.files.length > 0) {
      log(`restored the pre-switch backup from ${restored.dir} (${restored.files.join(", ")})`);
    } else {
      log(`no pre-switch backup in ${restored.dir} to restore; the live database is unchanged`);
    }
  } else {
    log(`database left in place (backed up to ${backup.dir})`);
  }
  return done(0, before, true);
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
