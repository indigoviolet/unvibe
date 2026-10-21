/** Shared helpers for the #188 journeys (real built service only). */
import { execFile, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RunningService } from "../service-harness.js";

const exec = promisify(execFile);

export async function apiJson(
  svc: RunningService,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: never }> {
  const res = await fetch(`${svc.origin}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${svc.token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as never;
  return { status: res.status, json };
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

/** Scratch repo: main + feature branch (changed + new file). */
export async function makeScratchRepo(dir: string): Promise<{ dir: string; headSha: string }> {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "src", "app.py"), "def main():\n    return 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  writeFileSync(path.join(dir, "src", "app.py"), "def main():\n    return 2\n\n\ndef helper():\n    return 3\n");
  writeFileSync(path.join(dir, "src", "util.py"), "VALUE = 42\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
  return { dir, headSha: await git(dir, "rev-parse", "HEAD") };
}

/** Create the bundled demo review and wait until its guide has content. */
export async function createDemoReview(svc: RunningService, timeoutMs = 90_000): Promise<string> {
  const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
  if (created.status !== 201 && created.status !== 200 && created.status !== 202) throw new Error(`demo create failed: ${created.status}`);
  const reviewId = (created.json as { review: { id: string } }).review.id;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const pages = (snap.json as { pages?: { id: string; cards: { id: string; blocks: unknown[] }[] }[] }).pages ?? [];
    const root = pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) && root?.cards.some((c) => c.id === "central" && c.blocks.length > 0)) return reviewId;
    if (Date.now() > deadline) throw new Error("guide did not fill in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Fake `gh` for PR journeys: answers pr view/user, records review posts. */
export function writeFakeGh(binDir: string, logDir: string, headSha: string): void {
  const body = ["First paragraph of the PR body.", "", "Second paragraph with details."].join("\n");
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Journey test PR","body":${JSON.stringify(body)},"author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
case "$*" in *pulls/1/reviews*) cat > "$LOG/review-stdin.json"; echo '{"html_url":"https://example.invalid/pr/1"}'; exit 0 ;; esac
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  prev=""
  for arg in "$@"; do if [ "$prev" = "--body-file" ]; then cp "$arg" "$LOG/body.md"; fi; prev="$arg"; done
  echo '{}'; exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/** Absolute path of the real `git` (resolved in-process, before any fake bin dir shadows PATH). */
export function realGitPath(): string {
  return execSync("command -v git", { encoding: "utf8" }).trim();
}

/**
 * Fake `git` for hermetic e2e services (AGENTS.md: never hit real
 * GitHub): `ls-remote` — the only network call the service makes, via
 * the GitHub-fetch readiness probe — fails instantly offline, so the
 * probe reports a deterministic warning. Everything else delegates to
 * the real binary (ingest reads local checkouts through it).
 */
export function writeFakeGitOffline(binDir: string, realGit: string): void {
  const script = `#!/bin/sh
case "$*" in
  *ls-remote*github/gitignore*)
    echo "git ls-remote stubbed offline (e2e): tests never hit real GitHub" >&2
    exit 1
    ;;
esac
exec "${realGit}" "$@"
`;
  writeFileSync(path.join(binDir, "git"), script, { mode: 0o755 });
}

/** Fake `gh` for the visual tour: authenticated as a fake login, empty PR lists. No real `gh`, no network. */
export function writeFakeGhTour(binDir: string, logDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "tour-host: Logged in to github.com account tour-reviewer (e2e stub)"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'tour-reviewer'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '[]'; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/** Register a scratch repo and open its feature/PR review; returns review id. */
export async function createScratchReview(
  svc: RunningService,
  repoDir: string,
  opts: { pr?: number } = {},
): Promise<string> {
  const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
  const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
  const registered = list.find((r) => r.localPath === repoDir);
  if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
  const created = await apiJson(svc, "POST", "/api/reviews", {
    repoId: registered.id,
    ...(opts.pr !== undefined ? { pr: opts.pr } : { branch: "feature" }),
  });
  if (created.status !== 201 && created.status !== 200 && created.status !== 202) throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.json)}`);
  return (created.json as { review: { id: string } }).review.id;
}
