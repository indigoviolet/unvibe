/**
 * Tour: personas (package D re-adds the frames packages C removed
 * from the gate in #363).
 *
 * On-demand only (`mise run visual-tour`): the persona states the owner
 * reviews as frames — the personas list, the add/edit/delete forms and
 * confirm, and the persona dropdown/version/clarity states. Behaviour
 * for all of these lives in `e2e/journeys/l8-personas.spec.ts`; this
 * file keeps just enough asserts to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { selectText } from "../select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createSeededDemoReview } from "../journeys/journey-helpers.js";
import { checkLayout } from "../layout-check.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

interface PersonaBody {
  id: string;
  name: string;
  followMain: boolean;
  provider: string;
  model: string;
  lens: string;
  cardInstruction: string;
  enabled: boolean;
  color: string;
}

async function personas(svc: RunningService): Promise<PersonaBody[]> {
  const res = await apiJson(svc, "GET", "/api/settings");
  expect(res.status).toBe(200);
  return (res.json as { personas: PersonaBody[] }).personas;
}

async function gotoPersonas(
  page: import("@playwright/test").Page,
  svc: RunningService,
): Promise<void> {
  await page.goto(`${svc.origin}/settings?token=${svc.token}`);
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Personas" }).click();
  await expect(page.getByTestId("personas-section")).toBeVisible();
}

test.describe("J349 personas settings", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j349-data-"));
    svc = await startService(dataDir, { agent: "none" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("built-ins are seeded and listed", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    const list = await personas(svc);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      id: "guide",
      name: "Guide",
      followMain: false,
      enabled: true,
      cardInstruction: "",
    });
    expect(list[0].lens).toBe("");
    expect(list[1]).toMatchObject({
      id: "second-opinion",
      name: "Second opinion",
      followMain: false,
      provider: "codex",
      model: "gpt-6.1-sol",
      enabled: true,
    });
    expect(list[1].lens).toContain("second reader");
    expect(list[1].cardInstruction).toContain("check its claims against the code");
    // Issue #359: Clarity follows the main model at run time.
    expect(list[1]).toMatchObject({
      id: "clarity",
      name: "Clarity",
      followMain: true,
      enabled: true,
    });
    expect(list[1].lens).toContain("You are Clarity");

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, svc);
    const row = page.getByTestId("persona-second-opinion");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Second opinion");
    await expect(row).toContainText("codex/gpt-6.1-sol");
    await expect(row.getByTestId("persona-second-opinion-swatch")).toBeVisible();
    const clarityRow = page.getByTestId("persona-clarity");
    await expect(clarityRow).toBeVisible();
    await expect(clarityRow).toContainText("Clarity");
    await expect(clarityRow).toContainText("Guide's model (claude/claude-opus-5-5)");
    await checkLayout(page, "personas-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "personas-1440-light.png") });
  });

  test("Clarity follows the main model until pinned", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, svc);
    const row = page.getByTestId("persona-clarity");
    await expect(row).toBeVisible();
    await row.getByTestId("persona-clarity-edit").click();
    await expect(page.getByTestId("persona-clarity-lens")).toBeVisible();
    // Seeded following main: the box is checked, the pin fields hide.
    await expect(page.getByTestId("persona-clarity-follow-main")).toBeChecked();
    await expect(page.getByTestId("persona-clarity-provider")).toHaveCount(0);
    await expect(page.getByTestId("persona-clarity-model")).toHaveCount(0);
    // Uncheck: the provider/model pickers come back (no CLIs on PATH,
    // so the model list shows the adapter error — the saved pick below
    // still applies). Re-check and save: still following main.
    await page.getByTestId("persona-clarity-follow-main").click();
    await expect(page.getByTestId("persona-clarity-provider")).toBeVisible();
    await page.getByTestId("persona-clarity-follow-main").click();
    await expect(page.getByTestId("persona-clarity-provider")).toHaveCount(0);
    await page.getByTestId("persona-clarity-save").click();
    await expect(page.getByTestId("persona-clarity-lens")).toHaveCount(0);
    const list = await personas(svc);
    const clarity = list.find((p) => p.id === "clarity");
    expect(clarity?.followMain).toBe(true);
    await expect(row).toContainText("Guide's model (claude/claude-opus-5-5)");
  });

  test("edit form frame", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, svc);
    const row = page.getByTestId("persona-second-opinion");
    await row.getByTestId("persona-second-opinion-edit").click();
    await expect(page.getByTestId("persona-second-opinion-lens")).toBeVisible();
    // Park the mouse away from the row so Close isn't caught in hover.
    await page.mouse.move(720, 20);
    await page.screenshot({ path: path.join(SHOTS, "personas-edit-form.png") });
    await row.getByTestId("persona-second-opinion-edit").click();
  });

  test("add form frame", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, svc);
    await page.getByTestId("persona-add").click();
    await expect(page.getByTestId("persona-new-lens")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "personas-add-form.png") });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("persona-new-lens")).toHaveCount(0);
  });

  test("add, edit and delete a custom persona", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Add through the API (no agent CLIs on PATH, so the UI model
    // dropdown cannot list provider models here).
    const custom = {
      id: "perf-sceptic",
      name: "Performance sceptic",
      followMain: false,
      provider: "claude",
      model: "claude-opus-5-5",
      lens: "You are a performance sceptic: you read every card asking what it costs at scale.",
      cardInstruction: "",
      enabled: true,
      color: "#C2410C",
    };
    const seed = await personas(svc);
    const added = await apiJson(svc, "PUT", "/api/settings", { personas: [...seed, custom] });
    expect(added.status).toBe(200);
    expect((added.json as { personas: PersonaBody[] }).personas).toHaveLength(4);

    await gotoPersonas(page, svc);
    const row = page.getByTestId("persona-perf-sceptic");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Performance sceptic");
    await expect(row).toContainText("claude/claude-opus-5-5");

    // Edit through the UI: rename + disable.
    await row.getByTestId("persona-perf-sceptic-edit").click();
    await expect(page.getByTestId("persona-perf-sceptic-name")).toBeVisible();
    await page.getByTestId("persona-perf-sceptic-name").fill("Perf sceptic");
    await page.getByTestId("persona-perf-sceptic-enabled").click();
    await page.getByTestId("persona-perf-sceptic-save").click();
    await expect(row).toContainText("Perf sceptic");
    await expect(row).toContainText("Off");
    const afterEdit = await personas(svc);
    expect(afterEdit.find((p) => p.id === "perf-sceptic")?.name).toBe("Perf sceptic");
    expect(afterEdit.find((p) => p.id === "perf-sceptic")?.enabled).toBe(false);

    // Delete through the shared inline confirm: Escape cancels first.
    await row.getByRole("button", { name: "Delete Perf sceptic" }).click();
    await expect(row.getByText("Confirm delete the “Perf sceptic” persona")).toBeVisible();
    // Let the entry animation settle (uic-drop, .16s): the settled pill
    // is the opaque dark one (#346 mid-fade capture).
    const pill = row.locator(".uic-pill");
    await expect
      .poll(() => pill.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
      .toBe("1");
    // While confirming the Edit button hides, so the row actions stay put.
    await expect(row.getByTestId("persona-perf-sceptic-edit")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "personas-delete-confirm.png") });
    await page.keyboard.press("Escape");
    await expect(row.getByText("Confirm delete the “Perf sceptic” persona")).toHaveCount(0);
    await expect(row).toBeVisible();
    // Confirm: the row goes and the API forgets it (both built-ins stay).
    await row.getByRole("button", { name: "Delete Perf sceptic" }).click();
    await row.getByRole("button", { name: "Confirm delete the “Perf sceptic” persona" }).click();
    await expect(row).toHaveCount(0);
    expect((await personas(svc)).map((p) => p.id)).toEqual(["guide", "second-opinion", "clarity"]);
  });
});

// ---- j349b-personas-variants.spec.ts (frames re-added) ----
const PERSONA_ID = "second-opinion";
const PERSONA_RGB = "14, 124, 134";
const CLARITY_ID = "clarity";
const CLARITY_RGB = "194, 65, 12";

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
    // avatar — 1440px light (#362 default).
    await page.mouse.move(720, 20);
    await checkLayout(page, "persona-version-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "persona-version-1440-light.png") });
  });

  test("Clarity run on a card: tab with citations intact", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // The persona menu lists Clarity beside Second opinion.
    const menuButton = page.locator('#C-central [data-persona-menu="central"]');
    await expect(menuButton).toBeVisible({ timeout: 15_000 });
    await menuButton.click();
    const menu = page.locator('[data-persona-menu-list="central"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator(`[data-persona-option="${CLARITY_ID}"]`)).toContainText("Clarity");
    await menu.locator(`[data-persona-option="${CLARITY_ID}"]`).click();

    // Guide + Second opinion + Clarity tabs; Clarity stores revision 1
    // with no error.
    const tabs = page.locator('[data-testid="versions-central"]');
    await expect(tabs).toBeVisible({ timeout: 60_000 });
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(svc, reviewId);
        if (variants[CLARITY_ID]?.blocks.length) break;
        if (Date.now() > deadline) throw new Error("clarity variant never stored");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const stored = (await centralVariants(svc, reviewId))[CLARITY_ID];
    expect(stored.revision).toBe(1);
    expect(stored.error ?? null).toBeNull();
    expect(JSON.stringify(stored.blocks)).toContain("src-urllib3-connection");

    // The Clarity tab shows the rewrite under its own colour border.
    await tabs.locator(`[data-version-tab="${CLARITY_ID}"]`).click();
    await expect(tabs.locator(`[data-version-tab="${CLARITY_ID}"]`)).toContainText("Clarity");
    const card = page.locator("#C-central");
    await expect(card).toContainText("reads more directly", { timeout: 15_000 });
    const ring = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).toContain(CLARITY_RGB);
    await page.mouse.move(720, 20);
    await checkLayout(page, "persona-clarity-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "persona-clarity-1440-light.png") });
  });
});
