/**
 * npm `postinstall` setup (issue #42): a global install runs the same
 * setup as `unvibe setup`, so one `npm install -g` leaves a working
 * install (token, `unvibe://` handler, start-at-login unit).
 *
 * Guards, in order (all injected, so tests simulate macOS, root, CI and a
 * running service from any host):
 * - explicit opt-out (`UNVIBE_SKIP_POSTINSTALL_SETUP=1`, or
 *   `UNVIBE_POSTINSTALL_SETUP=0`) — silent;
 * - running as root (`sudo npm install -g`) — hint: root-owned files must
 *   not land in the user's home;
 * - not a global install (`npm_config_global` is not `true`, e.g. `npm
 *   install` in a dev checkout or workspace) — silent. The release
 *   package is the only one that declares `postinstall` (see
 *   `scripts/release.mjs`); the source tree declares none, so this is a
 *   second line of defence, not the only one;
 * - CI (`CI` and friends) — hint, unless the caller forces it with
 *   `UNVIBE_POSTINSTALL_SETUP=1` (the global-install check does, with a
 *   fake HOME);
 * - no home directory, or a platform other than macOS/Linux — hint;
 * - a channel switch is pending (`<dataDir>/update/pending.json`) —
 *   silent: the detached update helper owns the install and refreshes
 *   the login unit itself; running setup here would start the new build
 *   before the helper has verified it and could roll it back;
 * - the service is currently running (live lock pid) — silent: npm has
 *   already replaced the files under it, and setup's login-unit enable
 *   would start a second generation against the same port/data dir. The
 *   handler and unit keep pointing at the same installed path, and the
 *   next `unvibe setup` (or update-helper refresh) rewrites them.
 *
 * Whatever happens the postinstall exits 0: it must never fail an
 * install. When setup cannot run, one line names the manual command.
 */
import path from "node:path";
import { installSetup, type SetupPaths, type SetupRunner } from "./index.js";

export const POSTINSTALL_HINT = "unvibe: setup was not run; run `unvibe setup` to finish installing.";

const CI_KEYS = ["CI", "CONTINUOUS_INTEGRATION", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "TF_BUILD"];

function truthy(v: string | undefined): boolean {
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

export interface PostinstallProbe {
  env: NodeJS.ProcessEnv;
  platform: string;
  homeDir: string | null;
  uid: number | null;
  switchPending: boolean;
  serviceRunning: boolean;
  /** True when this script runs from `<prefix>/lib/node_modules/unvibe`. */
  inInstalledLayout: boolean;
}

export type PostinstallDecision =
  | { action: "run" }
  | { action: "skip"; reason: string; hint: boolean };

export function decidePostinstall(p: PostinstallProbe): PostinstallDecision {
  const env = p.env;
  if (truthy(env.UNVIBE_SKIP_POSTINSTALL_SETUP) || env.UNVIBE_POSTINSTALL_SETUP === "0") {
    return { action: "skip", reason: "opted out (UNVIBE_SKIP_POSTINSTALL_SETUP)", hint: false };
  }
  const forced = env.UNVIBE_POSTINSTALL_SETUP === "1";
  if (p.uid === 0) {
    return { action: "skip", reason: "running as root", hint: true };
  }
  // Never bypassed by forcing: npm's git-dep preparation runs this script
  // in a temp clone through a nested, non-global install that inherits
  // the outer environment — running setup there would bake the temp
  // clone's path into the handler before it is deleted.
  if (env.npm_config_global !== "true") {
    return { action: "skip", reason: "not a global install", hint: false };
  }
  // npm also runs a git dependency's postinstall inside its preparation
  // clone (with npm_config_global=true), before the clone is moved into
  // the global prefix and deleted. Only the installed layout may run
  // setup — anywhere else would bake a path that is about to vanish.
  if (!p.inInstalledLayout) {
    return { action: "skip", reason: "not in the installed global layout", hint: false };
  }
  if (!forced && CI_KEYS.some((k) => truthy(env[k]))) {
    return { action: "skip", reason: "CI", hint: true };
  }
  if (!p.homeDir) {
    return { action: "skip", reason: "no home directory", hint: true };
  }
  if (p.platform !== "darwin" && p.platform !== "linux") {
    return { action: "skip", reason: `unsupported platform ${p.platform}`, hint: true };
  }
  if (p.switchPending) {
    return { action: "skip", reason: "a channel switch is pending", hint: false };
  }
  if (p.serviceRunning) {
    return { action: "skip", reason: "the service is running", hint: false };
  }
  return { action: "run" };
}

/**
 * The installed CLI entry beside the bundled postinstall script
 * (`dist/postinstall.js` → `dist/index.js`). `process.argv[1]` cannot be
 * used here: under npm it names the lifecycle script, not the CLI, so a
 * path derived from it would bake the wrong entry into the handler and
 * the login unit.
 */
export function installedCliPath(moduleDir: string): string {
  return path.join(moduleDir, "index.js");
}

/**
 * True when `moduleDir` (the bundled postinstall's `dist/`) sits in the
 * global install layout `<prefix>/lib/node_modules/unvibe/packages/
 * service/dist`. False in a source checkout and in npm's git-preparation
 * clone, whose path is deleted as soon as preparation finishes.
 */
export function isInstalledLayout(moduleDir: string): boolean {
  const pkgRoot = path.resolve(moduleDir, "..", "..", "..");
  return path.basename(path.dirname(pkgRoot)) === "node_modules" && path.basename(pkgRoot) === "unvibe";
}

export interface PostinstallDeps extends PostinstallProbe {
  paths: SetupPaths;
  port: number;
  dataDir: string;
  runner?: SetupRunner;
  ensureToken: (dataDir: string) => void;
  log: (line: string) => void;
  install?: typeof installSetup;
}

/** Run the postinstall. Always resolves; the caller exits 0 regardless. */
export async function runPostinstall(deps: PostinstallDeps): Promise<PostinstallDecision> {
  const decision = decidePostinstall(deps);
  if (decision.action === "skip") {
    if (decision.hint) deps.log(POSTINSTALL_HINT);
    return decision;
  }
  try {
    deps.ensureToken(deps.dataDir);
    const install = deps.install ?? installSetup;
    await install(deps.paths, deps.runner, deps.platform, { port: deps.port, dataDir: deps.dataDir });
  } catch {
    deps.log(POSTINSTALL_HINT);
  }
  return decision;
}
