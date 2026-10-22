/**
 * Pure helpers for `scripts/preview-publish.mjs` (issue #36), kept in their
 * own dependency-free module so vitest can import them directly
 * (`packages/service/test/preview-publish.test.ts`).
 *
 * Naming:
 * - branch `feat/repo-add-by-url` -> slug `feat-repo-add-by-url`
 * - version `<base>-preview.<slug>.<shortsha>` (e.g. `0.0.1-preview.feat-x.abc1234`)
 * - ref `preview/<slug>`
 *
 * The slug must be safe both as a single semver prerelease identifier and
 * as one git ref segment. The version's other identifiers (`preview`, the
 * short sha) are fixed hex/alpha words, so only the slug needs shaping.
 */

/** Make a branch name safe for a semver prerelease identifier + ref segment. */
export function branchSlug(branch) {
  const slug = String(branch ?? "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  // A purely numeric identifier must not carry leading zeros (semver rule),
  // so numeric branch names get a `b` prefix (`007` -> `b007`).
  if (/^\d+$/.test(slug)) return `b${slug}`;
  return slug;
}

/** `true` when `id` is a valid semver prerelease identifier. */
export function isPrereleaseIdentifier(id) {
  if (!/^[0-9A-Za-z-]+$/.test(id)) return false;
  // Numeric identifiers must not include leading zeros (semver §9).
  if (/^\d+$/.test(id) && id.length > 1 && id.startsWith("0")) return false;
  return true;
}

/**
 * Assemble `<base>-preview.<slug>.<shortsha>`. Returns the version string;
 * use `isValidPreviewVersion` to check it (short shas are hex and can, in
 * principle, be all digits with a leading zero).
 */
export function previewVersion(base, slug, shortsha) {
  return `${base}-preview.${slug}.${shortsha}`;
}

/** `true` when `version` has the exact `<X.Y.Z>-preview.<slug>.<sha>` shape. */
export function isValidPreviewVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)-preview\.([0-9A-Za-z-]+)\.([0-9A-Za-z-]+)$/.exec(
    String(version ?? ""),
  );
  if (!m) return false;
  return isPrereleaseIdentifier(m[4]) && isPrereleaseIdentifier(m[5]);
}

/** `preview/<slug>` from a slug. */
export function previewRef(slug) {
  return `preview/${slug}`;
}

/** `true` when `ref` is a pushable preview ref (`preview/<name>`). */
export function isPreviewRef(ref) {
  return /^preview\/[A-Za-z0-9._-]+$/.test(String(ref ?? ""));
}

/**
 * Build the only refspec this tooling may ever push:
 * `refs/heads/preview/<slug>:refs/heads/preview/<slug>`.
 */
export function previewPushRefspec(slug) {
  const ref = previewRef(slug);
  if (!isPreviewRef(ref)) throw new Error(`not a preview ref: ${JSON.stringify(ref)}`);
  return `refs/heads/${ref}:refs/heads/${ref}`;
}

/**
 * Guard: throw unless `refspec` pushes exactly one `refs/heads/preview/*`
 * ref onto itself. Call immediately before any `git push`.
 */
export function assertPreviewPushRefspec(refspec) {
  const m = /^(refs\/heads\/preview\/[A-Za-z0-9._-]+):(refs\/heads\/preview\/[A-Za-z0-9._-]+)$/.exec(
    String(refspec ?? ""),
  );
  if (!m || m[1] !== m[2]) {
    throw new Error(`refusing to push non-preview refspec: ${JSON.stringify(refspec)}`);
  }
  return refspec;
}

/**
 * Parse `git worktree list --porcelain` into
 * `[{ path, branch | null, detached }]`. `branch` is the short name
 * (`feat/x`), null for detached worktrees.
 */
export function parseWorktreeList(output) {
  const entries = [];
  let current = null;
  for (const line of String(output ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim(), branch: null, detached: false };
      entries.push(current);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (current && line === "detached") {
      current.detached = true;
    }
  }
  return entries;
}

