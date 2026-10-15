/** Shared helpers for the #188 journeys (real built service only). */
import { execFile } from "node:child_process";
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
