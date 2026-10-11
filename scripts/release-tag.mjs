/*global console process */
// `mise run release:tag -- <version>`: cut a release tag repeatably.
//
// Final (e.g. `0.0.1`): requires a clean tree on `main` with CI green for
// HEAD, bumps the version everywhere it lives (root + workspace
// package.jsons, the workspace cross-dep, SERVICE_VERSION,
// MCP_SERVICE_VERSION, package-lock via npm), commits the bump, and creates
// tag `v<version>`. Push with `git push origin main v<version>` (tag push
// triggers .github/workflows/release.yml).
//
// Candidate (e.g. `0.0.1-rc.1`): no bump and no main requirement — just
// verifies the tree is clean and creates tag `v<version>` on HEAD. The
// release workflow takes the version from the tag and patches the built
// bundle, so the source can stay at the base version. Push the tag to
// exercise the workflow (`git push origin v<version>`); the candidate
// publishes to the `release-rc` branch and a pre-release, never `release`.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const raw = args.find((a) => !a.startsWith("-"));
const skipCi = args.includes("--skip-ci-check");
if (!raw) {
  console.error("usage: mise run release:tag -- <version> [--skip-ci-check]\n  e.g. mise run release:tag -- 0.0.1   (final)\n       mise run release:tag -- 0.0.1-rc.1 (candidate, no bump)");
  process.exit(1);
}
const version = raw.startsWith("v") ? raw.slice(1) : raw;
if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version)) {
  console.error(`release-tag: bad version ${JSON.stringify(raw)} — want X.Y.Z or X.Y.Z-rc.N`);
  process.exit(1);
}
const isRc = version.includes("-rc.");
const tag = `v${version}`;

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", timeout: 300_000, ...opts });
  if ((opts.check ?? true) && r.status !== 0) {
    console.error(`release-tag: ${cmd} ${argv.join(" ")} failed\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

// 1. Clean tree.
const dirty = sh("git", ["status", "--porcelain"]);
if (dirty) {
  console.error(`release-tag: tree is dirty — commit or stash first:\n${dirty}`);
  process.exit(1);
}

// 2. Branch: finals must be on main; candidates may be anywhere.
const branch = sh("git", ["branch", "--show-current"]);
if (!isRc && branch !== "main") {
  console.error(`release-tag: finals must be cut from main (here on ${JSON.stringify(branch)})`);
  process.exit(1);
}
console.log(`release-tag: on branch ${branch}, cutting ${tag}${isRc ? " (candidate: no version bump)" : ""}`);

// 3. Tag must not already exist (local or remote).
if (sh("git", ["tag", "--list", tag])) {
  console.error(`release-tag: tag ${tag} already exists locally`);
  process.exit(1);
}
const lsRemote = sh("git", ["ls-remote", "origin", `refs/tags/${tag}`], { check: false });
if (lsRemote) {
  console.error(`release-tag: tag ${tag} already exists on origin`);
  process.exit(1);
}

// 4. CI green for HEAD (unless skipped).
const head = sh("git", ["rev-parse", "HEAD"]);
if (!skipCi) {
  const runsJson = sh("gh", ["run", "list", "--commit", head, "--json", "name,conclusion,status", "--limit", "10"]);
  let runs = [];
  try {
    runs = JSON.parse(runsJson || "[]");
  } catch {
    runs = [];
  }
  const ci = runs.filter((r) => r.name === "ci");
  const green = ci.some((r) => r.conclusion === "success");
  if (!green) {
    console.error(
      `release-tag: no successful ci run for ${head.slice(0, 12)} (branch ${branch}). Push first and wait, or re-run with --skip-ci-check.`,
    );
    process.exit(1);
  }
  console.log(`release-tag: CI green for ${head.slice(0, 12)}`);
} else {
  console.log("release-tag: skipping CI check (--skip-ci-check)");
}

if (isRc) {
  sh("git", ["tag", tag]);
  console.log(`release-tag: created ${tag} on ${head.slice(0, 12)} (no bump for candidates)`);
  console.log(`next: git push origin ${tag}   # triggers the release workflow (publishes to release-rc + pre-release)`);
  process.exit(0);
}

// 5. Bump the version everywhere it lives.
const bumpJson = (rel) => {
  const p = path.join(ROOT, rel);
  const pj = JSON.parse(readFileSync(p, "utf8"));
  pj.version = version;
  if (pj.dependencies?.["@unvibe/shared"]) pj.dependencies["@unvibe/shared"] = version;
  writeFileSync(p, JSON.stringify(pj, null, 2) + "\n");
  console.log(`release-tag: ${rel} -> ${version}`);
};
for (const f of ["package.json", "packages/service/package.json", "packages/shared/package.json", "packages/web/package.json"]) {
  bumpJson(f);
}
const bumpConst = (rel, name) => {
  const p = path.join(ROOT, rel);
  const src = readFileSync(p, "utf8");
  const re = new RegExp(`(export const ${name} = ")\\d+\\.\\d+\\.\\d+(?:-rc\\.\\d+)?(")`);
  if (!re.test(src)) {
    console.error(`release-tag: cannot find ${name} in ${rel}`);
    process.exit(1);
  }
  writeFileSync(p, src.replace(re, `$1${version}$2`));
  console.log(`release-tag: ${rel} ${name} -> ${version}`);
};
bumpConst("packages/service/src/server.ts", "SERVICE_VERSION");
bumpConst("packages/service/src/mcp/registry.ts", "MCP_SERVICE_VERSION");

// Sync package-lock.json versions without a full install.
sh("npm", ["install", "--package-lock-only", "--ignore-scripts"]);

// 6. Commit the bump + tag.
sh("git", ["add", "package.json", "packages/service/package.json", "packages/shared/package.json", "packages/web/package.json", "package-lock.json", "packages/service/src/server.ts", "packages/service/src/mcp/registry.ts"]);
const staged = sh("git", ["status", "--porcelain"]);
if (!staged) {
  console.log("release-tag: version already current, no bump commit needed");
} else {
  sh("git", ["commit", "-m", `release: v${version}`]);
  console.log(`release-tag: committed version bump v${version}`);
}
sh("git", ["tag", tag]);
console.log(`release-tag: created ${tag} on ${sh("git", ["rev-parse", "--short", "HEAD"])}`);
console.log(`next: git push origin main ${tag}   # tag push triggers the release workflow (publishes to release + GitHub release)`);
