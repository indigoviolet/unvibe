/**
 * J349b (#349 step 2): personas run on cards against the real service
 * (replay runner — scripted, no live spend).
 *
 * Choosing the built-in Second opinion on the central card stores its
 * version as a tab; switching to the persona tab shows its own text
 * under its own colour border; Asking on that text is answered by the
 * same persona (the thread carries it, the agent avatar wears its
 * colour). Frames land in `visual-tour/` for the owner to look at.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createSeededDemoReview } from "./journey-helpers.js";
import { checkLayout } from "../layout-check.js";
import { selectText } from "../select-text.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));
const PERSONA_ID = "second-opinion";
const PERSONA_RGB = "14, 124, 134";

interface VariantBody {
  personaId: string;
  blocks: unknown[];
  level: string;
  revision: number;
  sessionId?: string;
  working?: string | null;
  error?: string | null;
}

async function centralVariants(svc: RunningService, reviewId: string): Promise<Record<string, VariantBody>> {
  const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  expect(res.status).toBe(200);
  const cards = ((res.json as { pages: { cards: { id: string; variants?: Record<string, VariantBody> }[] }[] }).pages ?? []).flatMap(
    (p) => p.cards,
  );
  return cards.find((c) => c.id === "central")?.variants ?? {};
}

test.describe("J349b persona versions", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j349b-data-"));
    reviewId = createSeededDemoReview(dataDir, "j349b-seed");
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("persona run on a card, tabs, persona-tab Ask", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // The toolbar carries the persona picker (second-opinion bubbles).
    const menuButton = page.locator('#C-central [data-persona-menu="central"]');
    await expect(menuButton).toBeVisible({ timeout: 15_000 });
    await menuButton.click();
    const menu = page.locator('[data-persona-menu-list="central"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator(`[data-persona-option="${PERSONA_ID}"]`)).toContainText("Second opinion");
    // Park the mouse away so no hover state leaks into the frame.
    await page.mouse.move(720, 20);
    await checkLayout(page, "persona-dropdown-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "persona-dropdown-1440-light.png") });
    await menu.locator(`[data-persona-option="${PERSONA_ID}"]`).click();

    // Two tabs: Guide + Second opinion. The API backs the UI.
    const tabs = page.locator('[data-testid="versions-central"]');
    await expect(tabs).toBeVisible({ timeout: 60_000 });
    await expect(tabs.locator('[data-version-tab="guide"]')).toContainText("Guide");
    await expect(tabs.locator(`[data-version-tab="${PERSONA_ID}"]`)).toContainText("Second opinion");
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(svc, reviewId);
        if (variants[PERSONA_ID]?.blocks.length) break;
        if (Date.now() > deadline) throw new Error("persona variant never stored");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const stored = (await centralVariants(svc, reviewId))[PERSONA_ID];
    expect(stored.revision).toBe(1);
    expect(stored.sessionId).toBeTruthy();
    expect(stored.error ?? null).toBeNull();

    // The persona tab shows its own text under its own colour border.
    await tabs.locator(`[data-version-tab="${PERSONA_ID}"]`).click();
    const card = page.locator("#C-central");
    await expect(card).toContainText("checked it against the code", { timeout: 15_000 });
    const ring = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).toContain(PERSONA_RGB);

    // The depth stepper's dots (not the icons) on the persona tab:
    // deeper rewrites the variant, never the Guide version.
    const variantTextBefore = await card.locator(".prose, .lst").first().innerText();
    await card.getByRole("button", { name: "Deeper" }).click();
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(svc, reviewId);
        if (variants[PERSONA_ID]?.level === "deep") break;
        if (Date.now() > deadline) throw new Error("persona depth never landed");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const afterDepth = (await centralVariants(svc, reviewId))[PERSONA_ID];
    expect(afterDepth.revision).toBeGreaterThanOrEqual(2);
    await expect(card.locator(".prose, .lst").first()).not.toHaveText(variantTextBefore, { timeout: 15_000 });
    // Back on Guide: the variant rewrite left it untouched.
    await tabs.locator('[data-version-tab="guide"]').click();
    await expect(card.locator(".prose, .lst").first()).toContainText("unfolds every obs-fold right after parsing", {
      timeout: 15_000,
    });
    await tabs.locator(`[data-version-tab="${PERSONA_ID}"]`).click();
    await expect(card).toContainText("CRLF is the framing delimiter", { timeout: 15_000 });

    // Ask on the persona's text: the thread belongs to the persona and
    // the agent avatar wears its colour.
    await selectText(page, "#C-central", "framing delimiter");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator('#C-central .ithread[data-pending-thread]');
    await expect(composer).toBeVisible({ timeout: 10_000 });
    const beforeAsk = (
      (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as { annotations: { id: string }[] }
    ).annotations.map((a) => a.id);
    await composer.locator("textarea").fill("What does this cost at scale?");
    await composer.getByRole("button", { name: "Ask" }).click();
    let threadId: string | null = null;
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
        const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
        threadId = ids.find((id) => !beforeAsk.includes(id)) ?? null;
        if (threadId) break;
        if (Date.now() > deadline) throw new Error("persona ask thread never appeared");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const thread = (
      ((await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
        annotations: { id: string; personaId?: string; personaCardId?: string; replies: { blocks: unknown[] }[] }[];
      }).annotations ?? []
    ).find((a) => a.id === threadId);
    expect(thread?.personaId).toBe(PERSONA_ID);
    expect(thread?.personaCardId).toBe("central");
    expect((thread?.replies ?? [])[0]?.blocks.length ?? 0).toBeGreaterThan(0);
    const threadEl = page.locator(`#C-central section.ithread[data-thread="${threadId}"]`).first();
    await expect(threadEl).toBeVisible({ timeout: 30_000 });
    const avatar = threadEl.locator(".av.ai").first();
    await expect(avatar).toBeVisible({ timeout: 30_000 });
    const avatarBg = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(avatarBg).toContain(PERSONA_RGB);

    // The persona version frames: tab active, coloured border, recoloured
    // avatar — light and dark at 1440.
    await page.mouse.move(720, 20);
    await checkLayout(page, "persona-version-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "persona-version-1440-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await checkLayout(page, "persona-version-1440-dark");
    await page.screenshot({ path: path.join(SHOTS, "persona-version-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
  });
});
