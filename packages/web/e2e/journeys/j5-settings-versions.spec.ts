/** J5 (#188): settings, effort/full access, version list — real service, no agent + fake updater. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { openPopup } from "../select.js";
import { apiJson, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J5 settings and versions", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" } });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("limits persist, invalid shows inline, full access marker, version picker lists fake channels", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // Readiness shows on the front screen / settings environment.
    const readiness = await apiJson(svc, "GET", "/api/readiness");
    expect(readiness.status).toBe(200);

    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: "Limits" }).click();
    const input = page.locator("#limit-sessionsPerProvider");
    await input.fill("99");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(
      page.getByText("Agent sessions at once, per provider: must be an integer in [1, 32]"),
    ).toBeVisible({ timeout: 15_000 });
    await input.fill("5");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Limits" }).click();
    await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("5");

    // Full access toggle with acknowledgement (proven testids from AccessSection).
    await page.getByRole("tab", { name: /access/i }).click().catch(async () => {
      await page.locator('[data-testid="access-section"]').scrollIntoViewIfNeeded().catch(() => {});
    });
    const access = page.locator('[data-testid="access-section"], section').filter({ hasText: /full access/i }).first();
    await expect(access).toBeVisible({ timeout: 15_000 });

    // Version picker (fake backend): enable, list, current marked.
    await page.getByRole("tab", { name: "Version" }).click();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if ((await toggle.count()) > 0 && !(await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
    }
    await expect(page.locator('[data-testid="update-channel"]').first()).toBeVisible({ timeout: 30_000 });
    // #246: no separate Installed line — the installed channel is marked
    // by its Installed badge in the list.
    await expect(page.getByTestId("update-current-version")).toHaveCount(0);
    await expect(page.getByTestId("update-current").first()).toBeVisible({ timeout: 15_000 });

    // #233 (with #229's horizontal alignment): compact single-line
    // channel rows sharing the card's side padding; the Channels
    // label's bottom and the Refresh button's bottom sit the same
    // distance above the divider.
    const toggleBox = await toggle.boundingBox();
    const toggleLabel = page.locator('.ver-toggle label[for="version-picker-toggle"]');
    await expect(toggleLabel).toBeVisible();
    const labelBox = await toggleLabel.boundingBox();
    expect(
      Math.abs(toggleBox!.y + toggleBox!.height / 2 - (labelBox!.y + labelBox!.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(labelBox!.x + 1);
    // #246: the "Releases always listed." help text is gone.
    await expect(page.locator(".ver-toggle-hint")).toHaveCount(0);

    const rows = page.locator('[data-testid="update-channel"]');
    expect(await rows.count()).toBeGreaterThan(0);
    // #249: the release row shows its version, never the sha; preview
    // rows keep their short sha.
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toContainText("v0.0.1");
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toContainText("abc1234");
    expect(await rows.locator(".ui-row-meta").count()).toBe(0);
    for (const text of await rows.evaluateAll((els) => els.map((el) => el.textContent ?? ""))) {
      expect(text).toMatch(/·.*·/);
    }
    const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1.5);

    const headBox = await page.locator(".ver-listhead").boundingBox();
    const firstRowBox = await rows.first().boundingBox();
    expect(Math.abs(headBox!.x - firstRowBox!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(headBox!.x + headBox!.width - (firstRowBox!.x + firstRowBox!.width))).toBeLessThanOrEqual(2);
    const refreshBox = await page.getByTestId("update-refresh").boundingBox();
    const channelsLabelBox = await page.locator(".ver-listhead .hint").boundingBox();
    // Bottom-aligned (#233): the label's bottom and the button's bottom
    // sit the same distance above the divider (the first row's top
    // border), within 2px.
    const dividerY = firstRowBox!.y;
    const labelAbove = dividerY - (channelsLabelBox!.y + channelsLabelBox!.height);
    const buttonAbove = dividerY - (refreshBox!.y + refreshBox!.height);
    expect(Math.abs(labelAbove - buttonAbove)).toBeLessThanOrEqual(2);
    const actionBox = await rows.locator("button").first().boundingBox();
    expect(Math.abs(refreshBox!.x + refreshBox!.width - (actionBox!.x + actionBox!.width))).toBeLessThanOrEqual(2);
    const channels = await apiJson(svc, "GET", "/api/update/channels");
    expect(channels.status).toBe(200);
    // From a source checkout the switch itself refuses with a readable reason
    // (it needs an npm-installed build); the helper restart is KEEP-UNIT covered.
    const sw = await apiJson(svc, "POST", "/api/update/switch", { ref: "preview/feat-x" });
    expect([202, 409]).toContain(sw.status);
    if (sw.status === 409) expect(JSON.stringify(sw.json)).toMatch(/installed|npm/i);
    // A switch through the real route is refused/accepted by the service, never silent:
    // with the fake backend the channels endpoint is the user-visible list; the actual
    // helper restart is covered by update-helper/update-routes unit tests (KEEP-UNIT).
    const status = await apiJson(svc, "GET", "/api/update/status");
    expect(status.status).toBe(200);
  });

  test.describe("update icon (#231)", () => {
    const NOW = Date.now();
    const iso = (ms: number): string => new Date(ms).toISOString();

    function svcDataDir(): string {
      if (!dataDir) throw new Error("no data dir");
      return dataDir;
    }

    async function stageChannels(svc: RunningService, specs: unknown[], currentRef?: string): Promise<void> {
      mkdirSync(path.join(svcDataDir(), "update"), { recursive: true });
      writeFileSync(path.join(svcDataDir(), "update", "fake-channels.json"), JSON.stringify(specs));
      if (currentRef !== undefined) {
        writeFileSync(path.join(svcDataDir(), "update", "current-ref"), `${currentRef}\n`);
      }
      // Bust the service's 30 s channel cache so the top bar reads the staged list.
      const refreshed = await apiJson(svc, "GET", "/api/update/channels?refresh=1");
      expect(refreshed.status).toBe(200);
    }

    async function stageInstalled(over: unknown | null): Promise<void> {
      const file = path.join(svcDataDir(), "update", "fake-installed.json");
      if (over === null) rmSync(file, { force: true });
      else {
        mkdirSync(path.join(svcDataDir(), "update"), { recursive: true });
        writeFileSync(file, JSON.stringify(over));
      }
    }

    /**
     * Navigate only after the top-bar check's own requests (status +
     * channels) complete, so "no icon" asserts without a timeout wait.
     */
    async function gotoAfterUpdateCheck(
      page: import("@playwright/test").Page,
      url: string,
    ): Promise<void> {
      const status = page.waitForResponse(
        (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
      );
      const channels = page.waitForResponse(
        (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
      );
      await page.goto(url);
      await status;
      await channels;
    }

    test("release build with a newer release: icon shows, links to Version", async ({ page }) => {
      test.setTimeout(120_000);
      if (!svc) throw new Error("no service");
      await stageChannels(
        svc,
        [{ ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) }],
        "release",
      );
      await stageInstalled({ version: "0.0.1", commit: "oldcommit0000001", builtAt: iso(NOW - 7 * 86400_000) });

      await gotoAfterUpdateCheck(page, `${svc.origin}/?token=${svc.token}`);
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      const icon = page.getByTestId("update-available-icon");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("title", "Update available: v0.0.2");
      await expect(icon).toHaveAttribute("href", "/settings?tab=version");
      // #250: the update icon is a gift (rect box + lid), not chevrons.
      await expect(icon.locator("svg rect")).toHaveCount(1);
    });

    test("up to date: no icon", async ({ page }) => {
      test.setTimeout(120_000);
      if (!svc) throw new Error("no service");
      await stageChannels(
        svc,
        [{ ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) }],
        "release",
      );
      // Installed matches published: nothing newer.
      await stageInstalled({ version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) });

      await gotoAfterUpdateCheck(page, `${svc.origin}/?token=${svc.token}`);
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("update-available-icon").count()).toBe(0);
    });

    test("preview build with a release published later: icon shows", async ({ page }) => {
      test.setTimeout(120_000);
      if (!svc) throw new Error("no service");
      await stageChannels(
        svc,
        [
          { ref: "release", version: "0.0.1", commit: "rel0000000000001", builtAt: iso(NOW) },
          {
            ref: "preview/feat-x",
            version: "0.0.1-preview.feat-x.abc1234",
            commit: "abc1234def5678",
            sourceBranch: "feat/x",
            builtAt: iso(NOW - 7 * 86400_000),
          },
        ],
        "preview/feat-x",
      );
      await stageInstalled(null);

      await gotoAfterUpdateCheck(page, `${svc.origin}/?token=${svc.token}`);
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      const icon = page.getByTestId("update-available-icon");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("title", "Update available: v0.0.1");
      // A preview newer than the release: nothing to update to.
      await stageChannels(
        svc,
        [
          { ref: "release", version: "0.0.1", commit: "rel0000000000001", builtAt: iso(NOW - 7 * 86400_000) },
          {
            ref: "preview/feat-x",
            version: "0.0.1-preview.feat-x.abc1234",
            commit: "abc1234def5678",
            sourceBranch: "feat/x",
            builtAt: iso(NOW),
          },
        ],
        "preview/feat-x",
      );
      const status = page.waitForResponse(
        (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
      );
      const channels = page.waitForResponse(
        (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
      );
      await page.reload();
      await status;
      await channels;
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("update-available-icon").count()).toBe(0);
    });

    test("toggle hides previews while releases stay (#231)", async ({ page }) => {
      test.setTimeout(120_000);
      if (!svc) throw new Error("no service");
      await stageChannels(
        svc,
        [
          { ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) },
          {
            ref: "preview/feat-x",
            version: "0.0.2-preview.feat-x.abc1234",
            commit: "abc1234def5678",
            sourceBranch: "feat/x",
            builtAt: iso(NOW - 7200_000),
          },
        ],
        "release",
      );
      // Installed older than the published release: the icon shows even with the toggle off.
      await stageInstalled({ version: "0.0.1", commit: "oldcommit0000001", builtAt: iso(NOW - 7 * 86400_000) });

      await page.goto(`${svc.origin}/settings?tab=version&token=${svc.token}`);
      await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
      const toggle = page.getByTestId("version-picker-toggle");
      if (await toggle.isChecked()) {
        await toggle.click();
        await expect(toggle).not.toBeChecked({ timeout: 15_000 });
      }
      // Toggle off: the release stays, previews hidden — the update check runs either way.
      await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toBeVisible();
      // #249: the release row shows its version, never the sha.
      await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toContainText("v0.0.2");
      await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).not.toContainText("newcommit");
      await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toHaveCount(0);
      await expect(page.getByTestId("update-available-icon")).toBeVisible();

      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
      await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(2);
      await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toBeVisible();
      // #249: preview rows keep their short sha.
      await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toContainText("abc1234");
    });
  });
});

