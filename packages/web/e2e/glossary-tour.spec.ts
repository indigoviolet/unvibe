/**
 * Glossary tour (issue #252): linked terms in the guide + hover open.
 *
 * Four passes (1440px and 960px, light and dark) against the real built
 * service in demo/replay mode. Screenshots land in `visual-tour/` for the
 * owner to look at, with the generic `checkLayout` at every step.
 */
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { checkLayout } from "./layout-check.js";
import { apiJson } from "./journeys/journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const SHOTS = fileURLToPath(new URL("../visual-tour", import.meta.url));

let dataDir = "";
let svc: RunningService | null = null;
let reviewId = "";

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-glossary-tour-data-"));
  svc = await startService(dataDir, { agent: "replay" });
  const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
  reviewId = (created.json as { review: { id: string } }).review.id;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const s = snap.json as unknown as { glossary?: unknown[]; pages: { id: string; cards: { id: string }[] }[] };
    const root = s.pages.find((p) => p.id === "root");
    if ((s.glossary?.length ?? 0) >= 3 && root?.cards.some((c) => c.id === "central")) break;
    if (Date.now() > deadline) throw new Error("demo guide with glossary did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  for (const d of [dataDir]) rmSync(d, { recursive: true, force: true });
});

for (const combo of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "960-light", width: 960, dark: false },
  { name: "960-dark", width: 960, dark: true },
] as const) {
  test(`glossary tour (${combo.name})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    const suffix = combo.name;
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#C-central a.gx[data-glossary]").first()).toBeVisible({ timeout: 30_000 });
    await page.locator("#C-central").scrollIntoViewIfNeeded();
    await checkLayout(page, "glossary-links");
    await page.screenshot({ path: path.join(SHOTS, `glossary-links-${suffix}.png`) });
    const link = page.locator('#C-central a.gx[data-glossary="HTTPHeaderDict"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.hover();
    await expect(page.locator("#pop")).toContainText("headers view", { timeout: 30_000 });
    await expect(page.locator("#pop [data-src]")).toHaveCount(1);
    await checkLayout(page, "glossary-hover");
    await page.screenshot({ path: path.join(SHOTS, `glossary-hover-${suffix}.png`) });
  });
}