/** Worktree path for `branch`, or null when the branch has no worktree. */
export function resolveWorktree(output, branch) {
  for (const e of parseWorktreeList(output)) {
    if (e.branch === branch) return e.path;
  }
  return null;
}

/**
 * Guard for prune deletes (issue #41): throw unless `ref` is a `preview/*`
 * ref. Call before any local delete (`git update-ref -d`) and before any
 * `git push origin --delete` — only refs under `preview/` may ever pass.
 */
export function assertPreviewDeleteRef(ref) {
  if (!isPreviewRef(ref)) {
    throw new Error(`refusing to delete non-preview ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}

/**
 * Branch selection for `preview:publish --all` (issue #41): every local
 * branch with commits not on the base, plus the base itself.
 *
 * - `allBranches`: every local branch short name (`git for-each-ref`).
 * - `aheadBranches`: the subset with ≥1 commit not on the base
 *   (`git rev-list --count <base>..<branch>` > 0, computed by the caller).
 * - Publish artifacts (`preview/*`, `release`) are never selected — they
 *   are orphan build refs, not sources.
 */
export function selectAllBranches(allBranches, aheadBranches, mainName = "main") {
  const all = (allBranches ?? []).map(String);
  const ahead = new Set((aheadBranches ?? []).map(String));
  const out = [];
  const seen = new Set();
  for (const b of all) {
    if (b === mainName) continue;
    if (b === "release" || b.startsWith("preview/")) continue;
    if (!ahead.has(b)) continue;
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(b);
  }
  if (all.includes(mainName)) out.unshift(mainName);
  return out;
}

/**
 * The `unvibe` provenance record for a generated release package.json
 * (issue #41): which channel the tree is, what built it, and — for
 * previews built as base + branch in a throwaway worktree — both sides
 * (`baseBranch@baseCommit + sourceBranch@sourceCommit`; `commit` is the
 * built tree itself, the merge result). Missing sides stay null so
 * previews published before the fields existed keep working.
 */
export function buildUnvibeField({
  channel,
  commit,
  builtAt,
  sourceBranch,
  sourceVersion,
  sourceCommit = null,
  baseBranch = null,
  baseCommit = null,
}) {
  return {
    channel,
    commit,
    builtAt,
    sourceBranch,
    sourceVersion,
    sourceCommit,
    baseBranch,
    baseCommit,
  };
}

/**
 * Prune selection for `preview:publish --prune` (issue #41): the
 * `preview/*` refs whose source branch is merged into the base or no
 * longer exists locally.
 *
 * - `entries`: `{ ref, sourceBranch | null }` per local `preview/*` ref
 *   (`sourceBranch` from that ref's own package.json `unvibe` field).
 * - Returns `{ ref, reason }` with reason `"merged"` or
 *   `"source-branch deleted"`. Anything else is kept: refs outside
 *   `preview/` (never deletable), refs with an unknown source branch
 *   (cannot prove either condition), and the base's own preview
 *   (`sourceBranch === mainName` — e.g. `preview/main` tracks the base
 *   itself and is refreshed, not pruned).
 */
export function selectPruneRefs(entries, mergedBranches, existingBranches, mainName = "main") {
  const merged = new Set((mergedBranches ?? []).map(String));
  const existing = new Set((existingBranches ?? []).map(String));
  const out = [];
  for (const e of entries ?? []) {
    const ref = String(e?.ref ?? "");
    const source = typeof e?.sourceBranch === "string" && e.sourceBranch.length > 0 ? e.sourceBranch : null;
    if (!isPreviewRef(ref)) continue;
    if (!source || source === mainName) continue;
    if (merged.has(source)) out.push({ ref, reason: "merged" });
    else if (!existing.has(source)) out.push({ ref, reason: "source-branch deleted" });
  }
  return out;
}