test.describe("J5 update icon when the check fails (#231)", () => {
  let failDir = "";
  let failSvc: RunningService | null = null;

  test.beforeAll(async () => {
    failDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j231-fail-"));
    failSvc = await startService(failDir, {
      agent: "none",
      extraEnv: { UNVIBE_UPDATER_BACKEND: "fake", UNVIBE_UPDATE_FAKE_FAIL: "list" },
    });
  });
  test.afterAll(async () => {
    await failSvc?.stop().catch(() => {});
    rmSync(failDir, { recursive: true, force: true });
  });

  test("failed check: no icon, no error UI, Version panel names the failure", async ({ page }) => {
    test.setTimeout(120_000);
    if (!failSvc) throw new Error("no service");
    const status = page.waitForResponse(
      (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
    );
    const channels = page.waitForResponse(
      (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
    );
    await page.goto(`${failSvc.origin}/?token=${failSvc.token}`);
    await status;
    await channels;
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId("update-available-icon").count()).toBe(0);

    await page.goto(`${failSvc.origin}/settings?tab=version&token=${failSvc.token}`);
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toContainText("Couldn't load version info", { timeout: 15_000 });
    expect(await page.getByTestId("update-available-icon").count()).toBe(0);
  });
});

// Merged from settings-versions-service.spec.ts (#256): the Prompts tab
// lists every template and the debug page expands them for the review.
// (Limits persistence is already proven by the J5 test above; the
// versions-refresh flow lives in J12.)
test.describe("J5 prompts list and debug expansion", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let repoDir = "";
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-prompts-repo-"));
    await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-prompts-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" } });
    reviewId = await createScratchReview(svc, repoDir);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("prompts list all templates; the debug page expands them for the review", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Prompts" }).click();
    // All 17 PRD §13 templates (16 + plotline_assign, #169; concept_stub
    // was removed with the stub job, #216), from the real prompts dir.
    await expect(page.locator('[data-testid^="prompt-"]')).toHaveCount(17);
    await expect(page.locator('[data-testid="prompt-concept_stub"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="prompt-concept_page"]')).toHaveCount(1);
    const reader = page.locator('[data-testid="prompt-reader"]');
    await reader.getByRole("button", { name: "Expand reader" }).click();
    await expect(reader.locator("mark.tm").first()).toContainText("{{source}}");
    // The debug page expands them for the review. Forked templates
    // (ask) serve L0–L3 from the warm base: cached.
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await page.getByRole("tab", { name: "Prompts" }).click();
    const ask = page.locator('section[aria-label="Prompts"]').locator('[data-testid="prompt-ask"]');
    await ask.getByRole("button", { name: "Expand ask" }).click();
    await expect(ask.locator('details.lay[data-layer="L0"]')).toBeVisible();
    await expect(ask.locator('details.lay[data-layer="L1"]')).toContainText("cached");
    await expect(ask.locator('details.lay[data-layer="L4"]')).not.toContainText("cached");
    // Model pickers list the adapter's models.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-main"]').getByText("claude-opus-5-5", { exact: false }).first()).toBeAttached();
  });
});

