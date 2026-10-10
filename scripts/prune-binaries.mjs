/*global console process URL */
/**
 * Prune bundled agent platform binaries (see `stubs/empty-platform` +
 * `overrides` in package.json).
 *
 * Unvibe runs the user's installed `claude`/`codex` CLIs (via
 * `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH`; see `exec/agent-bins.ts`) and ships
 * no bundled binary. Local installs get empty stubs through npm `overrides`,
 * but npm ignores `overrides` (and `omit=optional`) for global installs from
 * a tarball or git URL (verified: tarball global install still fetches the
 * 427 MB + 242 MB platform packages). This script deletes them after install
 * so the final tree has none, on any platform, for any install method.
 *
 * Runs as `postinstall` (all installs incl. tarballs) and from `prepare`
 * (git/source installs). Never fails the install: missing dirs, stubs, or
 * permission errors are ignored (adapters work without the binaries as long
 * as the user's CLIs are present; readiness/doctor report otherwise).
 */
import { lstatSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PLATFORM_PKGS = [
  "@openai/codex-linux-x64",
  "@openai/codex-linux-arm64",
  "@openai/codex-darwin-x64",
  "@openai/codex-darwin-arm64",
  "@openai/codex-win32-x64",
  "@openai/codex-win32-arm64",
  "@anthropic-ai/claude-agent-sdk-linux-x64",
  "@anthropic-ai/claude-agent-sdk-linux-arm64",
  "@anthropic-ai/claude-agent-sdk-linux-x64-musl",
  "@anthropic-ai/claude-agent-sdk-linux-arm64-musl",
  "@anthropic-ai/claude-agent-sdk-darwin-x64",
  "@anthropic-ai/claude-agent-sdk-darwin-arm64",
  "@anthropic-ai/claude-agent-sdk-win32-x64",
  "@anthropic-ai/claude-agent-sdk-win32-arm64",
];

/** Candidate node_modules roots: installed tree + nested wrapper locations. */
function roots() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  return [
    path.join(root, "node_modules"),
    // Nested under the wrapper packages (npm hoisting layout).
    path.join(root, "node_modules", "@openai", "codex", "node_modules"),
    path.join(root, "node_modules", "@anthropic-ai", "claude-agent-sdk", "node_modules"),
  ];
}

let prunedBytes = 0;
let prunedCount = 0;
for (const base of roots()) {
  for (const pkg of PLATFORM_PKGS) {
    const [scope, name] = pkg.split("/");
    const dir = path.join(base, scope, name);
    let st;
    try {
      st = lstatSync(dir);
    } catch {
      continue; // absent: overrides stubbed it or npm skipped it
    }
    // Never delete symlinks (file: stubs from overrides) — only real dirs
    // with content (the fetched platform binaries).
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      prunedCount += 1;
    } catch {
      // best-effort: leave it; readiness reports the user's CLI anyway
    }
  }
}
// Size accounting is best-effort; the global-install check measures.
console.log(`prune-binaries: removed ${prunedCount} bundled platform package(s) (if present)`);
void prunedBytes;
