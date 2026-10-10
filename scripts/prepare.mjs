/*global console process URL */
 // `prepare` (runs on `npm install -g github:<org>/unvibe` and before
// `npm pack`): build service + web dist from a git install, where
// workspaces + devDependencies are present. Skips when dist is already
// built so plain `npm install` in a checkout stays fast.
import { existsSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const NEEDED = [
  "packages/shared/dist/index.js",
  "packages/service/dist/index.js",
  "packages/web/dist/index.html",
];

const DIST_DIRS = ["packages/shared/dist", "packages/service/dist", "packages/web/dist"];

const WIN = process.platform === "win32";

/**
 * Env for child npm calls: `npm install -g <git-url>` runs this script
 * with npm's global mode inherited via npm_config_global, in which
 * workspace commands refuse to run ("Workspaces not supported for global
 * packages"). The build runs inside a source tree, not the global prefix,
 * so drop the global-mode config for children (verified by the git phase
 * of scripts/global-install-check.mjs).
 */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.npm_config_global;
  delete env.npm_config_location;
  return env;
}

function binsPresent(rootDir) {
  // typescript (root devDep) is what the workspace builds shell out to.
  return existsSync(join(rootDir, "node_modules", "typescript"));
}

function distPresent(rootDir) {
  return NEEDED.every((f) => existsSync(join(rootDir, f)));
}

function runBuild(cwd) {
  const r = spawnSync("npm", ["run", "build", "--workspaces", "--if-present"], {
    cwd,
    stdio: "inherit",
    shell: WIN,
    env: childEnv(),
  });
  if (r.status !== 0) {
    console.error("prepare: build failed");
    process.exit(r.status ?? 1);
  }
}

const rootDir = fileURLToPath(new URL("../", import.meta.url));

if (distPresent(rootDir)) {
  console.log("prepare: dist present, skipping build");
} else if (binsPresent(rootDir) || process.env.UNVIBE_PREPARE_NESTED) {
  console.log("prepare: building workspaces…");
  runBuild(rootDir);
} else {
  // Git installs through a global `npm install -g` reach prepare with no
  // usable local node_modules — and the outer npm process still owns that
  // tree, so installing into it races (ENOTEMPTY). Build in an isolated
  // copy instead, then copy the dist output back: the sources are small
  // (a few MB) and the copy is fully ours. The nested install re-runs
  // this script with UNVIBE_PREPARE_NESTED set, which takes the direct
  // build branch above (bins are present by then).
  console.log("prepare: isolated build (no local node_modules)…");
  const copy = mkdtempSync(join(tmpdir(), "unvibe-prepare-"));
  try {
    cpSync(rootDir, copy, {
      recursive: true,
      filter: (src) => {
        const rel = relative(rootDir, src).split(sep).join("/");
        if (rel === "") return true;
        if (rel === "node_modules" || rel.startsWith("node_modules/")) return false;
        if (rel === ".git" || rel.startsWith(".git/")) return false;
        if (DIST_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return false;
        return true;
      },
    });
    console.log("prepare: installing dependencies in the isolated copy…");
    const inst = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: copy,
      stdio: "inherit",
      shell: WIN,
      env: childEnv({ UNVIBE_PREPARE_NESTED: "1" }),
    });
    if (inst.status !== 0) {
      console.error("prepare: dependency install failed");
      process.exit(inst.status ?? 1);
    }
    // The nested install's own prepare already built; build here only if
    // it somehow did not (e.g. lifecycle scripts disabled).
    if (!distPresent(copy)) {
      console.log("prepare: building workspaces in the isolated copy…");
      runBuild(copy);
    }
    for (const d of DIST_DIRS) {
      const dest = join(rootDir, d);
      rmSync(dest, { recursive: true, force: true });
      cpSync(join(copy, d), dest, { recursive: true });
    }
    console.log("prepare: isolated build copied back");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
