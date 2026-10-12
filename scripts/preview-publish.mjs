/*global console process */
/**
 * `mise run preview:publish [-- <branch>] [--push] [--as-is] [--all] [--prune]`
 * (issues #36, #41): publish branches as installable builds on orphan refs
 * `preview/<slug>`.
 *
 * - Default: build current local `main` merged with the branch in a
 *   throwaway detached worktree (add at `main`, merge the branch, install,
 *   build, release, remove the worktree — also on failure). A merge
 *   conflict is reported clearly and nothing is published. The branch
 *   needs no worktree of its own. `--as-is` keeps the old behaviour
 *   (build the branch exactly as it stands).
 * - `--all`: publish every local branch with commits not on `main`, plus
 *   `main` itself; one branch failing does not stop the rest; a summary
 *   prints at the end.
 * - `--prune`: list `preview/*` refs whose source branch is merged into
 *   `main` or deleted (dry run). With `--push` they are deleted locally
 *   and on `origin` instead. Only refs under `preview/` may ever pass.
 * - The generated package.json records both sides
 *   (`main@<sha> + <branch>@<sha>` in the `unvibe` field, written by
 *   release.mjs) so `unvibe update --list` (and the in-app picker) can
 *   show what a channel is.
 * - Pushing is opt-in and confined to `preview/*`: only `--push` pushes,
 *   publishes via the exact refspec
 *   `refs/heads/preview/<slug>:refs/heads/preview/<slug>` (guarded by
 *   `assertPreviewPushRefspec` — no other ref can pass) and prunes via
 *   `git push origin --delete preview/<slug>` (guarded by
 *   `assertPreviewDeleteRef`). Without `--push` it prints the commands.
 *   Source branches never leave the machine. The throwaway build always
 *   corresponds to commits (never a dirty tree).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPreviewDeleteRef,
  assertPreviewPushRefspec,
  branchSlug,
  isValidPreviewVersion,
  previewPushRefspec,
  previewRef,
  previewVersion,
  resolveWorktree,
  selectAllBranches,
  selectPruneRefs,
} from "./preview-lib.mjs";

const HERE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "main";

const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log(
    [
      "usage: mise run preview:publish [-- <branch>] [--push] [--as-is] [--all] [--prune]",
      "  <branch>  publish that branch (default: this checkout's branch; --all publishes many)",
      "  default   build main merged with the branch in a throwaway worktree (no worktree needed)",
      "  --as-is   build the branch exactly as it stands (old behaviour)",
      "  --all     publish every local branch with commits not on main, plus main itself",
      "  --prune   list preview/* refs whose source branch is merged or deleted (dry run)",
      "  --push    push published preview/<slug> refs; with --prune, delete the listed refs",
      "            locally and on origin (otherwise only prints the commands)",
      "  refuses a dirty tree for --as-is builds in place; merged builds come",
      "  from commits only, so a dirty tree can never leak into them;",
      "  never pushes or deletes refs outside preview/*",
    ].join("\n"),
  );
  process.exit(0);
}
const doPush = rawArgs.includes("--push");
const asIs = rawArgs.includes("--as-is");
const all = rawArgs.includes("--all");
const prune = rawArgs.includes("--prune");
const branchArg = rawArgs.find((a) => !a.startsWith("-")) ?? null;
for (const a of rawArgs) {
  if (a.startsWith("-") && !["--push", "--as-is", "--all", "--prune"].includes(a)) {
    console.error(`preview: unknown flag ${JSON.stringify(a)} (see --help)`);
    process.exit(2);
  }
}
if (all && branchArg) {
  console.error("preview: --all publishes every unmerged branch — pass no branch name with it");
  process.exit(2);
}
if (prune && branchArg) {
  console.error("preview: --prune takes no branch name");
  process.exit(2);
}

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

function fail(msg) {
  console.error(`preview: ${msg}`);
  process.exit(1);
}

/**
 * Throw instead of exiting: publish flows run one branch at a time and
 * `--all` must continue with the rest when one branch fails. Only the
 * top-level arg/target selection (before anything is published) exits
 * directly via `fail`.
 */
function throwErr(msg) {
  throw new Error(msg);
}

