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
import type { CommandRunner, RunResult } from "../exec/index.js";
import { isPidAlive, readLock } from "../cli/lock.js";
import { DB_RULE, backupChannel, channelSlotDir, restoreChannel } from "./data-backup.js";
import {
  fetchRefPackage,
  isChannelName,
  readInstalledBuild,
  shortCommit,
  type InstalledBuild,
} from "./channels.js";
import os from "node:os";
import { installPrefixForPackage, installRef, installSpec, stableNpmCwd } from "./install.js";
import { findMiseBinStatic } from "./mise-find.js";

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
  /**
   * Extra env for the npm spawns (issue #170): the login-shell-merged PATH
   * so version-manager wrappers (mise's reshim step) find their binaries.
   * Undefined inherits the process env (the detached helper restores the
   * service's repaired PATH before calling).
   */
  env?: Record<string, string | undefined>;
  /**
   * Home dir for the stable npm cwd + mise lookup (issue #280).
   * Production omits it (real `os.homedir()`); tests pass a scratch dir.
   * Only a spawn cwd / lookup root, never a write target.
   */
  homeDir?: string;
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

/**
 * Post-install wrapper-hook failure (issue #170): mise wraps each Node
 * version's npm so a global install runs `mise reshim` afterwards. Old
 * wrappers propagate the reshim's failure, so npm can exit 127 with a
 * "mise ... not found" message AFTER renewing the files (newer wrappers
 * ignore the reshim's exit code and return npm's own). Matches the
 * wrapper's wording across shells (`mise: command not found` in bash,
 * `mise: not found` in dash).
 */
function wrapperHookCause(output: string): boolean {
  return /mise/i.test(output) && /not found/i.test(output);
}

/**
 * Reshim-only failure (issue #170, reopened): npm itself succeeded —
 * its own summary line (`added N packages` / `changed N packages`) is
 * in the output — and the only failure is mise's npm-wrapper reshim
 * step afterwards (`npm: line 76: mise: command not found`, exit 127
 * on the owner's Mac). The earlier check also required the installed
 * build to verify in place before continuing; the owner's switch still
 * rolled back, so the success line is now authoritative for "npm
 * finished" and the landing is left to the normal channel/commit
 * verification that follows. Real npm failures never print that line.
 */
export function isReshimOnlyFailure(inst: RunResult): boolean {
  if (inst.code === 0) return false;
  const output = `${inst.stdout}\n${inst.stderr}`;
  if (!/(?:changed|added)\s+\d+\s+packages?/.test(output)) return false;
  return /mise/i.test(output) && (/reshim/i.test(output) || /not found/i.test(output));
}

/**
 * After a reshim-only failure, run `mise reshim` ourselves when mise
 * can be found without a shell; otherwise say how to fix the shims.
 * Best-effort: returns a log line, never throws.
 */
async function attemptOwnReshim(req: SwitchCoreRequest): Promise<string> {
  try {
    const homeDir = req.homeDir ?? os.homedir();
    const mise = findMiseBinStatic({
      env: { ...process.env, ...(req.env ?? {}) },
      homeDir,
      inheritedPath: req.env?.PATH ?? process.env.PATH ?? "",
    });
    if (!mise) {
      return (
        "note: mise was not found, so its shims were not refreshed; " +
        "if a terminal still runs the old build, run `mise reshim` there."
      );
    }
    const res = await req.runner.run(mise, { args: ["reshim"], cwd: stableNpmCwd(homeDir), env: req.env });
    return res.code === 0
      ? "note: ran `mise reshim` so mise's shims point at the new build."
      : `note: \`mise reshim\` exited ${res.code}; if a terminal still runs the old build, run \`mise reshim\` there.`;
  } catch {
    return "note: could not run `mise reshim`; if a terminal still runs the old build, run `mise reshim` there.";
  }
}

/**
 * True when the target build is verifiably in place despite npm's nonzero
 * exit: across channels the channel itself changing is proof; on a
 * same-channel reinstall only a known published commit now reported counts
 * (an unreadable remote cannot verify, so it never counts).
 */
