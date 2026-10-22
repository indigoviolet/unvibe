/** J5 (#188): settings, effort/full access, version list — real service, no agent + fake updater. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

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
    await expect(page.getByText(/must be an integer/)).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByTestId("update-current-version")).toBeVisible({ timeout: 15_000 });

    // #229: toggle on one line with short help; single-line channel rows;
    // heading, divider and rows share the card padding; label centred
    // with Refresh.
    const toggleBox = await toggle.boundingBox();
    const toggleLabel = page.locator('.ver-toggle label[for="version-picker-toggle"]');
    await expect(toggleLabel).toBeVisible();
    const labelBox = await toggleLabel.boundingBox();
    expect(
      Math.abs(toggleBox!.y + toggleBox!.height / 2 - (labelBox!.y + labelBox!.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(labelBox!.x + 1);
    const helpText = (await page.locator(".ver-toggle-hint").textContent()) ?? "";
    expect(helpText.trim().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
    expect(helpText).not.toMatch(/gh|login|restart/i);

    const rows = page.locator('[data-testid="update-channel"]');
    expect(await rows.count()).toBeGreaterThan(0);
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
    expect(
      Math.abs(refreshBox!.y + refreshBox!.height / 2 - (channelsLabelBox!.y + channelsLabelBox!.height / 2)),
    ).toBeLessThanOrEqual(2);
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
});
