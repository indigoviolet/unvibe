/** Shared helpers for the #188 journeys (real built service only). */
import { execFile, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
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

/**
 * Scratch repo with one two-hunk file over a real gap (issue #265):
 * base `src/big.py` holds 80 numbered lines; the feature branch changes
 * line 10 and line 70, so the diff is two hunks around a ~50-line gap of
 * real, sliceable content (the demo's worktree pads such lines blank, so
 * expansion cannot run there).
 */
export async function makeGapRepo(dir: string): Promise<{ dir: string; headSha: string }> {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  const base = Array.from({ length: 80 }, (_, i) => `value_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "big.py"), `${base.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  const feat = [...base];
  feat[9] = "value_10 = 1000  # changed";
  feat[69] = "value_70 = 7000  # changed";
  writeFileSync(path.join(dir, "src", "big.py"), `${feat.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
  return { dir, headSha: await git(dir, "rev-parse", "HEAD") };
}

/**
 * Issue #285 (E2): append a whole-file new `src/eof.py` (20 lines) on
 * top of the feature branch — one hunk, 1–20, ending at EOF. The last
 * row offers the optimistic bottom step; the click teaches the total
 * and the control drops silently.
 */
export async function makeEofFile(dir: string): Promise<void> {
  const base = Array.from({ length: 20 }, (_, i) => `eof_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "eof.py"), `${base.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "eof base");
  const feat = [...base];
  feat[19] = "eof_20 = 9999  # changed";
  writeFileSync(path.join(dir, "src", "eof.py"), `${feat.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "eof change");
}

/** Finished demo snapshot fixture (issue #257): the same snapshot the
 * bundled demo replays from, seeded straight into the store. Journeys that
 * don't test guide generation start from this instead of waiting for the
 * replay to fill the guide. Call BEFORE `startService` (the service boots
 * over the seeded row); the returned id is the review to open.
 *
 * Only the guide pages/annotations the fixture carries are present: there
 * are no hunk scores/summaries, no plotlines, no suggested question and no
 * jobs, so journeys asserting those keep the replay (`createDemoReview`). */
const DEMO_FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));

export function createSeededDemoReview(dataDir: string, reviewId = "seeded-demo"): string {
  const snapshot = JSON.parse(readFileSync(path.join(DEMO_FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
  };
  const meta = JSON.parse(readFileSync(path.join(DEMO_FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot & {
    review: { repoId: string; branch?: string; prNumber?: number; createdAt?: number };
    version: { n: number; headSha: string; mergeBaseSha: string; baseRef: string; fetchedAt?: number };
  };
  seeded.review.id = reviewId;
  // The live demo creates its review with repoId "demo"; the pipeline only
  // resolves the fixture's file-key aliases (diff:conn:… → the real file
  // key) for demo reviews. Seed the same repoId so on-demand replay fills
  // (explain/ask/depth) verify exactly like the live pipeline's.
  seeded.review.repoId = "demo";
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0,
        managed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS versions (
        review_id TEXT NOT NULL REFERENCES reviews(id), n INTEGER NOT NULL,
        head_sha TEXT NOT NULL, merge_base_sha TEXT NOT NULL,
        base_ref TEXT NOT NULL, fetched_at INTEGER NOT NULL,
        id_mapping JSON NOT NULL DEFAULT '{}', PRIMARY KEY (review_id, n)
      );
      CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    );
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run("demo", "demo", "urllib3-5020", path.dirname(DEMO_FIXTURE_DIR), Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(reviewId, "demo", seeded.review.branch ?? "main", seeded.review.prNumber ?? null, seeded.version.n, seeded.review.createdAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(reviewId, seeded.version.n, seeded.version.headSha, seeded.version.mergeBaseSha, seeded.version.baseRef, seeded.version.fetchedAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(reviewId, seeded.rev, JSON.stringify(seeded), Date.now());
  } finally {
    db.close();
  }
  return reviewId;
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
