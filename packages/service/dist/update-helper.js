#!/usr/bin/env node

// src/update/helper-entry.ts
import { spawn as spawn2 } from "node:child_process";
import fs8 from "node:fs";
import http from "node:http";
import os from "node:os";
import path8 from "node:path";

// src/exec/runner.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
var RealCommandRunner = class {
  async run(cmd, opts) {
    if (opts.cwd !== void 0) {
      try {
        const st = fs.statSync(opts.cwd);
        if (!st.isDirectory()) throw new Error(`not a directory: ${opts.cwd}`);
      } catch (err) {
        if (err?.code === "ENOENT" || /not a directory/.test(err.message)) {
          throw new Error(
            `cannot run ${cmd}: directory not found: ${opts.cwd} (was the repo moved or deleted? Remove it in Settings \u2192 Repos and add it again)`
          );
        }
        throw err;
      }
    }
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, opts.args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => stdout += d.toString());
      child.stderr.on("data", (d) => stderr += d.toString());
      child.on("error", reject);
      const timer = opts.timeoutMs !== void 0 ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : void 0;
      if (opts.stdin !== void 0) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      }
      child.on("close", (code2) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code2 ?? 1 });
      });
    });
  }
};

// src/cli/lock.ts
import fs2 from "node:fs";
import path from "node:path";
function lockFilePath(dataDir) {
  return path.join(dataDir, "unvibe.lock");
}
function readLock(dataDir) {
  let raw;
  try {
    raw = fs2.readFileSync(lockFilePath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.port !== "number" || !Number.isInteger(parsed.port)) {
      return null;
    }
    return { pid: parsed.pid, port: parsed.port, startedAt: String(parsed.startedAt ?? "") };
  } catch {
    return null;
  }
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code2 = err?.code;
    if (code2 === "EPERM") return true;
    return false;
  }
}

// src/update/updater.ts
import fs6 from "node:fs";

// src/update/channels.ts
import fs3 from "node:fs";
import path2 from "node:path";

// src/exec/gh.ts
async function runGh(runner, args, opts) {
  const { env, ...rest } = opts;
  return runner.run("gh", {
    ...rest,
    args,
    env: { GITHUB_TOKEN: void 0, ...env }
  });
}

