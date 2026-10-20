/*global process */
/**
 * Pure helpers for `scripts/global-install-check.mjs` (issue #157), kept
 * in their own dependency-free module so vitest can import them directly
 * (`packages/service/test/global-install-lib.test.ts`). Platform and arch
 * are parameters, so tests simulate macOS/Windows from any host instead
 * of hard-coding the runner's own platform.
 */

/**
 * The per-platform agent binary packages that must never be bundled in
 * the installed tree, for `platform`/`arch` (Node's `process.platform` /
 * `process.arch` spellings, e.g. `darwin`/`arm64`, `linux`/`x64`).
 * Before #157 the check only named the Linux packages, so on macOS it
 * passed without checking anything.
 */
export function platformBinaryPackages(platform = process.platform, arch = process.arch) {
  const suffix = `${platform}-${arch}`;
  return [`@openai/codex-${suffix}`, `@anthropic-ai/claude-agent-sdk-${suffix}`];
}

/**
 * The repo a `POST /api/repos { path }` just added, found in the full
 * list the service answers (the response is the whole list, like
 * `GET /api/repos`, not the added row — the web UI finds its clone in it
 * the same way). Position proves nothing: remembered repos are ordered
 * most-recent first, detected checkouts follow them, and once a demo
 * review exists the repos table also carries a `demo` row, so the added
 * repo is in general not last. Selecting by position opened a demo
 * review instead of the sample repo (issue #157 check failure: the
 * outline request then answered the demo's `no-content` 404).
 */
export function findRepoByPath(repos, localPath) {
  if (!Array.isArray(repos) || typeof localPath !== "string" || localPath === "") return null;
  return repos.find((r) => r !== null && typeof r === "object" && r.localPath === localPath) ?? null;
}

/**
 * True when an outline response proves a grammar actually loaded and
 * parsed in the installed service: `how: "parser"` (not the indentation
 * `heuristic` fallback, and not `none`) with a non-empty unit chain.
 * File presence alone does not prove this (issue #157).
 */
export function isParserOutline(outline) {
  return (
    outline !== null &&
    typeof outline === "object" &&
    outline.how === "parser" &&
    Array.isArray(outline.chain) &&
    outline.chain.length > 0
  );
}