function installLanded(
  after: InstalledBuild,
  before: InstalledBuild,
  channel: string,
  remoteCommit: string | null,
): boolean {
  if (after.channel !== channel) return false;
  if (before.channel !== channel) return true;
  return remoteCommit !== null && after.commit === remoteCommit;
}

/** What looking past npm's exit code found (issue #170). */
interface InstallCheck {
  landed: boolean;
  after: InstalledBuild;
  hookFailed: boolean;
}

function checkInstallResult(
  serviceScriptPath: string | undefined,
  before: InstalledBuild,
  channel: string,
  remoteCommit: string | null,
  inst: RunResult,
): InstallCheck {
  const output = `${inst.stdout}\n${inst.stderr}`;
  const hookFailed = wrapperHookCause(output);
  const after = readInstalledBuild(serviceScriptPath, before.version);
  return { landed: installLanded(after, before, channel, remoteCommit), after, hookFailed };
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
    log(`no data in ${req.dataDir} to back up yet`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  log(`installing ${installSpec(req.channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(req.runner, req.channel, {
    prefix,
    env: req.env,
    ...(req.homeDir !== undefined ? { homeDir: req.homeDir } : {}),
  });
  let after: InstalledBuild;
  let afterNote: string | null = null;
  if (inst.code !== 0) {
    const output = `${inst.stdout}\n${inst.stderr}`;
    const tail = output.trim().split("\n").slice(-10).join("\n");
    const checked = checkInstallResult(req.serviceScriptPath, before, req.channel, remote.commit, inst);
    const reshimOnly = isReshimOnlyFailure(inst);
    if (!checked.landed && !reshimOnly) {
      log(`npm install failed (exit ${inst.code}):`);
      if (tail) log(tail);
      if (checked.hookFailed) {
        log(`npm's mise wrapper could not find the mise command, so the install did not finish.`);
        log(
          `mise-managed Node needs mise on PATH where the update runs. ` +
            `Run the same update from a terminal, then start the service:`,
        );
        log(`  unvibe update ${req.channel}`);
        log(`  unvibe start`);
      }
      log(
        backup.files.length > 0
          ? `your data is untouched; the backup is in ${backup.dir}`
          : "your data is untouched",
      );
      return done(1, before);
    }
    // npm finished and only its wrapper's reshim step failed (or the
    // build verified in place despite the exit): continue instead of
    // rolling back into the same failure. The channel/commit check
    // below still verifies the landing.
    after = checked.after;
    afterNote = reshimOnly
      ? `note: npm exited ${inst.code} after the install finished — its mise wrapper's reshim step failed — ` +
        `but npm reported the install done, so the switch continues. ` +
        (await attemptOwnReshim(req))
      : checked.hookFailed
        ? `note: npm exited ${inst.code} after the install finished — its mise wrapper could not find the mise command — ` +
          `but the new build is in place and verified, so the switch continues. ` +
          `If some terminals still run the old build, run \`mise reshim\` in them.`
        : `note: npm exited ${inst.code} after the install finished, but the new build is in place and verified, ` +
          `so the switch continues. npm said:\n${tail}`;
  } else {
    after = readInstalledBuild(req.serviceScriptPath, before.version);
  }
  // Verify the install landed where this binary lives: npm uses whatever
  // prefix is first on PATH, which may not be ours (multiple node
  // versions, minimal-PATH helpers). Never swap databases on a miss.
  // (A verified wrapper-hook failure passes by construction.)
  if (after.channel !== req.channel || (remote.commit && after.commit !== remote.commit)) {
    const prefixOut = await npmGlobalPrefix(req.runner, req.env, req.homeDir);
    log(`installed ${req.channel} ${after.version} (was ${before.version})`);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. ` +
        `Your data is untouched` +
        (backup.files.length > 0 ? `; the pre-switch copy is in ${backup.dir}` : "."),
    );
    return done(1, before);
  }
  log(`installed ${req.channel} ${after.version} (was ${before.version})`);
  if (afterNote) log(afterNote);
  if (req.restoreBackupOf) {
    const restored = restoreChannel(req.dataDir, req.restoreBackupOf);
    if (restored.files.length > 0) {
      log(`restored the backup from ${restored.dir} (${restored.files.join(", ")})`);
    } else {
      log(`no backup in ${restored.dir} to restore; your data is unchanged`);
    }
  } else {
    log(`data kept (backed up to ${backup.dir})`);
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
  // Rolling back a same-channel update: this slot already holds the
  // pre-switch copy about to be restored, so it must not be overwritten.
  const backup =
    req.restoreBackupOf === before.channel
      ? { dir: channelSlotDir(req.dataDir, before.channel), files: [] }
      : backupChannel(req.dataDir, before.channel);
  if (backup.files.length > 0) {
    log(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  log(`installing ${installSpec(req.channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(req.runner, req.channel, {
    prefix,
    env: req.env,
    ...(req.homeDir !== undefined ? { homeDir: req.homeDir } : {}),
  });
  let after: InstalledBuild;
  let afterNote: string | null = null;
  if (inst.code !== 0) {
    const output = `${inst.stdout}\n${inst.stderr}`;
    const tail = output.trim().split("\n").slice(-10).join("\n");
    const checked = checkInstallResult(req.serviceScriptPath, before, req.channel, remoteCommit, inst);
    const reshimOnly = isReshimOnlyFailure(inst);
    if (!checked.landed && !reshimOnly) {
      log(`npm install failed (exit ${inst.code}):`);
      if (tail) log(tail);
      if (checked.hookFailed) {
        log(`npm's mise wrapper could not find the mise command, so the install did not finish.`);
        log(
          `mise-managed Node needs mise on PATH where the update runs. ` +
            `Run the same update from a terminal, then start the service:`,
        );
        log(`  unvibe update ${req.channel}`);
        log(`  unvibe start`);
      }
      log("your data is untouched");
      return done(1, before);
    }
    // npm finished and only its wrapper's reshim step failed (or the
    // reinstall verified in place despite the exit): continue instead
    // of rolling back. The channel/commit check below still verifies.
    after = checked.after;
    afterNote = reshimOnly
      ? `note: npm exited ${inst.code} after the install finished — its mise wrapper's reshim step failed — ` +
        `but npm reported the install done, so the switch continues. ` +
        (await attemptOwnReshim(req))
      : checked.hookFailed
        ? `note: npm exited ${inst.code} after the install finished — its mise wrapper could not find the mise command — ` +
          `but the reinstall is in place and verified, so the switch continues. ` +
          `If some terminals still run the old build, run \`mise reshim\` in them.`
        : `note: npm exited ${inst.code} after the install finished, but the reinstall is in place and verified, ` +
          `so the switch continues. npm said:\n${tail}`;
  } else {
    after = readInstalledBuild(req.serviceScriptPath, before.version);
  }
  if (after.channel !== req.channel || (remoteCommit && after.commit !== remoteCommit)) {
    const prefixOut = await npmGlobalPrefix(req.runner, req.env, req.homeDir);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} ` +
        `is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} — ` +
        `npm installed elsewhere (npm prefix -g: ${prefixOut}).`,
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. ` +
        "Your data is untouched.",
    );
    return done(1, before);
  }
  log(`reinstalled ${req.channel} ${after.version} (was ${before.version})`);
  if (afterNote) log(afterNote);
  if (req.restoreBackupOf) {
    const restored = restoreChannel(req.dataDir, req.restoreBackupOf);
    if (restored.files.length > 0) {
      log(`restored the backup from ${restored.dir} (${restored.files.join(", ")})`);
    } else {
      log(`no backup in ${restored.dir} to restore; your data is unchanged`);
    }
  } else {
    log(`data kept (backed up to ${backup.dir})`);
  }
  return done(0, before, true);
}

/** `npm prefix -g` for mismatch messages; never throws. */
async function npmGlobalPrefix(
  runner: CommandRunner,
  env?: Record<string, string | undefined>,
  homeDir?: string,
): Promise<string> {
  try {
    const res = await runner.run("npm", { args: ["prefix", "-g"], cwd: stableNpmCwd(homeDir ?? os.homedir()), env });
    const out = res.stdout.trim();
    return out || "(empty)";
  } catch {
    return "(could not run npm prefix -g)";
  }
}