// src/update/channels.ts
var UNVIBE_REPO = "indigoviolet/unvibe";
function isChannelName(name) {
  return name === "release" || name === "release-rc" || /^preview\/[A-Za-z0-9._-]+$/.test(name);
}
function channelRef(channel) {
  return channel;
}
function channelKind(ref) {
  return ref === "release" ? "release" : ref === "release-rc" ? "release-rc" : "preview";
}
function parseChannelList(stdout) {
  const seen = /* @__PURE__ */ new Set();
  for (const line of stdout.split("\n")) {
    const name = line.trim();
    if (name && isChannelName(name)) seen.add(name);
  }
  const out = [...seen];
  const rank = (c) => c === "release" ? 0 : c === "release-rc" ? 1 : 2;
  out.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return out;
}
function findInstalledPackagePath(scriptPath) {
  let start;
  try {
    start = fs3.realpathSync(path2.resolve(scriptPath));
  } catch {
    start = path2.resolve(scriptPath);
  }
  let dir = path2.dirname(start);
  for (let i = 0; i < 6; i++) {
    const candidate = path2.join(dir, "package.json");
    try {
      const pkg = JSON.parse(fs3.readFileSync(candidate, "utf8"));
      if (pkg.name === "unvibe") return candidate;
    } catch {
    }
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function asStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function shortCommit(commit) {
  return commit ? commit.slice(0, 7) : "(unknown)";
}
function inferChannelFromVersion(version) {
  if (/^\d+\.\d+\.\d+$/.test(version)) return "release";
  if (/^\d+\.\d+\.\d+-rc\.\d+$/.test(version)) return "release-rc";
  const m = /^\d+\.\d+\.\d+-preview\.([A-Za-z0-9._-]+)\.[A-Za-z0-9-]+$/.exec(version);
  if (m) {
    const channel = `preview/${m[1]}`;
    return isChannelName(channel) ? channel : null;
  }
  return null;
}
function readInstalledBuild(scriptPath, fallbackVersion) {
  const empty = {
    version: fallbackVersion,
    channel: null,
    sourceBranch: null,
    sourceCommit: null,
    baseBranch: null,
    baseCommit: null,
    commit: null,
    builtAt: null,
    packagePath: null
  };
  if (!scriptPath) return { ...empty };
  const packagePath = findInstalledPackagePath(scriptPath);
  if (!packagePath) return { ...empty };
  try {
    const pkg = JSON.parse(fs3.readFileSync(packagePath, "utf8"));
    const version = typeof pkg.version === "string" ? pkg.version : fallbackVersion;
    const rawChannel = pkg.unvibe?.channel;
    let channel = typeof rawChannel === "string" && isChannelName(rawChannel) ? rawChannel : null;
    if (channel === null && pkg.private !== true && typeof pkg.version === "string") {
      channel = inferChannelFromVersion(pkg.version);
    }
    return {
      version,
      channel,
      sourceBranch: asStringOrNull(pkg.unvibe?.sourceBranch),
      sourceCommit: asStringOrNull(pkg.unvibe?.sourceCommit),
      baseBranch: asStringOrNull(pkg.unvibe?.baseBranch),
      baseCommit: asStringOrNull(pkg.unvibe?.baseCommit),
      commit: asStringOrNull(pkg.unvibe?.commit),
      builtAt: asStringOrNull(pkg.unvibe?.builtAt),
      packagePath
    };
  } catch {
    return { ...empty };
  }
}
function decodeRefPackage(stdout) {
  const blank = {
    version: null,
    commit: null,
    sourceBranch: null,
    sourceCommit: null,
    baseBranch: null,
    baseCommit: null,
    builtAt: null
  };
  try {
    const body = JSON.parse(stdout);
    if (typeof body.content !== "string") return { ...blank };
    const text = Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
    const pkg = JSON.parse(text);
    return {
      version: typeof pkg.version === "string" ? pkg.version : null,
      commit: asStringOrNull(pkg.unvibe?.commit),
      sourceBranch: asStringOrNull(pkg.unvibe?.sourceBranch),
      sourceCommit: asStringOrNull(pkg.unvibe?.sourceCommit),
      baseBranch: asStringOrNull(pkg.unvibe?.baseBranch),
      baseCommit: asStringOrNull(pkg.unvibe?.baseCommit),
      builtAt: asStringOrNull(pkg.unvibe?.builtAt)
    };
  } catch {
    return { ...blank };
  }
}
async function fetchRefPackage(runner, ref) {
  const args = ["api", `repos/${UNVIBE_REPO}/contents/package.json?ref=${ref}`];
  const blank = {
    version: null,
    commit: null,
    sourceBranch: null,
    sourceCommit: null,
    baseBranch: null,
    baseCommit: null,
    builtAt: null
  };
  try {
    const res = await runGh(runner, args, { args });
    if (res.code !== 0) return { ...blank };
    return decodeRefPackage(res.stdout);
  } catch {
    return { ...blank };
  }
}
function channelsFileOverride(installed, env = process.env) {
  const file = env.UNVIBE_UPDATE_CHANNELS_FILE;
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs3.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c) => !!c && typeof c.ref === "string").map((c) => ({
      ref: c.ref,
      kind: channelKind(c.ref),
      version: typeof c.version === "string" ? c.version : null,
      commit: typeof c.commit === "string" ? c.commit : null,
      sourceBranch: typeof c.sourceBranch === "string" ? c.sourceBranch : null,
      sourceCommit: typeof c.sourceCommit === "string" ? c.sourceCommit : null,
      baseBranch: typeof c.baseBranch === "string" ? c.baseBranch : null,
      baseCommit: typeof c.baseCommit === "string" ? c.baseCommit : null,
      builtAt: typeof c.builtAt === "string" ? c.builtAt : null,
      current: c.ref === installed.channel
    }));
  } catch {
    return null;
  }
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (; ; ) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
var CHANNEL_META_CONCURRENCY = 4;
async function listChannels(runner, installed) {
  const override = channelsFileOverride(installed);
  if (override) return override;
  const branchArgs = ["api", `repos/${UNVIBE_REPO}/branches`, "--paginate", "-q", ".[].name"];
  const branches = await runGh(runner, branchArgs, { args: branchArgs });
  if (branches.code !== 0) {
    const detail = (branches.stderr || branches.stdout).trim();
    throw new Error(
      `could not list channels: gh exited ${branches.code}${detail ? `: ${detail}` : ""}`
    );
  }
  const refs = parseChannelList(branches.stdout);
  return mapLimit(refs, CHANNEL_META_CONCURRENCY, async (ref) => {
    const meta = await fetchRefPackage(runner, ref);
    return {
      ref,
      kind: channelKind(ref),
      version: meta.version,
      commit: meta.commit,
      sourceBranch: meta.sourceBranch,
      sourceCommit: meta.sourceCommit,
      baseBranch: meta.baseBranch,
      baseCommit: meta.baseCommit,
      builtAt: meta.builtAt,
      current: ref === installed.channel
    };
  });
}

// src/update/data-backup.ts
import fs4 from "node:fs";
import path4 from "node:path";

// src/store/paths.ts
import path3 from "node:path";
function dbFilePath(dataDir) {
  return path3.join(dataDir, "unvibe.db");
}

// src/update/data-backup.ts
var UNKNOWN_CHANNEL_SLOT = "_unknown";
var SUFFIXES = ["", "-wal", "-shm"];
function dbFileNames(dataDir) {
  const base = path4.basename(dbFilePath(dataDir));
  return SUFFIXES.map((suffix) => `${base}${suffix}`);
}
function isFile(p) {
  try {
    return fs4.statSync(p).isFile();
  } catch {
    return false;
  }
}
function channelSlotDir(dataDir, channel) {
  const slot = channel ? channel.replace(/\//g, "-") : UNKNOWN_CHANNEL_SLOT;
  return path4.join(dataDir, "channel-backups", slot);
}
function backupChannel(dataDir, channel) {
  const dir = channelSlotDir(dataDir, channel);
  fs4.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const name of dbFileNames(dataDir)) {
    const src = path4.join(dataDir, name);
    if (!isFile(src)) continue;
    fs4.copyFileSync(src, path4.join(dir, name));
    files.push(name);
  }
  return { dir, files };
}
function restoreChannel(dataDir, channel) {
  const dir = channelSlotDir(dataDir, channel);
  for (const name of dbFileNames(dataDir)) {
    try {
      fs4.rmSync(path4.join(dataDir, name), { force: true });
    } catch {
    }
  }
  const files = [];
  for (const name of dbFileNames(dataDir)) {
    const backup = path4.join(dir, name);
    if (!isFile(backup)) continue;
    fs4.copyFileSync(backup, path4.join(dataDir, name));
    files.push(name);
  }
  return { dir, files };
}
var DB_RULE = "Switching keeps your data and backs it up first to channel-backups/<channel>/ in the data directory. A newer build may change the data format; if an older build then cannot open it, copy the backup back.";

