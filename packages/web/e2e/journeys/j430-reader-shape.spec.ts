/**
 * J430 — required reader shape (#430).
 *
 * A reader turn that stops after its first card is repaired once in the
 * same session; a still-incomplete guide is stored but marked degraded,
 * with the existing Re-do offer. Both paths run against the real service
 * in replay mode over two scratch repos whose content matches
 * journey-only replay recordings (the `shape-*` entries in
 * `fixtures/urllib3-5020/manifest.json`):
 *
 * - alpha: a one-card reader reply (plus one direction) hits the shape
 *   repair ("You stopped early…") and the repair's full guide lands —
 *   no degraded reason, exactly one repair turn.
 * - beta: a one-card reply whose repair is still short stays stored but
 *   degraded — the job carries "The guide stopped early; Re-do to write
 *   the rest.", the Debug page shows it, and the review bar offers Re-do.
 *
 * Boots: ONE replay service over two scratch repos.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  apiJson,
  createScratchReview,
  fakeServicePath,
  realGitPath,
  writeFakeGitOffline,
  writeFakeShell,
} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const STOPPED_EARLY = "The guide stopped early; Re-do to write the rest.";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Scratch repo whose feature line carries the shape journey's marker. */
function makeShapeRepo(
  dir: string,
  file: string,
  func: string,
  marker: string,
): { dir: string } {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "src", file), `def ${func}():\n    return 1\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-m", "base");
  git(dir, "checkout", "-b", "feature");
  writeFileSync(path.join(dir, "src", file), `# ${marker}\ndef ${func}():\n    return 11\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-m", "feature work");
  return { dir };
}

interface JobRow {
  id: string;
  kind: string;
  state: string;
  degradedReason?: string;
  promptSnapshot?: string;
  turnRecords?: unknown[];
}

async function jobsFor(svc: RunningService, reviewId: string): Promise<JobRow[]> {
  const res = await apiJson(svc, "GET", `/api/jobs?review=${encodeURIComponent(reviewId)}`);
  expect(res.status).toBe(200);
  return (res.json as { jobs: JobRow[] }).jobs;
}

async function waitReaderDone(svc: RunningService, reviewId: string, timeoutMs = 240_000): Promise<JobRow> {
  const start = Date.now();
  for (;;) {
    const jobs = await jobsFor(svc, reviewId);
    const reader = jobs.filter((j) => j.kind === "reader").at(-1);
    if (reader && ["done", "error", "cancelled"].includes(reader.state)) {
      // The list strips snapshots; the single-job read keeps them.
      const full = await apiJson(svc, "GET", `/api/jobs/${encodeURIComponent(reader.id)}`);
      expect(full.status).toBe(200);
      return (full.json as { job: JobRow }).job;
    }
    if (Date.now() - start > timeoutMs) throw new Error("reader job did not settle in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function rootCardIds(svc: RunningService, reviewId: string): Promise<{ id: string; blocks: number }[]> {
  const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  expect(res.status).toBe(200);
  const pages = (res.json as { pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[] }).pages;
  return (pages.find((p) => p.id === "root")?.cards ?? []).map((c) => ({ id: c.id, blocks: c.blocks.length }));
}

test.describe("J430 required reader shape", () => {
  let dirs: string[] = [];
  let svc: RunningService | null = null;
  let alphaId = "";
  let betaId = "";

  test.beforeAll(async () => {
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-j430-${tag}-`));
      dirs.push(d);
      return d;
    };
    const alpha = makeShapeRepo(tmp("alpha"), "shape_alpha.py", "partial_one", "shape-alpha-marker-one");
    const beta = makeShapeRepo(tmp("beta"), "shape_beta.py", "partial_two", "shape-beta-marker-two");
    const dataDir = tmp("data");
    const fakeBin = tmp("bin");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "replay",
      label: "j430",
      extraEnv: {
        SHELL: fakeShell,
        PATH: fakeServicePath(fakeBin),
      },
    });
    alphaId = await createScratchReview(svc, alpha.dir);
    betaId = await createScratchReview(svc, beta.dir);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("one-card reply is repaired once and the full guide lands", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reader = await waitReaderDone(s, alphaId);
    expect(reader.state).toBe("done");
    expect(reader.degradedReason).toBeUndefined();
    // Exactly one repair turn, naming what was missing.
    expect(reader.promptSnapshot).toContain("--- repair turn ---");
    expect(reader.promptSnapshot).toContain("You stopped early");
    expect(reader.promptSnapshot).toContain("The central idea");
    if (reader.turnRecords !== undefined) expect(reader.turnRecords).toHaveLength(2);

    const cards = await rootCardIds(s, alphaId);
    const byId = new Map(cards.map((c) => [c.id, c.blocks]));
    expect(byId.get("problem") ?? 0).toBeGreaterThan(0);
    expect(byId.get("central") ?? 0).toBeGreaterThan(0);
    expect(cards.filter((c) => c.id.startsWith("g-")).length).toBeGreaterThanOrEqual(3);

    // The repaired guide renders: problem + central cards, no placeholder text.
    await page.goto(`${s.origin}/review/${alphaId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#page")).not.toContainText("[replay placeholder");
  });

  test("still-incomplete repair stores the guide as degraded with Re-do", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reader = await waitReaderDone(s, betaId);
    expect(reader.state).toBe("done");
    expect(reader.degradedReason).toBe(STOPPED_EARLY);

    // Stored, not failed: the problem card is there, the central card is not.
    const cards = await rootCardIds(s, betaId);
    const byId = new Map(cards.map((c) => [c.id, c.blocks]));
    expect(byId.get("problem") ?? 0).toBeGreaterThan(0);
    expect(byId.has("central")).toBe(false);

    // The review shows the partial guide with the existing Re-do offer.
    await page.goto(`${s.origin}/review/${betaId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-central")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Re-do guide" })).toBeVisible();

    // The incomplete notice surfaces where degraded readers surface: the
    // Debug page's Jobs tab, on the existing degraded line — no new banner.
    await page.goto(`${s.origin}/review/${betaId}/debug?token=${s.token}`);
    await expect(
      page.getByText(`Degraded (answer kept): ${STOPPED_EARLY}`, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
