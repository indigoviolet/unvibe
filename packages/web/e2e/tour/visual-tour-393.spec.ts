/**
 * Tour: guide prompt forks (issue #393).
 *
 * On-demand only (`mise run visual-tour`): the owner reviews two
 * states as frames — the Re-do with choice in the review bar (menu
 * open, then the per-persona confirm pill) and the fork drift warning
 * on the Settings persona row. Behaviour for both lives in
 * `e2e/journeys/j393-guide-forks.spec.ts`; this file keeps just enough
 * asserts to prove each framed state.
 *
 * Fixed 1440px light Default (new scenes default to the first combo).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  TEACH_LENS,
  apiJson,
  createScratchReview,
  fakeServicePath,
  makeScratchRepo,
  makeTeachForkPrompts,
  realGitPath,
  writeFakeGitOffline,
  writeFakeShell,
} from "../journeys/journey-helpers.js";
import { checkLayout } from "../layout-check.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

const TEACH = {
  id: "teach",
  name: "Teach",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: TEACH_LENS,
  cardInstruction: "",
  enabled: true,
  color: "#C2410C",
};

test.describe("J393 fork frames", () => {
  let dirs: string[] = [];
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-tour393-${tag}-`));
      dirs.push(d);
      return d;
    };
    const prompts = makeTeachForkPrompts("tour393");
    dirs.push(prompts.dir);
    // Drift from the start: the base moved after the manifest was written.
    const base = path.join(prompts.dir, "reader.md");
    writeFileSync(base, `${readFileSync(base, "utf8")}\nNew base rule.\n`);
    const scratch = await makeScratchRepo(tmp("repo"));
    const dataDir = tmp("data");
    const fakeBin = tmp("bin");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      label: "tour393",
      extraEnv: {
        SHELL: fakeShell,
        PATH: fakeServicePath(fakeBin),
        UNVIBE_PROMPTS_DIR: prompts.dir,
      },
    });
    const seed = (await apiJson(svc, "GET", "/api/settings")).json as { personas: unknown[] };
    const added = await apiJson(svc, "PUT", "/api/settings", { personas: [...seed.personas, TEACH] });
    if (added.status !== 200) throw new Error(`personas PUT failed: ${added.status}`);
    reviewId = await createScratchReview(svc, scratch.dir);
    await expect
      .poll(
        async () =>
          ((await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { ingest?: { status?: string } }).ingest
            ?.status,
        { timeout: 120_000 },
      )
      .toBe("ready");
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  test("re-do with menu and confirm", async ({ page }) => {
    if (!svc) throw new Error("no service");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Re-do guide" }).click();
    const menu = page.getByTestId("redo-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Re-do with Teach" })).toBeVisible();
    await page.mouse.move(720, 20);
    await checkLayout(page, "redo-with-menu-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "redo-with-menu-1440-light.png") });
    await menu.getByRole("menuitem", { name: "Re-do with Teach" }).click();
    await expect(page.getByText("Confirm re-do with Teach")).toBeVisible();
    await checkLayout(page, "redo-with-confirm-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "redo-with-confirm-1440-light.png") });
    await page.keyboard.press("Escape");
  });

  test("fork drift warning on the persona row", async ({ page }) => {
    if (!svc) throw new Error("no service");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByTestId("personas-section")).toBeVisible();
    const drift = page.getByTestId("persona-teach-drift");
    await expect(drift).toBeVisible();
    await expect(drift).toContainText("reader.md");
    await page.mouse.move(720, 20);
    await checkLayout(page, "fork-drift-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "fork-drift-1440-light.png") });
  });
});