// src/update/install.ts
import path5 from "node:path";
function installSource(env = process.env) {
  const override = env.UNVIBE_UPDATE_INSTALL_SOURCE;
  if (override && override.trim() !== "") return override.trim();
  return `github:${UNVIBE_REPO}`;
}
function installSpec(channel, env = process.env) {
  if (!isChannelName(channel)) throw new Error(`unknown channel: ${JSON.stringify(channel)}`);
  return `${installSource(env)}#${channelRef(channel)}`;
}
async function installRef(runner, channel, opts = {}) {
  const args = ["install", "-g", installSpec(channel)];
  if (opts.prefix) args.push("--prefix", opts.prefix);
  return runner.run("npm", { args, env: opts.env });
}
function installPrefixForPackage(packagePath) {
  if (!packagePath) return null;
  const suffix = ["lib", "node_modules", "unvibe", "package.json"].join(path5.sep);
  if (!packagePath.endsWith(suffix)) return null;
  const prefix = packagePath.slice(0, -suffix.length).replace(/[/\\]+$/, "");
  return prefix || null;
}

// src/update/switch.ts
function wrapperHookCause(output) {
  return /mise/i.test(output) && /not found/i.test(output);
}
function installLanded(after, before, channel, remoteCommit) {
  if (after.channel !== channel) return false;
  if (before.channel !== channel) return true;
  return remoteCommit !== null && after.commit === remoteCommit;
}
function checkInstallResult(serviceScriptPath, before, channel, remoteCommit, inst) {
  const output = `${inst.stdout}
${inst.stderr}`;
  const hookFailed = wrapperHookCause(output);
  const after = readInstalledBuild(serviceScriptPath, before.version);
  if (installLanded(after, before, channel, remoteCommit)) {
    return { landed: true, after, hookFailed };
  }
  return { landed: false, hookFailed };
}
async function runSwitchCore(req) {
  const lines = [];
  const log = (line) => {
    lines.push(line);
    try {
      req.log(line);
    } catch {
    }
  };
  const done = (code2, from, installed = false) => ({
    code: code2,
    lines,
    from,
    installed
  });
  if (!isChannelName(req.channel)) {
    return done(2, readInstalledBuild(req.serviceScriptPath, req.serviceVersion));
  }
  const lock = readLock(req.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    log(`the service is running (pid ${lock.pid} on port ${lock.port}) \u2014 stop it first:`);
    log("  unvibe stop");
    log(`  unvibe update ${req.channel}`);
    log("  unvibe start");
    return done(1, readInstalledBuild(req.serviceScriptPath, req.serviceVersion));
  }
  const before = readInstalledBuild(req.serviceScriptPath, req.serviceVersion);
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
  const inst = await installRef(req.runner, req.channel, { prefix, env: req.env });
  let after;
  let afterNote = null;
  if (inst.code !== 0) {
    const output = `${inst.stdout}
${inst.stderr}`;
    const tail = output.trim().split("\n").slice(-10).join("\n");
    const checked = checkInstallResult(req.serviceScriptPath, before, req.channel, remote.commit, inst);
    if (!checked.landed) {
      log(`npm install failed (exit ${inst.code}):`);
      if (tail) log(tail);
      if (checked.hookFailed) {
        log(`npm's mise wrapper could not find the mise command, so the install did not finish.`);
        log(
          `mise-managed Node needs mise on PATH where the update runs. Run the same update from a terminal, then start the service:`
        );
        log(`  unvibe update ${req.channel}`);
        log(`  unvibe start`);
      }
      log(
        backup.files.length > 0 ? `your data is untouched; the backup is in ${backup.dir}` : "your data is untouched"
      );
      return done(1, before);
    }
    after = checked.after;
    afterNote = checked.hookFailed ? `note: npm exited ${inst.code} after the install finished \u2014 its mise wrapper could not find the mise command \u2014 but the new build is in place and verified, so the switch continues. If some terminals still run the old build, run \`mise reshim\` in them.` : `note: npm exited ${inst.code} after the install finished, but the new build is in place and verified, so the switch continues. npm said:
${tail}`;
  } else {
    after = readInstalledBuild(req.serviceScriptPath, before.version);
  }
  if (after.channel !== req.channel || remote.commit && after.commit !== remote.commit) {
    const prefixOut = await npmGlobalPrefix(req.runner, req.env);
    log(`installed ${req.channel} ${after.version} (was ${before.version})`);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} \u2014 npm installed elsewhere (npm prefix -g: ${prefixOut}).`
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. Your data is untouched` + (backup.files.length > 0 ? `; the pre-switch copy is in ${backup.dir}` : ".")
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
async function runSameChannelReinstall(req, log, done, before, remoteCommit) {
  if (before.commit && remoteCommit && before.commit === remoteCommit) {
    log(`already on ${req.channel} (${before.version}, ${shortCommit(before.commit)}) \u2014 nothing to do.`);
    return done(0, before);
  }
  log(
    remoteCommit ? `reinstalling ${req.channel}: installed ${shortCommit(before.commit)} vs published ${shortCommit(remoteCommit)}` : `reinstalling ${req.channel}: could not read the published commit, reinstalling to be sure`
  );
  const backup = req.restoreBackupOf === before.channel ? { dir: channelSlotDir(req.dataDir, before.channel), files: [] } : backupChannel(req.dataDir, before.channel);
  if (backup.files.length > 0) {
    log(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  }
  const prefix = installPrefixForPackage(before.packagePath);
  log(`installing ${installSpec(req.channel)}${prefix ? ` (prefix ${prefix})` : ""} ...`);
  const inst = await installRef(req.runner, req.channel, { prefix, env: req.env });
  let after;
  let afterNote = null;
  if (inst.code !== 0) {
    const output = `${inst.stdout}
${inst.stderr}`;
    const tail = output.trim().split("\n").slice(-10).join("\n");
    const checked = checkInstallResult(req.serviceScriptPath, before, req.channel, remoteCommit, inst);
    if (!checked.landed) {
      log(`npm install failed (exit ${inst.code}):`);
      if (tail) log(tail);
      if (checked.hookFailed) {
        log(`npm's mise wrapper could not find the mise command, so the install did not finish.`);
        log(
          `mise-managed Node needs mise on PATH where the update runs. Run the same update from a terminal, then start the service:`
        );
        log(`  unvibe update ${req.channel}`);
        log(`  unvibe start`);
      }
      log("your data is untouched");
      return done(1, before);
    }
    after = checked.after;
    afterNote = checked.hookFailed ? `note: npm exited ${inst.code} after the install finished \u2014 its mise wrapper could not find the mise command \u2014 but the reinstall is in place and verified, so the switch continues. If some terminals still run the old build, run \`mise reshim\` in them.` : `note: npm exited ${inst.code} after the install finished, but the reinstall is in place and verified, so the switch continues. npm said:
${tail}`;
  } else {
    after = readInstalledBuild(req.serviceScriptPath, before.version);
  }
  if (after.channel !== req.channel || remoteCommit && after.commit !== remoteCommit) {
    const prefixOut = await npmGlobalPrefix(req.runner, req.env);
    log(
      `but the build at ${after.packagePath ?? before.packagePath ?? "(unknown install location)"} is ${after.channel ?? "(unknown channel)"} ${after.commit ? shortCommit(after.commit) : after.version} \u2014 npm installed elsewhere (npm prefix -g: ${prefixOut}).`
    );
    log(
      `fix PATH/prefix and retry, or install by hand: npm install -g ${installSpec(req.channel)}. Your data is untouched.`
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
async function npmGlobalPrefix(runner, env) {
  try {
    const res = await runner.run("npm", { args: ["prefix", "-g"], env });
    const out = res.stdout.trim();
    return out || "(empty)";
  } catch {
    return "(could not run npm prefix -g)";
  }
}

// src/update/state.ts
import fs5 from "node:fs";
import path6 from "node:path";
function updateDir(dataDir) {
  return path6.join(dataDir, "update");
}
function pendingPath(dataDir) {
  return path6.join(updateDir(dataDir), "pending.json");
}
function outcomePath(dataDir) {
  return path6.join(updateDir(dataDir), "outcome.json");
}
function currentRefPath(dataDir) {
  return path6.join(updateDir(dataDir), "current-ref");
}
function fakeChannelsPath(dataDir) {
  return path6.join(updateDir(dataDir), "fake-channels.json");
}
function writeJsonFile(file, value) {
  fs5.mkdirSync(path6.dirname(file), { recursive: true });
  fs5.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function clearPendingSwitch(dataDir) {
  try {
    fs5.unlinkSync(pendingPath(dataDir));
  } catch {
  }
}
function writeSwitchOutcome(dataDir, outcome) {
  writeJsonFile(outcomePath(dataDir), outcome);
}
function readCurrentRef(dataDir) {
  try {
    const raw = fs5.readFileSync(currentRefPath(dataDir), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}
function writeCurrentRef(dataDir, ref) {
  fs5.mkdirSync(updateDir(dataDir), { recursive: true });
  fs5.writeFileSync(currentRefPath(dataDir), ref + "\n");
}

// src/update/updater.ts
var RealUpdater = class {
  runner;
  dataDir;
  serviceScriptPath;
  serviceVersion;
  log;
  env;
  constructor(opts) {
    this.runner = opts.runner ?? new RealCommandRunner();
    this.dataDir = opts.dataDir;
    this.serviceScriptPath = opts.serviceScriptPath;
    this.serviceVersion = opts.serviceVersion;
    this.log = opts.log ?? (() => {
    });
    this.env = opts.env;
  }
  async listChannels() {
    const installed = readInstalledBuild(this.serviceScriptPath, this.serviceVersion);
    return listChannels(this.runner, installed);
  }
  async switchTo(ref, opts) {
    const result = await runSwitchCore({
      runner: this.runner,
      dataDir: this.dataDir,
      serviceScriptPath: this.serviceScriptPath,
      serviceVersion: this.serviceVersion,
      channel: ref,
      ...opts?.restoreBackupOf ? { restoreBackupOf: opts.restoreBackupOf } : {},
      env: this.env,
      log: this.log
    });
    if (result.code === 2) throw new Error(`unknown update channel "${ref}"`);
    if (result.code !== 0) {
      throw new Error(`switch to "${ref}" failed:
${result.lines.join("\n")}`);
    }
    return { from: result.from.channel ?? "unknown", to: ref };
  }
};
function kindOf(ref) {
  if (ref === "release") return "release";
  if (ref === "release-rc") return "release-rc";
  return "preview";
}
function defaultFakeChannels() {
  return [
    { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, builtAt: null },
    {
      ref: "release-rc",
      kind: "release-rc",
      version: "0.0.1-rc.1",
      commit: "abc1234def5678",
      sourceBranch: null,
      builtAt: new Date(Date.now() - 864e5).toISOString()
    },
    {
      ref: "preview/feat-x",
      kind: "preview",
      version: "0.0.1-preview.feat-x.abc1234",
      commit: "abc1234def5678",
      sourceBranch: "feat/x",
      builtAt: new Date(Date.now() - 36e5).toISOString()
    }
  ];
}
function fakeFailMode(env = process.env) {
  const raw = env.UNVIBE_UPDATE_FAKE_FAIL;
  if (!raw) return null;
  const m = raw.match(/^(install|health):(.+)$/);
  if (!m) return null;
  return { mode: m[1], ref: m[2] };
}
function loadFakeSpecs(dataDir, seed) {
  if (!dataDir) return seed;
  return readSeedFile(dataDir) ?? seed;
}
function readSeedFile(dataDir) {
  let raw;
  try {
    raw = fs6.readFileSync(fakeChannelsPath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c) => typeof c?.ref === "string");
  } catch {
    return null;
  }
}
var FakeUpdater = class {
  dataDir;
  seed;
  constructor(dataDir, seed) {
    this.dataDir = dataDir ?? null;
    this.seed = seed ?? defaultFakeChannels();
  }
  specs() {
    return loadFakeSpecs(this.dataDir, this.seed);
  }
  current() {
    if (this.dataDir) return readCurrentRef(this.dataDir) ?? "release";
    return "release";
  }
  async listChannels() {
    const current = this.current();
    return this.specs().map((c) => ({
      ref: c.ref,
      kind: c.kind ?? kindOf(c.ref),
      version: c.version ?? null,
      commit: c.commit ?? null,
      sourceBranch: c.sourceBranch ?? null,
      sourceCommit: c.sourceCommit ?? null,
      baseBranch: c.baseBranch ?? null,
      baseCommit: c.baseCommit ?? null,
      builtAt: c.builtAt ?? null,
      current: c.ref === current
    }));
  }
  async switchTo(ref) {
    const channels = await this.listChannels();
    if (!channels.some((c) => c.ref === ref)) {
      throw new Error(`unknown update channel "${ref}"`);
    }
    const from = channels.find((c) => c.current)?.ref ?? "release";
    if (from === ref) return { from, to: ref };
    const fail = fakeFailMode();
    if (fail && fail.ref === ref) {
      if (fail.mode === "install") {
        throw new Error(`fake install of "${ref}" failed (UNVIBE_UPDATE_FAKE_FAIL)`);
      }
      return { from, to: ref };
    }
    if (this.dataDir) writeCurrentRef(this.dataDir, ref);
    return { from, to: ref };
  }
};

// src/update/service-manager.ts
import fs7 from "node:fs";
import path7 from "node:path";
var LAUNCHD_LABEL = "com.unvibe.service";
var LAUNCHD_PLIST_FILENAME = `${LAUNCHD_LABEL}.plist`;
var SYSTEMD_UNIT_NAME = "unvibe.service";
function launchdPlistPath(homeDir) {
  return path7.join(homeDir, "Library", "LaunchAgents", LAUNCHD_PLIST_FILENAME);
}
function systemdUnitPath(homeDir) {
  return path7.join(homeDir, ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
}
function loginUnitPath(homeDir, platform) {
  return platform === "darwin" ? launchdPlistPath(homeDir) : systemdUnitPath(homeDir);
}
function isLoginManaged(homeDir, platform) {
  try {
    return fs7.existsSync(loginUnitPath(homeDir, platform));
  } catch {
    return false;
  }
}
function stopServiceCommands(platform, uid) {
  if (platform === "darwin" && uid !== null) {
    return [{ cmd: "launchctl", args: ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`] }];
  }
  if (platform === "darwin") return [];
  return [{ cmd: "systemctl", args: ["--user", "stop", SYSTEMD_UNIT_NAME] }];
}
function startServiceCommands(platform, uid, unitPath) {
  if (platform === "darwin") {
    if (uid === null) return [];
    return [{ cmd: "launchctl", args: ["bootstrap", `gui/${uid}`, unitPath] }];
  }
  return [{ cmd: "systemctl", args: ["--user", "start", SYSTEMD_UNIT_NAME] }];
}
function kickstartServiceCommands(uid) {
  if (uid === null) return [];
  return [{ cmd: "launchctl", args: ["kickstart", `gui/${uid}/${LAUNCHD_LABEL}`] }];
}
async function runManagerCmd(op, c) {
  try {
    return await op.runner.run(c.cmd, c.args);
  } catch (err) {
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}
async function stopManagedService(op) {
  const cmds = stopServiceCommands(op.platform, op.uid);
  if (cmds.length === 0) return false;
  let ok = true;
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code !== 0) {
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
      ok = false;
    }
  }
  return ok;
}
async function startManagedService(op) {
  const cmds = startServiceCommands(op.platform, op.uid, op.unitPath);
  if (cmds.length === 0) {
    op.log("warning: cannot drive the service manager here (no login uid); falling back");
    return false;
  }
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code === 0) return true;
    op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
  }
  if (op.platform === "darwin") {
    for (const c of kickstartServiceCommands(op.uid)) {
      const r = await runManagerCmd(op, c);
      if (r.code === 0) return true;
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
    }
  }
  return false;
}
function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function launchdPlistContent(opts) {
  const { nodePath, cliPath, port, dataDir } = opts;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${xmlEscape(nodePath)}</string>`,
    `    <string>${xmlEscape(cliPath)}</string>`,
    "    <string>start</string>",
    "    <string>--foreground</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>UNVIBE_PORT</key>",
    `    <string>${port}</string>`,
    "    <key>UNVIBE_DATA_DIR</key>",
    `    <string>${xmlEscape(dataDir)}</string>`,
    "    <key>UNVIBE_IDLE_MS</key>",
    "    <string>0</string>",
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(dataDir)}/unvibe-login.log</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(dataDir)}/unvibe-login.err.log</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}
function systemdQuote(s) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "$$").replace(/`/g, "'")}"`;
}
function systemdEnv(name, value) {
  const bare = `${name}=${value}`;
  if (/^[A-Za-z0-9_]+=[A-Za-z0-9_@%+=:,./-]+$/.test(bare)) return `Environment=${bare}`;
  const escaped = bare.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `Environment="${escaped}"`;
}
function systemdUnitContent(opts) {
  const { nodePath, cliPath, port, dataDir } = opts;
  return [
    "# Generated by `unvibe setup`. Re-run setup after changing the port or data dir.",
    "[Unit]",
    "Description=Unvibe local review service",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${systemdQuote(nodePath)} ${systemdQuote(cliPath)} start --foreground`,
    systemdEnv("UNVIBE_PORT", String(port)),
    systemdEnv("UNVIBE_DATA_DIR", dataDir),
    "Environment=UNVIBE_IDLE_MS=0",
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}
function refreshLoginUnitIfManaged(homeDir, platform, opts, write = (p, c) => {
  fs7.mkdirSync(path7.dirname(p), { recursive: true });
  fs7.writeFileSync(p, c);
}) {
  if (!isLoginManaged(homeDir, platform)) return false;
  if (!opts.nodePath || !opts.cliPath || !opts.dataDir) return false;
  const content = platform === "darwin" ? launchdPlistContent(opts) : systemdUnitContent(opts);
  write(loginUnitPath(homeDir, platform), content);
  return true;
}

// src/update/helper.ts
var RECOVER_BY_HAND = "Recover by hand: npm install -g github:indigoviolet/unvibe#release, then unvibe start.";
function applyEffectivePath(pathValue) {
  if (pathValue) process.env.PATH = pathValue;
}
function healthMatchesTarget(health, targetVersion) {
  if (targetVersion === null) return true;
  return (health.buildVersion ?? health.version) === targetVersion;
}
function describeHealth(health) {
  const v = health.buildVersion ?? health.version;
  return health.buildVersion ? `version ${health.buildVersion} (service ${health.version})` : `version ${v}`;
}
async function runSwitchFlow(plan, deps) {
  const finish = (outcome) => {
    const full = {
      ...outcome,
      ...plan.interruptedJobs !== void 0 ? { interruptedJobs: plan.interruptedJobs } : {},
      finishedAt: deps.nowIso()
    };
    deps.log(`outcome: ${full.status} ${full.from} -> ${full.to}${full.reason ? ` (${full.reason})` : ""}`);
    deps.clearPending();
    deps.recordOutcome(full);
    return full;
  };
  deps.log(`switch ${plan.from} -> ${plan.to} (target ${plan.targetVersion ?? "any healthy"}, port ${plan.port})`);
  let activePid = null;
  const start = async () => {
    if (activePid !== null) {
      deps.log(`stopping previous generation (pid ${activePid})`);
      await deps.stopService(activePid);
      activePid = null;
    }
    activePid = await deps.startService();
  };
  const pollFor = async (timeoutMs, pollIntervalMs, expectVersion) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (; ; ) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return last;
      const sample = await deps.pollHealth(Math.min(remaining, timeoutMs), pollIntervalMs, expectVersion);
      if (!sample) return last;
      if (activePid !== null && !await deps.isCurrentService(activePid)) {
        deps.log(`ignoring health sample from a stale generation (want pid ${activePid})`);
        continue;
      }
      last = sample;
      if (healthMatchesTarget(sample, expectVersion)) return sample;
    }
  };
  const rollback = async (reason) => {
    deps.log(`rolling back to ${plan.from}: ${reason}`);
    if (activePid !== null) {
      deps.log(`stopping unhealthy generation (pid ${activePid}) before rolling back`);
      await deps.stopService(activePid);
      const exited2 = await deps.waitForExit(activePid, plan.stopWaitMs);
      const lockFree = !await deps.isCurrentService(activePid);
      if (!exited2 || !lockFree) {
        deps.log(
          `warning: previous generation (pid ${activePid}) may still hold the port; attempting rollback anyway`
        );
      }
      activePid = null;
    }
    const backupDir = channelSlotDir(plan.dataDir, plan.from);
    try {
      await deps.switchTo(plan.from, { restoreBackupOf: plan.from });
    } catch (err) {
      return finish({
        status: "failed",
        from: plan.from,
        to: plan.to,
        reason: `${reason}; rollback to ${plan.from} also failed: ${err.message}. The pre-switch database backup is in ${backupDir}. ${RECOVER_BY_HAND}`,
        logPath: plan.logPath
      });
    }
    await start();
    const back = await pollFor(plan.healthTimeoutMs, plan.pollIntervalMs, plan.fromVersion);
    if (back && healthMatchesTarget(back, plan.fromVersion)) {
      return finish({ status: "rolled-back", from: plan.from, to: plan.to, reason, logPath: plan.logPath });
    }
    const why2 = back ? `the rolled-back build reported ${describeHealth(back)}` : `the previous build did not start within ${Math.round(plan.healthTimeoutMs / 1e3)} seconds`;
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason: `${reason}; ${why2}. ${RECOVER_BY_HAND}`,
      logPath: plan.logPath
    });
  };
  const exited = await deps.waitForExit(plan.servicePid, plan.exitWaitMs);
  if (!exited) {
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason: `the service did not stop within ${Math.round(plan.exitWaitMs / 1e3)} seconds, so nothing was installed and it is still running. Run \`unvibe stop\`, then switch again (or run \`unvibe update ${plan.to}\` while it is stopped)`,
      logPath: plan.logPath
    });
  }
  try {
    const switched = await deps.switchTo(plan.to);
    deps.log(`installed ${switched.to} (was ${switched.from})`);
  } catch (err) {
    return rollback(`install of ${plan.to} failed: ${err.message}`);
  }
  await start();
  const healthy = await pollFor(plan.healthTimeoutMs, plan.pollIntervalMs, plan.targetVersion);
  if (healthy && healthMatchesTarget(healthy, plan.targetVersion)) {
    deps.log(`new build healthy: ${describeHealth(healthy)}`);
    return finish({ status: "ok", from: plan.from, to: plan.to, logPath: plan.logPath });
  }
  const why = healthy ? `new build reported ${describeHealth(healthy)} instead of ${plan.targetVersion ?? "a healthy build"}` : `the new build did not start within ${Math.round(plan.healthTimeoutMs / 1e3)} seconds`;
  return rollback(why);
}

// src/update/helper-entry.ts
function isPidAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
function getHealthOnce(port, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += String(chunk);
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return finish(null);
        try {
          finish(JSON.parse(body));
        } catch {
          finish(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
  });
}
function parseArgs(raw) {
  const o = raw;
  const str = (k) => {
    if (typeof o[k] !== "string" || o[k] === "") throw new Error(`helper args: missing ${k}`);
    return o[k];
  };
  const num = (k) => {
    if (typeof o[k] !== "number" || !Number.isSafeInteger(o[k]) || o[k] <= 0) {
      throw new Error(`helper args: missing ${k}`);
    }
    return o[k];
  };
  const versionOrNull = (k) => {
    const v = o[k];
    if (v !== null && typeof v !== "string") throw new Error(`helper args: bad ${k}`);
    return v;
  };
  const interruptedJobs = (() => {
    const v = o["interruptedJobs"];
    if (v === void 0) return void 0;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      throw new Error("helper args: bad interruptedJobs");
    }
    return v;
  })();
  if (typeof o["managed"] !== "boolean") throw new Error("helper args: missing managed");
  if (typeof o["loginUnitPath"] !== "string" || o["loginUnitPath"] === "") {
    throw new Error("helper args: missing loginUnitPath");
  }
  const loginUid = o["loginUid"];
  if (loginUid !== null && (typeof loginUid !== "number" || !Number.isSafeInteger(loginUid) || loginUid < 0)) {
    throw new Error("helper args: bad loginUid");
  }
  return {
    from: str("from"),
    to: str("to"),
    targetVersion: versionOrNull("targetVersion"),
    fromVersion: versionOrNull("fromVersion"),
    port: num("port"),
    dataDir: str("dataDir"),
    servicePid: num("servicePid"),
    exitWaitMs: num("exitWaitMs"),
    healthTimeoutMs: num("healthTimeoutMs"),
    pollIntervalMs: num("pollIntervalMs"),
    stopWaitMs: num("stopWaitMs"),
    logPath: str("logPath"),
    scriptPath: str("scriptPath"),
    serviceVersion: str("serviceVersion"),
    managed: o["managed"],
    loginUnitPath: o["loginUnitPath"],
    loginUid,
    effectivePath: str("effectivePath"),
    ...interruptedJobs !== void 0 ? { interruptedJobs } : {}
  };
}
function pruneLogs(dataDir, keep = 5) {
  let files;
  try {
    files = fs8.readdirSync(updateDir(dataDir)).sort();
  } catch {
    return;
  }
  const groups = { "switch-": [], "helper-": [], "helper-args-": [] };
  for (const f of files) {
    for (const prefix of Object.keys(groups)) {
      if (f.startsWith(prefix)) groups[prefix].push(f);
    }
  }
  for (const list of Object.values(groups)) {
    for (const f of list.slice(0, Math.max(0, list.length - keep))) {
      try {
        fs8.unlinkSync(path8.join(updateDir(dataDir), f));
      } catch {
      }
    }
  }
}
async function main() {
  const argsFile = process.argv[2];
  if (!argsFile) {
    console.error("usage: node update-helper.js <argsFile>");
    return 2;
  }
  let args;
  try {
    args = parseArgs(JSON.parse(fs8.readFileSync(argsFile, "utf8")));
  } catch (err) {
    console.error(`update helper: ${err.message}`);
    return 2;
  }
  const exitWaitMs = intEnv("UNVIBE_UPDATE_EXIT_WAIT_MS", args.exitWaitMs);
  const healthTimeoutMs = intEnv("UNVIBE_UPDATE_HEALTH_TIMEOUT_MS", args.healthTimeoutMs);
  const pollIntervalMs = intEnv("UNVIBE_UPDATE_POLL_MS", args.pollIntervalMs);
  const stopWaitMs = intEnv("UNVIBE_UPDATE_STOP_WAIT_MS", args.stopWaitMs);
  const logLines = [];
  const log = (message) => {
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}`;
    logLines.push(line);
    try {
      fs8.mkdirSync(path8.dirname(args.logPath), { recursive: true });
      fs8.appendFileSync(args.logPath, line + "\n");
    } catch {
    }
  };
  try {
    pruneLogs(args.dataDir);
  } catch {
  }
  log(`helper starting (args ${argsFile}, pid ${process.pid})`);
  applyEffectivePath(args.effectivePath);
  log(`update PATH: ${args.effectivePath}`);
  const updater = process.env.UNVIBE_UPDATER_BACKEND === "fake" ? new FakeUpdater(args.dataDir) : new RealUpdater({
    runner: new RealCommandRunner(),
    dataDir: args.dataDir,
    serviceScriptPath: args.scriptPath,
    serviceVersion: args.serviceVersion,
    log,
    env: { PATH: args.effectivePath }
  });
  const waitForExit = async (pid, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (; ; ) {
      if (!isPidAlive2(pid)) return true;
      if (Date.now() >= deadline) return !isPidAlive2(pid);
      await sleep(250);
    }
  };
  const startService = async () => {
    if (args.managed) {
      const started = await startManagedGeneration();
      if (started) return started;
      log("warning: service-manager start failed; starting directly instead (unmanaged until the next login)");
    }
    const child = spawn2(process.execPath, [args.scriptPath, "start", "--foreground"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, UNVIBE_PORT: String(args.port), UNVIBE_DATA_DIR: args.dataDir }
    });
    child.unref();
    if (child.pid === void 0) throw new Error("failed to spawn the service restart");
    log(`service restart spawned (pid ${child.pid})`);
    await sleep(500);
    return child.pid;
  };
  const stopService = async (pid) => {
    if (args.managed) {
      await stopManagedService(managerOp());
      return;
    }
    try {
      if (!isPidAlive2(pid)) return;
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    const deadline = Date.now() + stopWaitMs;
    for (; ; ) {
      await sleep(250);
      if (!isPidAlive2(pid)) return;
      if (Date.now() >= deadline) {
        log(`previous generation (pid ${pid}) still alive after SIGTERM; proceeding anyway`);
        return;
      }
    }
  };
  const isCurrentService = async (pid) => {
    try {
      return readLock(args.dataDir)?.pid === pid;
    } catch {
      return false;
    }
  };
  function managerOp() {
    return {
      runner: { run: (cmd, a) => runManager(cmd, a) },
      log,
      platform: process.platform,
      uid: args.loginUid,
      unitPath: args.loginUnitPath
    };
  }
  function runManager(cmd, a) {
    return new Promise((resolve) => {
      let out = "";
      let errOut = "";
      let done = false;
      const finish = (code2) => {
        if (done) return;
        done = true;
        resolve({ code: code2, stdout: out, stderr: errOut });
      };
      let child;
      try {
        child = spawn2(cmd, a, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        resolve({ code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        finish(1);
      }, 3e4);
      child.stdout?.on("data", (d) => {
        out += String(d);
      });
      child.stderr?.on("data", (d) => {
        errOut += String(d);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(127);
      });
      child.on("close", (code2) => {
        clearTimeout(timer);
        finish(typeof code2 === "number" ? code2 : 1);
      });
    });
  }
  async function startManagedGeneration() {
    const op = managerOp();
    await stopManagedService(op);
    if (!await startManagedService(op)) return null;
    const deadline = Date.now() + 5e3;
    for (; ; ) {
      try {
        const lock = readLock(args.dataDir);
        if (lock && isPidAlive2(lock.pid)) {
          log(`managed generation holds the lock (pid ${lock.pid})`);
          return lock.pid;
        }
      } catch {
      }
      if (Date.now() >= deadline) {
        log("warning: managed generation started but holds no lock yet; continuing without a pid");
        return null;
      }
      await sleep(250);
    }
  }
  function refreshUnit(when) {
    try {
      const home = process.env.HOME ?? os.homedir();
      const ok = refreshLoginUnitIfManaged(home, process.platform, {
        nodePath: process.execPath,
        cliPath: args.scriptPath,
        port: args.port,
        dataDir: args.dataDir
      });
      if (ok) log(`login unit refreshed ${when}`);
      else if (args.managed && !isLoginManaged(home, process.platform)) {
        log("login unit no longer installed; leaving the restart unmanaged");
      }
    } catch (err) {
      log(`warning: login unit refresh failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  const pollHealth = async (timeoutMs, intervalMs, expectVersion) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (; ; ) {
      const body = await getHealthOnce(args.port, 2e3);
      if (body && body.ok === true && typeof body.version === "string") {
        const buildVersion = body.build && typeof body.build.version === "string" ? body.build.version : null;
        last = { version: body.version, buildVersion };
        const seen = buildVersion ?? body.version;
        log(`health: ${seen}`);
        if (expectVersion === null || seen === expectVersion) return last;
      }
      if (Date.now() >= deadline) return last;
      await sleep(intervalMs);
    }
  };
  const outcome = await runSwitchFlow(
    { ...args, exitWaitMs, healthTimeoutMs, pollIntervalMs, stopWaitMs },
    {
      waitForExit,
      switchTo: async (ref, opts) => {
        const switched = await updater.switchTo(ref, opts);
        refreshUnit("after install of " + switched.to);
        return switched;
      },
      startService,
      stopService,
      isCurrentService,
      pollHealth,
      recordOutcome: (o) => writeSwitchOutcome(args.dataDir, o),
      clearPending: () => clearPendingSwitch(args.dataDir),
      log,
      nowIso: () => (/* @__PURE__ */ new Date()).toISOString()
    }
  );
  void outcome;
  return 0;
}
var code = await main().catch((err) => {
  console.error(`update helper failed: ${err.message}`);
  return 1;
});
process.exit(code);