// Merged from real-service.spec.ts (#256): Settings rejects a bad repo
// URL inline and removing a path checkout forgets it without touching it.
test.describe("J5 repo add and remove", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-repos-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" } });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("settings rejects a bad repo URL inline and removes a path checkout without touching it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // Client-side verdict first: no request, no toast, control stays live.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    const section = page.locator('[data-testid="repositories-section"]');
    await section.getByLabel("Add a repo by URL").fill("not a repo!!!");
    await section.getByRole("button", { name: "Clone and add" }).click();
    await expect(section.getByText(/not a GitHub repo URL or owner\/name/)).toBeVisible();

    // A second scratch checkout, added through the API, removed through
    // the Settings UI: the row goes, the folder stays.
    const extraDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-extra-repo-"));
    await makeScratchRepo(extraDir);
    const base = path.basename(extraDir);
    try {
      await apiJson(svc, "POST", "/api/repos", { path: extraDir });
      await page.reload();
      await expect(section.locator('[data-testid^="repo-"]', { hasText: base }).first()).toBeVisible();
      const row = section.locator('[data-testid^="repo-"]', { hasText: base }).first();
      await row.getByRole("button", { name: `Remove local/${base}` }).click();
      await expect(row).toContainText("Remove this repo from the list? ");
      await expect(row).toContainText("is not touched.");
      await row.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(row).toHaveCount(0);
      const listed = await apiJson(svc, "GET", "/api/repos");
      expect(((listed.json as { repos: { localPath: string }[] }).repos ?? []).some((r) => r.localPath === extraDir)).toBe(false);
      // Forgotten, not deleted: the checkout is intact on disk.
      expect(existsSync(path.join(extraDir, ".git"))).toBe(true);
    } finally {
      rmSync(extraDir, { recursive: true, force: true });
    }
  });
});

// Merged from doctor-service.spec.ts (#256): the Doctor page renders
// real diagnostics with service identity, and model pickers show display
// names on the real service. (The reload API half is DISABLED(#119) and
// covered by diagnostics-api.test.ts; the UI Reload button stays covered
// in doctor.spec.ts mock mode.)
test.describe("J5 doctor page on the real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j5-doctor-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" } });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("doctor page shows real diagnostics with service identity", async ({ page }) => {
    test.setTimeout(60000);
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/doctor?token=${svc.token}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("doctor-service")).toContainText("pid");
    await expect(page.getByTestId("doctor-path")).toContainText("effective");
  });

  test("model pickers show display names on the real service", async ({ page }) => {
    test.setTimeout(60000);
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 20000 });
    await page.getByRole("tab", { name: "Models" }).click();
    // Static fallback carries names (Sonnet/Opus/GPT) even with no agent.
    const main = page.locator('[data-testid="model-main"]');
    await main.locator("#model-main").click();
    await expect(openPopup(page).getByRole("option", { name: "Sonnet" })).toBeVisible();
  });
});