/** Full sha of a local branch, or null when it does not exist. */
function branchSha(branch) {
  const r = sh("git", ["rev-parse", "--verify", `refs/heads/${branch}`], HERE_ROOT);
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

function shortOf(sha) {
  return shOrFail("git", ["rev-parse", "--short", sha], HERE_ROOT);
}

/** Remove a throwaway worktree (best effort; warns when manual cleanup remains). */
function removeThrowaway(dir, added) {
  if (added) {
    const r = sh("git", ["worktree", "remove", "--force", dir], HERE_ROOT);
    sh("git", ["worktree", "prune"], HERE_ROOT);
    if (r.status !== 0) {
      console.error(
        `preview: could not remove throwaway worktree ${dir} — remove it by hand: \`git worktree remove --force ${dir}\``,
      );
    }
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Trust a throwaway worktree's mise.toml (issue #41): the worktree is new,
 * so mise does not trust its config yet and mise-shimmed `node`/`npm`
 * refuse to run inside it. Trust is machine-local; the directory is
 * removed afterwards, leaving only a stale trust entry behind.
 */
function trustWorktree(dir) {
  const r = sh("mise", ["trust", path.join(dir, "mise.toml")], HERE_ROOT);
  if (r.status !== 0) {
    console.error(
      `preview: warning: could not mise-trust ${dir} (mise missing?) — install/build may fail:\n${r.stderr ?? ""}`.trim(),
    );
  }
}

/** Build + release inside `dir`, then record the local orphan ref. Shared by merged and as-is flows. */
function buildAndRelease({ dir, ref, releaseArgs, label }) {
  const install = sh("npm", ["install"], dir, { stdio: "inherit", timeout: 600_000 });
  if (install.status !== 0) throwErr(`${label}: npm install failed — nothing published`);
  for (const buildArgs of [
    ["run", "build", "--workspaces", "--if-present"],
    ["run", "build", "--workspace", "@unvibe/web", "--if-present"],
  ]) {
    const b = sh("npm", buildArgs, dir, { stdio: "inherit", timeout: 600_000 });
    if (b.status !== 0) throwErr(`${label}: build failed (npm ${buildArgs.join(" ")}) — nothing published`);
  }
  const rel = sh("node", [path.join(dir, "scripts", "release.mjs"), ...releaseArgs], dir, {
    stdio: "inherit",
    timeout: 600_000,
  });
  if (rel.status !== 0) throwErr(`${label}: scripts/release.mjs failed — nothing published`);
  const sha = sh("git", ["rev-parse", "--short", ref], HERE_ROOT);
  if (sha.status !== 0) throwErr(`${label}: release produced no ref ${ref}`);
  const localSha = (sha.stdout ?? "").trim();
  console.log(`preview: local ref ${ref} -> ${localSha}`);
  return localSha;
}

/** Push a published ref (opt-in) or print the commands. */
function pushOrPrint(slug, ref, version, label) {
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
    const pushed = sh("git", ["push", "--force", "origin", refspec], HERE_ROOT, { stdio: "inherit" });
    if (pushed.status !== 0) throwErr(`${label}: git push ${refspec} failed — published locally only`);
    console.log(`preview: pushed ${refspec}`);
    console.log(`preview: install with ${installCmd}`);
  }
  return { version, ref };
}

/**
 * Publish one branch merged onto local main (default): throwaway detached
 * worktree at main, merge the branch, install, build, release, remove the
 * worktree (also on failure). Returns { branch, ok, version?, ref?, error? }.
 */
function publishMerged(branch) {
  const label = `preview:${branch}`;
  const sourceSha = branchSha(branch);
  if (!sourceSha) return { branch, ok: false, error: `no local branch ${JSON.stringify(branch)}` };
  const mainSha = branchSha(BASE);
  if (!mainSha) return { branch, ok: false, error: `no local branch ${JSON.stringify(BASE)} — cannot merge` };
  const slug = branchSlug(branch);
  if (!slug) return { branch, ok: false, error: `branch ${JSON.stringify(branch)} has no usable slug` };

  const dir = mkdtempSync(path.join(tmpdir(), "unvibe-preview-"));
  let added = false;
  try {
    const add = sh("git", ["worktree", "add", "--detach", dir, BASE], HERE_ROOT);
    if (add.status !== 0) {
      return { branch, ok: false, error: `git worktree add failed:\n${add.stdout ?? ""}\n${add.stderr ?? ""}`.trim() };
    }
    added = true;
    trustWorktree(dir);
    const msg = `preview: ${BASE}@${mainSha.slice(0, 7)} + ${branch}@${sourceSha.slice(0, 7)}`;
    const merge = sh("git", ["merge", "--no-edit", "-m", msg, sourceSha], dir);
    if (merge.status !== 0) {
      return {
        branch,
        ok: false,
        error:
          `merge conflict merging ${branch} into ${BASE} — nothing published.\n` +
          `Rebase the branch onto ${BASE} and retry. Git said:\n${merge.stdout ?? ""}\n${merge.stderr ?? ""}`.trim(),
      };
    }
    const fullsha = shOrFail("git", ["rev-parse", "HEAD"], dir);
    const base = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
    const version = previewVersion(base, slug, shortOf(fullsha));
    if (!isValidPreviewVersion(version)) {
      return { branch, ok: false, error: `derived version ${JSON.stringify(version)} is not valid semver — refusing` };
    }
    const ref = previewRef(slug);
    console.log(`preview: ${BASE} @ ${mainSha} + ${branch} @ ${sourceSha} (merge ${fullsha}) in ${dir}`);
    console.log(`preview: version ${version} (base ${base}), ref ${ref}`);
    buildAndRelease({
      dir,
      ref,
      releaseArgs: [
        "--version", version,
        "--branch", ref,
        "--source-branch", branch,
        "--source-commit", sourceSha,
        "--base-branch", BASE,
        "--base-commit", mainSha,
      ],
      label,
    });
    pushOrPrint(slug, ref, version, label);
    return { branch, ok: true, version, ref };
  } finally {
    removeThrowaway(dir, added);
  }
}

/**
 * Publish one branch exactly as it stands (--as-is): in its worktree when
 * it has one (refusing a dirty tree there), in this checkout for the
 * default branch (refusing a dirty tree), or in a throwaway detached
 * worktree at the branch when it has none.
 */
function publishAsIs(branch, worktreeDir) {
  const label = `preview:${branch}`;
  const sourceSha = branchSha(branch);
  if (!sourceSha) return { branch, ok: false, error: `no local branch ${JSON.stringify(branch)}` };
  const slug = branchSlug(branch);
  if (!slug) return { branch, ok: false, error: `branch ${JSON.stringify(branch)} has no usable slug` };

  let dir = worktreeDir;
  let added = false;
  let tmp = null;
  if (!dir) {
    tmp = mkdtempSync(path.join(tmpdir(), "unvibe-preview-"));
    const add = sh("git", ["worktree", "add", "--detach", tmp, branch], HERE_ROOT);
    if (add.status !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      return { branch, ok: false, error: `git worktree add failed:\n${add.stdout ?? ""}\n${add.stderr ?? ""}`.trim() };
    }
    added = true;
    dir = tmp;
    trustWorktree(dir);
  } else {
    const dirty = shOrFail("git", ["status", "--porcelain"], dir);
    if (dirty) {
      return { branch, ok: false, error: `tree is dirty in ${dir} — commit or stash first:\n${dirty}` };
    }
  }
  try {
    const base = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
    const fullsha = shOrFail("git", ["rev-parse", "HEAD"], dir);
    const version = previewVersion(base, slug, shortOf(fullsha));
    if (!isValidPreviewVersion(version)) {
      return { branch, ok: false, error: `derived version ${JSON.stringify(version)} is not valid semver — refusing` };
    }
    const ref = previewRef(slug);
    console.log(`preview: branch ${branch} @ ${fullsha} in ${dir} (as-is)`);
    console.log(`preview: version ${version} (base ${base}), ref ${ref}`);
    buildAndRelease({
      dir,
      ref,
      releaseArgs: ["--version", version, "--branch", ref, "--source-branch", branch, "--source-commit", sourceSha],
      label,
    });
    pushOrPrint(slug, ref, version, label);
    return { branch, ok: true, version, ref };
  } finally {
    if (tmp) removeThrowaway(tmp, added);
  }
}

/** Resolve a single publish target: explicit branch or this checkout's branch. */
function singleTarget() {
  if (branchArg) return { branch: branchArg, worktreeDir: null };
  const branch = shOrFail("git", ["rev-parse", "--abbrev-ref", "HEAD"], HERE_ROOT);
  if (branch === "HEAD") fail("detached HEAD — pass a branch name: `mise run preview:publish -- <branch>`");
  return { branch, worktreeDir: HERE_ROOT };
}

/** Publish targets for --all: every local branch ahead of main, plus main itself. */
function allTargets() {
  if (!branchSha(BASE)) fail(`no local branch ${JSON.stringify(BASE)} — cannot select --all branches`);
  const allBranches = shOrFail("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], HERE_ROOT)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const ahead = [];
  for (const b of allBranches) {
    if (b === BASE) continue;
    const r = sh("git", ["rev-list", "--count", `${BASE}..${b}`, "--"], HERE_ROOT);
    if (r.status === 0 && Number((r.stdout ?? "").trim()) > 0) ahead.push(b);
  }
  return selectAllBranches(allBranches, ahead, BASE);
}

function publishOne(branch, worktreeDir) {
  if (asIs) {
    let dir = worktreeDir;
    if (branchArg && !dir) {
      const list = shOrFail("git", ["worktree", "list", "--porcelain"], HERE_ROOT);
      dir = resolveWorktree(list, branch);
    }
    return publishAsIs(branch, dir);
  }
  return publishMerged(branch);
}

function printSummary(results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`preview: ${ok.length} published, ${failed.length} failed`);
  for (const r of ok) console.log(`  ok: ${r.branch} -> ${r.ref} (${r.version})`);
  for (const r of failed) console.log(`  FAIL: ${r.branch}: ${(r.error ?? "unknown error").split("\n")[0]}`);
}

/** `--prune`: list (dry run) or delete (with `--push`) stale `preview/*` refs. */
function runPrune() {
  const refs = shOrFail("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/preview/"], HERE_ROOT)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const entries = refs.map((ref) => {
    let sourceBranch = null;
    const r = sh("git", ["show", `${ref}:package.json`], HERE_ROOT);
    if (r.status === 0) {
      try {
        const pkg = JSON.parse(r.stdout ?? "");
        if (typeof pkg?.unvibe?.sourceBranch === "string" && pkg.unvibe.sourceBranch.length > 0) {
          sourceBranch = pkg.unvibe.sourceBranch;
        }
      } catch {
        sourceBranch = null;
      }
    }
    return { ref, sourceBranch };
  });
  const merged = shOrFail("git", ["branch", "--merged", BASE, "--format=%(refname:short)"], HERE_ROOT)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const existing = shOrFail("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], HERE_ROOT)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const stale = selectPruneRefs(entries, merged, existing, BASE);
  const unknown = entries.filter((e) => !e.sourceBranch).map((e) => e.ref);
  if (stale.length === 0) {
    console.log("preview: nothing to prune (no preview/* ref has a merged or deleted source branch)");
    if (unknown.length > 0) {
      console.log(`preview: kept ${unknown.length} ref(s) with unreadable provenance: ${unknown.join(", ")}`);
    }
    return true;
  }
  if (!doPush) {
    console.log("preview: dry run — pass --push to delete these locally and on origin:");
    for (const s of stale) console.log(`  would delete ${s.ref} (${s.reason})`);
    if (unknown.length > 0) {
      console.log(`preview: kept ${unknown.length} ref(s) with unreadable provenance: ${unknown.join(", ")}`);
    }
    return true;
  }
  let failed = 0;
  for (const s of stale) {
    try {
      assertPreviewDeleteRef(s.ref);
    } catch (err) {
      console.error(`preview: refusing to delete ${s.ref}: ${String(err)}`);
      failed += 1;
      continue;
    }
    const local = sh("git", ["update-ref", "-d", `refs/heads/${s.ref}`], HERE_ROOT);
    if (local.status !== 0) {
      console.error(`preview: could not delete local ${s.ref}:\n${local.stderr ?? ""}`);
      failed += 1;
      continue;
    }
    console.log(`preview: deleted local ${s.ref} (${s.reason})`);
    const remote = sh("git", ["push", "origin", "--delete", s.ref], HERE_ROOT);
    if (remote.status !== 0) {
      console.error(
        `preview: local ${s.ref} deleted, but \`git push origin --delete ${s.ref}\` failed (kept going):\n${remote.stderr ?? ""}`.trim(),
      );
    } else {
      console.log(`preview: deleted origin ${s.ref}`);
    }
  }
  return failed === 0;
}

// --- main ---
const results = [];
if (all) {
  const targets = allTargets();
  console.log(`preview: publishing ${targets.length} branch(es): ${targets.join(", ")}`);
  for (const branch of targets) {
    try {
      const r = publishOne(branch, null);
      results.push(r);
      if (!r.ok) console.error(`preview: ${branch} failed: ${r.error}`);
    } catch (err) {
      results.push({ branch, ok: false, error: String(err) });
      console.error(`preview: ${branch} threw: ${String(err)}`);
    }
  }
  printSummary(results);
} else if (branchArg || !prune) {
  const { branch, worktreeDir } = singleTarget();
  try {
    results.push(publishOne(branch, worktreeDir));
  } catch (err) {
    results.push({ branch, ok: false, error: String(err) });
  }
  printSummary(results);
}
if (prune) {
  const pruneOk = runPrune();
  if (!pruneOk) results.push({ branch: "(prune)", ok: false, error: "prune deletes failed" });
}
if (results.some((r) => !r.ok)) process.exit(1);
