/*global console process */
/**
 * `mise run preview:publish [-- <branch>] [--push]` (issue #36): publish a
 * branch as an installable build on the orphan ref `preview/<slug>`.
 *
 * - Default: the checkout this script runs from (its own worktree/branch).
 *   With a branch argument, resolves that branch's worktree via
 *   `git worktree list --porcelain` and fails clearly when it has none.
 * - Refuses a dirty tree, so the build always corresponds to a commit.
 * - Builds in the target worktree, then runs that worktree's own
 *   `scripts/release.mjs` with `--version <base>-preview.<slug>.<shortsha>`
 *   and `--branch preview/<slug>` (helpers in `preview-lib.mjs`).
 * - Pushing is opt-in and confined to `preview/*`: only `--push` pushes,
 *   via the exact refspec `refs/heads/preview/<slug>:refs/heads/preview/<slug>`
 *   (guarded by `assertPreviewPushRefspec` — no other ref can pass).
 *   Without `--push` it prints the push command and the install command.
 *   The release tree's generated package.json records source branch, full
 *   commit sha and build time (`unvibe` field, written by release.mjs) so
 *   `unvibe update --list` (and later the in-app picker) can show what a
 *   channel is.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPreviewPushRefspec,
  branchSlug,
  isValidPreviewVersion,
  previewPushRefspec,
  previewRef,
  previewVersion,
  resolveWorktree,
} from "./preview-lib.mjs";

const HERE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log(
    [
      "usage: mise run preview:publish [-- <branch>] [--push]",
      "  <branch>  publish that branch's worktree (default: this checkout's branch)",
      "  --push    push refs/heads/preview/<slug> (otherwise only prints the commands)",
      "  refuses a dirty tree; never pushes refs outside preview/*",
    ].join("\n"),
  );
  process.exit(0);
}
const doPush = rawArgs.includes("--push");
const branchArg = rawArgs.find((a) => !a.startsWith("-")) ?? null;

function sh(cmd, args, cwd, opts = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000, ...opts });
  return r;
}

function shOrFail(cmd, args, cwd, opts = {}) {
  const r = sh(cmd, args, cwd, opts);
  if (r.status !== 0) {
    console.error(`preview: ${cmd} ${args.join(" ")} failed\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

// 1. Resolve the target worktree + branch.
let targetDir;
let branch;
if (branchArg) {
  const list = shOrFail("git", ["worktree", "list", "--porcelain"], HERE_ROOT);
  const found = resolveWorktree(list, branchArg);
  if (!found) {
    console.error(
      `preview: no worktree for branch ${JSON.stringify(branchArg)} — create one first, e.g. \`git worktree add ../wt-${branchSlug(branchArg) || "x"} ${branchArg}\``,
    );
    process.exit(1);
  }
  targetDir = found;
  branch = branchArg;
} else {
  branch = shOrFail("git", ["rev-parse", "--abbrev-ref", "HEAD"], HERE_ROOT);
  if (branch === "HEAD") {
    console.error("preview: detached HEAD — pass a branch name: `mise run preview:publish -- <branch>`");
    process.exit(1);
  }
  targetDir = HERE_ROOT;
}

// 2. Refuse a dirty tree.
const dirty = shOrFail("git", ["status", "--porcelain"], targetDir);
if (dirty) {
  console.error(`preview: tree is dirty in ${targetDir} — commit or stash first:\n${dirty}`);
  process.exit(1);
}

// 3. Derive slug / version / ref.
const slug = branchSlug(branch);
if (!slug) {
  console.error(`preview: branch ${JSON.stringify(branch)} has no usable slug`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(path.join(targetDir, "package.json"), "utf8")).version;
const shortsha = shOrFail("git", ["rev-parse", "--short", "HEAD"], targetDir);
const fullsha = shOrFail("git", ["rev-parse", "HEAD"], targetDir);
const version = previewVersion(base, slug, shortsha);
if (!isValidPreviewVersion(version)) {
  console.error(`preview: derived version ${JSON.stringify(version)} is not valid semver — refusing`);
  process.exit(1);
}
const ref = previewRef(slug);
console.log(`preview: branch ${branch} @ ${fullsha} in ${targetDir}`);
console.log(`preview: version ${version} (base ${base}), ref ${ref}`);

// 4. Build in the target worktree (same commands as `mise run build`, minus
// the 1Password wrapper — releases build without secrets too).
for (const buildArgs of [
  ["run", "build", "--workspaces", "--if-present"],
  ["run", "build", "--workspace", "@unvibe/web", "--if-present"],
]) {
  const b = sh("npm", buildArgs, targetDir, { stdio: "inherit", timeout: 600_000 });
  if (b.status !== 0) {
    console.error(`preview: build failed (npm ${buildArgs.join(" ")})`);
    process.exit(b.status ?? 1);
  }
}

// 5. Release tree + local orphan ref via the target worktree's own release.mjs.
const rel = sh(
  "node",
  [path.join(targetDir, "scripts", "release.mjs"), "--version", version, "--branch", ref, "--source-branch", branch],
  targetDir,
  { stdio: "inherit", timeout: 600_000 },
);
if (rel.status !== 0) {
  console.error("preview: scripts/release.mjs failed");
  process.exit(rel.status ?? 1);
}
const localSha = shOrFail("git", ["rev-parse", "--short", ref], targetDir);
console.log(`preview: local ref ${ref} -> ${localSha}`);

// 6. Push (opt-in, preview-only) or print the commands.
const refspec = previewPushRefspec(slug);
assertPreviewPushRefspec(refspec);
const pushCmd = `git push --force origin ${refspec}`;
const installCmd = `npm install -g github:indigoviolet/unvibe#${ref}`;
if (!doPush) {
  console.log("preview: no push performed (pass --push to push).");
  console.log(`  ${pushCmd}`);
  console.log(`  then on the test machine: ${installCmd}`);
  console.log(`  or step through channels with: unvibe update --list`);
} else {
  shOrFail("git", ["push", "--force", "origin", refspec], targetDir, { stdio: "inherit" });
  console.log(`preview: pushed ${refspec}`);
  console.log(`preview: install with ${installCmd}`);
}
