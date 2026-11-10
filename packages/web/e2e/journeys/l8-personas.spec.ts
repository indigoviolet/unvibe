/**
 * L8 — Personas and providers (#363 package C).
 *
 * The personas area in usage order: built-ins seeded and listed, Clarity
 * following the main model until pinned, add/edit/delete of a custom
 * persona through the shared inline confirm, a persona run on a card
 * with tabs and a persona-tab Ask, Clarity's run keeping citations,
 * the model/provider halves (pick a model, effort stays Default; display
 * names on the real service), and the pi provider (pickers, a review run
 * on the fake pi, fallback without pi on PATH, stubs-only probing).
 *
 * Boots: ONE agent:none settings service (personas API + UI, model
 * halves); ONE replay service over a seeded demo (persona runs);
 * the pi service pair (liveRunner against the fake pi on PATH, plus a
 * plain service with pi hidden — fixed ports 4529/4530, the j279
 * convention).
 *
 * Absorbs: `j349-personas` (behaviour: built-ins listed, Clarity
 * follows, add/edit/delete; the edit/add form frames → tour),
 * `j349b-personas-variants` (both), `j279-pi` (all 4), the
 * model/provider halves of `j11-settings-combos` (pick a model, effort
 * Default, appearance/repo/reset/access halves stay for package D's L9)
 * and the model-display-names half of `j5-settings-versions` (the rest
 * stays for L9).
 *
 * Guards kept: #349 (built-ins seeded; Second opinion lens + card
 * instruction; Clarity follows main until pinned); #359 (Clarity follows
 * the main model at run time); #346 (persona delete through the shared
 * inline confirm, with the Escape path); #279/#280 (no test reads or
 * writes the real home: scratch HOME, stub `claude`/`codex`/`pi` first
 * on PATH that answer `--version`; #300 option A: explicit overrides so
 * adapters never enumerate PATH); #172 (thinking levels from pi's
 * adapter).
 *
 * Security and provider guards — where each one landed:
 * - Only stubs + the fake are probed or chosen (no real agent binary
 *   runs): the diagnostics report asserts every claude/codex/pi
 *   candidate and choice is a stub/fake path, and the stub calls log
 *   holds only version probes, login checks and refused setups.
 * - `UNVIBE_ALLOW_LIVE_AGENT` is set for the pi child only (harness);
 *   every other L8 service boots `none`/`replay`.
 * - Live spend is impossible here: the fake pi answers from fixture
 *   recordings (`UNVIBE_FAKE_PI_MODE=replay`); real `test:live:*` tasks
 *   stay opt-in and never run under `check`.
 *
 * Brittleness fixed here (#363 §4): the `j11:62` 250 ms popup-settle
 * sleep (B2 — the shared `pickOption` settle poll: the option's box must
 * stop moving before the click); the `j349` mid-fade capture keeps its
 * opacity poll (already a state wait, not a sleep).
 *
 * Frames removed (tour owns them; package D re-adds): the j349
 * personas-1440-light / edit-form / add-form / delete-confirm shots and
 * the j349b persona-dropdown / persona-version / persona-clarity shots.
 * The `checkLayout` sweeps stay (package A convention). No `shot()` or
 * `screenshot` lines remain in the gate.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview, createSeededDemoReview } from "./journey-helpers.js";
import { selectText } from "../select-text.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// ---------------------------------------------------------------------------
// Settings service: personas CRUD + model/provider halves.
// ---------------------------------------------------------------------------

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

async function gotoPersonas(page: Page, svc: RunningService): Promise<void> {
  await page.goto(`${svc.origin}/settings?token=${svc.token}`);
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Personas" }).click();
  await expect(page.getByTestId("personas-section")).toBeVisible();
}

test.describe("L8 personas settings", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8-data-"));
    svc = await startService(dataDir, { agent: "none", label: "l8settings" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("built-ins are seeded and listed", async ({ page }) => {
    const s = service();
    await test.step("the API seeds the fixed Guide, Second opinion and Clarity", async () => {
      const list = await personas(s);
      expect.soft(list).toHaveLength(3);
      // Issue #379: the fixed Guide seeds first (the main agent).
      expect.soft(list[0]).toMatchObject({
        id: "guide",
        name: "Guide",
        followMain: false,
        enabled: true,
        cardInstruction: "",
      });
      expect.soft(list[0]!.lens).toBe("");
      expect.soft(list[1]).toMatchObject({
        id: "second-opinion",
        name: "Second opinion",
        followMain: false,
        provider: "codex",
        model: "gpt-6.1-sol",
        enabled: true,
      });
      expect.soft(list[1]!.lens).toContain("second reader");
      expect.soft(list[1]!.cardInstruction).toContain("check its claims against the code");
      // Issue #359: Clarity follows the Guide's model at run time.
      expect.soft(list[2]).toMatchObject({
        id: "clarity",
        name: "Clarity",
        followMain: true,
        enabled: true,
      });
      expect.soft(list[2]!.lens).toContain("You are Clarity");
    });

    await test.step("Settings lists all three with their models", async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoPersonas(page, s);
      const guideRow = page.getByTestId("persona-guide");
      await expect.soft(guideRow).toBeVisible();
      await expect.soft(guideRow).toContainText("Guide");
      const row = page.getByTestId("persona-second-opinion");
      await expect.soft(row).toBeVisible();
      await expect.soft(row).toContainText("Second opinion");
      await expect.soft(row).toContainText("codex/gpt-6.1-sol");
      await expect.soft(row.getByTestId("persona-second-opinion-swatch")).toBeVisible();
      const clarityRow = page.getByTestId("persona-clarity");
      await expect.soft(clarityRow).toBeVisible();
      await expect.soft(clarityRow).toContainText("Clarity");
      await expect.soft(clarityRow).toContainText("Guide's model (claude/claude-opus-5-5)");
      await checkLayout(page, "personas-1440-light");
    });
  });

  test("Clarity follows the main model until pinned", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, s);
    const row = page.getByTestId("persona-clarity");
    await expect(row).toBeVisible();
    await row.getByTestId("persona-clarity-edit").click();
    await test.step("seeded following main: the box is checked, the pin fields hide", async () => {
      await expect.soft(page.getByTestId("persona-clarity-lens")).toBeVisible();
      await expect.soft(page.getByTestId("persona-clarity-follow-main")).toBeChecked();
      await expect.soft(page.getByTestId("persona-clarity-provider")).toHaveCount(0);
      await expect.soft(page.getByTestId("persona-clarity-model")).toHaveCount(0);
    });
    await test.step("uncheck shows pickers; re-check and save: still following main", async () => {
      // Uncheck: the provider/model pickers come back (no CLIs on PATH,
      // so the model list shows the adapter error — the saved pick below
      // still applies). Re-check and save: still following main.
      await page.getByTestId("persona-clarity-follow-main").click();
      await expect.soft(page.getByTestId("persona-clarity-provider")).toBeVisible();
      await page.getByTestId("persona-clarity-follow-main").click();
      await expect.soft(page.getByTestId("persona-clarity-provider")).toHaveCount(0);
      await page.getByTestId("persona-clarity-save").click();
      await expect.soft(page.getByTestId("persona-clarity-lens")).toHaveCount(0);
      const list = await personas(s);
      const clarity = list.find((p) => p.id === "clarity");
      expect.soft(clarity?.followMain).toBe(true);
      await expect.soft(row).toContainText("Guide's model (claude/claude-opus-5-5)");
    });
  });

  test("add, edit and delete a custom persona", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });

    await test.step("add through the API (no agent CLIs on PATH, so no picker models)", async () => {
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
      const seed = await personas(s);
      const added = await apiJson(s, "PUT", "/api/settings", { personas: [...seed, custom] });
      expect(added.status).toBe(200);
      expect((added.json as { personas: PersonaBody[] }).personas).toHaveLength(4);
      await gotoPersonas(page, s);
      const row = page.getByTestId("persona-perf-sceptic");
      await expect.soft(row).toBeVisible({ timeout: 15_000 });
      await expect.soft(row).toContainText("Performance sceptic");
      await expect.soft(row).toContainText("claude/claude-opus-5-5");
    });

    await test.step("edit through the UI: rename + disable", async () => {
      const row = page.getByTestId("persona-perf-sceptic");
      await row.getByTestId("persona-perf-sceptic-edit").click();
      await expect.soft(page.getByTestId("persona-perf-sceptic-name")).toBeVisible();
      await page.getByTestId("persona-perf-sceptic-name").fill("Perf sceptic");
      await page.getByTestId("persona-perf-sceptic-enabled").click();
      await page.getByTestId("persona-perf-sceptic-save").click();
      await expect.soft(row).toContainText("Perf sceptic");
      await expect.soft(row).toContainText("Off");
      const afterEdit = await personas(s);
      expect.soft(afterEdit.find((p) => p.id === "perf-sceptic")?.name).toBe("Perf sceptic");
      expect.soft(afterEdit.find((p) => p.id === "perf-sceptic")?.enabled).toBe(false);
    });

    await test.step("delete through the shared inline confirm, with the Escape path", async () => {
      const row = page.getByTestId("persona-perf-sceptic");
      await row.getByRole("button", { name: "Delete Perf sceptic" }).click();
      await expect.soft(row.getByText("Confirm delete the “Perf sceptic” persona")).toBeVisible();
      // Let the entry animation settle (uic-drop, .16s): the settled pill
      // is the opaque dark one (#346 mid-fade capture).
      const pill = row.locator(".uic-pill");
      await expect
        .soft.poll(() => pill.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
        .toBe("1");
      // While confirming the Edit button hides, so the row actions stay put.
      await expect.soft(row.getByTestId("persona-perf-sceptic-edit")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect.soft(row.getByText("Confirm delete the “Perf sceptic” persona")).toHaveCount(0);
      await expect.soft(row).toBeVisible();
      // Confirm: the row goes and the API forgets it (both built-ins stay).
      await row.getByRole("button", { name: "Delete Perf sceptic" }).click();
      await row.getByRole("button", { name: "Confirm delete the “Perf sceptic” persona" }).click();
      await expect.soft(row).toHaveCount(0);
      expect.soft((await personas(s)).map((p) => p.id)).toEqual(["guide", "second-opinion", "clarity"]);
    });
  });

  test("model persists, effort stays Default with no agent (j11 Models half)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    // Models: pick a different offered model for the small role; it persists.
    // (Issue #379: Models keeps only the small model; the main model lives
    // in the Guide persona. Effort levels come from a live adapter, so with
    // no agent the control honestly stays on Default — asserted, not skipped.)
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-small"]')).toBeVisible({ timeout: 30_000 });
    const model = page.locator("#model-small");
    await expect(model).toBeVisible({ timeout: 30_000 });
    const currentText = (await model.textContent())?.trim() ?? "";
    await model.click();
    const options = openPopup(page).getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    const names = await options.evaluateAll((os) =>
      os.map((o) => (o.textContent ?? "").replace("✓", "").trim()),
    );
    const picked = names.filter((n) => n !== "");
    expect(picked.length).toBeGreaterThan(1);
    const idx = names.findIndex((n) => n !== "" && n !== currentText);
    expect(idx).toBeGreaterThanOrEqual(0);
    const chosenName = names[idx]!;
    const target = options.nth(idx);
    // Settle Floating UI first: scrolling the option into view repositions
    // the popup, and clicking mid-reposition can land outside the item
    // (popup closes with no selection). Subscribe before clicking: the
    // localhost save can answer before the click resolves.
    // (#363 B2: settle poll, never a fixed sleep.)
    await target.scrollIntoViewIfNeeded();
    let prev = "";
    await expect
      .poll(
        async () => {
          const b = await target.boundingBox();
          const cur = b ? `${b.x},${b.y},${b.width},${b.height}` : "hidden";
          const settled = prev !== "" && cur !== "hidden" && cur === prev;
          prev = cur;
          return settled;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await target.click();
    await saved;
    await expect.soft(page.locator("#effort-small")).toContainText("Default", { timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    await expect.soft(page.locator("#model-small")).toContainText(chosenName, { timeout: 30_000 });
  });

  test("model pickers show display names on the real service (j5 Models half)", async ({ page }) => {
    test.setTimeout(60000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 20000 });
    await page.getByRole("tab", { name: "Models" }).click();
    // Static fallback carries names (Sonnet/Opus/GPT) even with no agent.
    // Issue #379: only the small picker remains; the main model lives in
    // the Guide persona.
    const small = page.locator('[data-testid="model-small"]');
    await small.locator("#model-small").click();
    await expect.soft(openPopup(page).getByRole("option", { name: "Sonnet" })).toBeVisible();
    await expect(page.locator('[data-testid="model-main"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Persona-run service: persona versions on cards.
// ---------------------------------------------------------------------------

test.describe("L8 persona runs on cards", () => {
  const PERSONA_ID = "second-opinion";
  const PERSONA_RGB = "14, 124, 134";
  const CLARITY_ID = "clarity";
  const CLARITY_RGB = "194, 65, 12";

  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  interface VariantBody {
    personaId: string;
    blocks: unknown[];
    level: string;
    revision: number;
    sessionId?: string;
    working?: string | null;
    error?: string | null;
  }

  async function centralVariants(s: RunningService, id: string): Promise<Record<string, VariantBody>> {
    const res = await apiJson(s, "GET", `/api/reviews/${id}`);
    expect(res.status).toBe(200);
    const cards = ((res.json as { pages: { cards: { id: string; variants?: Record<string, VariantBody> }[] }[] }).pages ?? []).flatMap(
      (p) => p.cards,
    );
    return cards.find((c) => c.id === "central")?.variants ?? {};
  }

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8run-data-"));
    reviewId = createSeededDemoReview(dataDir, "l8run-seed");
    svc = await startService(dataDir, { agent: "replay", label: "l8run" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page): Promise<void> {
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("persona run on a card, tabs, persona-tab Ask", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    await openReview(page);

    await test.step("the toolbar carries the persona picker", async () => {
      const menuButton = page.locator('#C-central [data-persona-menu="central"]');
      await expect.soft(menuButton).toBeVisible({ timeout: 15_000 });
      await menuButton.click();
      const menu = page.locator('[data-persona-menu-list="central"]');
      await expect.soft(menu).toBeVisible();
      await expect.soft(menu.locator(`[data-persona-option="${PERSONA_ID}"]`)).toContainText("Second opinion");
      // Park the mouse away so no hover state leaks into the layout check.
      await page.mouse.move(720, 20);
      await checkLayout(page, "persona-dropdown-1440-light");
      await menu.locator(`[data-persona-option="${PERSONA_ID}"]`).click();
    });

    await test.step("two tabs; the API stores revision 1 with no error", async () => {
      const tabs = page.locator('[data-testid="versions-central"]');
      await expect.soft(tabs).toBeVisible({ timeout: 60_000 });
      await expect.soft(tabs.locator('[data-version-tab="guide"]')).toContainText("Guide");
      await expect.soft(tabs.locator(`[data-version-tab="${PERSONA_ID}"]`)).toContainText("Second opinion");
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(s, reviewId);
        if (variants[PERSONA_ID]?.blocks.length) break;
        if (Date.now() > deadline) throw new Error("persona variant never stored");
        await new Promise((r) => setTimeout(r, 500));
      }
      const stored = (await centralVariants(s, reviewId))[PERSONA_ID]!;
      expect.soft(stored.revision).toBe(1);
      expect.soft(stored.sessionId).toBeTruthy();
      expect.soft(stored.error ?? null).toBeNull();
    });

    await test.step("the persona tab shows its own text under its own colour border", async () => {
      const tabs = page.locator('[data-testid="versions-central"]');
      await tabs.locator(`[data-version-tab="${PERSONA_ID}"]`).click();
      const card = page.locator("#C-central");
      await expect.soft(card).toContainText("checked it against the code", { timeout: 15_000 });
      const ring = await card.evaluate((el) => getComputedStyle(el).boxShadow);
      expect.soft(ring).toContain(PERSONA_RGB);
    });

    await test.step("depth on the persona tab rewrites the variant, never the Guide version", async () => {
      const tabs = page.locator('[data-testid="versions-central"]');
      const card = page.locator("#C-central");
      // The depth stepper's dots (not the icons) on the persona tab:
      // deeper rewrites the variant, never the Guide version.
      const variantTextBefore = await card.locator(".prose, .lst").first().innerText();
      await card.getByRole("button", { name: "Deeper" }).click();
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(s, reviewId);
        if (variants[PERSONA_ID]?.level === "deep") break;
        if (Date.now() > deadline) throw new Error("persona depth never landed");
        await new Promise((r) => setTimeout(r, 500));
      }
      const afterDepth = (await centralVariants(s, reviewId))[PERSONA_ID]!;
      expect.soft(afterDepth.revision).toBeGreaterThanOrEqual(2);
      await expect.soft(card.locator(".prose, .lst").first()).not.toHaveText(variantTextBefore, { timeout: 15_000 });
      // Back on Guide: the variant rewrite left it untouched.
      await tabs.locator('[data-version-tab="guide"]').click();
      await expect.soft(card.locator(".prose, .lst").first()).toContainText("unfolds every obs-fold right after parsing", {
        timeout: 15_000,
      });
      await tabs.locator(`[data-version-tab="${PERSONA_ID}"]`).click();
      await expect.soft(card).toContainText("CRLF is the framing delimiter", { timeout: 15_000 });
    });

    await test.step("Ask on the persona text stays with the persona and wears its colour", async () => {
      await selectText(page, "#C-central", "framing delimiter");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator('#C-central .ithread[data-pending-thread]');
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      const beforeAsk = (
        (await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as { annotations: { id: string }[] }
      ).annotations.map((a) => a.id);
      await composer.locator("textarea").fill("What does this cost at scale?");
      await composer.getByRole("button", { name: "Ask" }).click();
      let threadId: string | null = null;
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
        threadId = ids.find((id) => !beforeAsk.includes(id)) ?? null;
        if (threadId) break;
        if (Date.now() > deadline) throw new Error("persona ask thread never appeared");
        await new Promise((r) => setTimeout(r, 500));
      }
      const thread = (
        ((await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as {
          annotations: { id: string; personaId?: string; personaCardId?: string; replies: { blocks: unknown[] }[] }[];
        }).annotations ?? []
      ).find((a) => a.id === threadId);
      expect.soft(thread?.personaId).toBe(PERSONA_ID);
      expect.soft(thread?.personaCardId).toBe("central");
      expect.soft((thread?.replies ?? [])[0]?.blocks.length ?? 0).toBeGreaterThan(0);
      const threadEl = page.locator(`#C-central section.ithread[data-thread="${threadId}"]`).first();
      await expect.soft(threadEl).toBeVisible({ timeout: 30_000 });
      const avatar = threadEl.locator(".av.ai").first();
      await expect.soft(avatar).toBeVisible({ timeout: 30_000 });
      const avatarBg = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect.soft(avatarBg).toContain(PERSONA_RGB);
      // The persona version frames: tab active, coloured border, recoloured
      // avatar — 1440px light (#362 default).
      await page.mouse.move(720, 20);
      await checkLayout(page, "persona-version-1440-light");
    });
  });

  test("Clarity run on a card: tab with citations intact", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    await openReview(page);

    await test.step("the persona menu lists Clarity beside Second opinion", async () => {
      const menuButton = page.locator('#C-central [data-persona-menu="central"]');
      await expect.soft(menuButton).toBeVisible({ timeout: 15_000 });
      await menuButton.click();
      const menu = page.locator('[data-persona-menu-list="central"]');
      await expect.soft(menu).toBeVisible();
      await expect.soft(menu.locator(`[data-persona-option="${CLARITY_ID}"]`)).toContainText("Clarity");
      await menu.locator(`[data-persona-option="${CLARITY_ID}"]`).click();
    });

    await test.step("Clarity stores revision 1 with the rewrite's citations", async () => {
      const tabs = page.locator('[data-testid="versions-central"]');
      await expect.soft(tabs).toBeVisible({ timeout: 60_000 });
      const deadline = Date.now() + 90_000;
      for (;;) {
        const variants = await centralVariants(s, reviewId);
        if (variants[CLARITY_ID]?.blocks.length) break;
        if (Date.now() > deadline) throw new Error("clarity variant never stored");
        await new Promise((r) => setTimeout(r, 500));
      }
      const stored = (await centralVariants(s, reviewId))[CLARITY_ID]!;
      expect.soft(stored.revision).toBe(1);
      expect.soft(stored.error ?? null).toBeNull();
      expect.soft(JSON.stringify(stored.blocks)).toContain("src-urllib3-connection");
    });

    await test.step("the Clarity tab shows the rewrite under its own colour border", async () => {
      const tabs = page.locator('[data-testid="versions-central"]');
      await tabs.locator(`[data-version-tab="${CLARITY_ID}"]`).click();
      await expect.soft(tabs.locator(`[data-version-tab="${CLARITY_ID}"]`)).toContainText("Clarity");
      const card = page.locator("#C-central");
      await expect.soft(card).toContainText("reads more directly", { timeout: 15_000 });
      const ring = await card.evaluate((el) => getComputedStyle(el).boxShadow);
      expect.soft(ring).toContain(CLARITY_RGB);
      await page.mouse.move(720, 20);
      await checkLayout(page, "persona-clarity-1440-light");
    });
  });

  test("Guide model + style lens flow into the next main run", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // Issue #379: the fixed Guide owns the main model and a writing-style
    // lens. Editing both, then running depth on the Guide version, must
    // reach the runner on the Guide's model with the lens up front.
    const LENS = "Write with short sentences. No jargon without a gloss.";

    await test.step("edit the Guide lens through the Settings UI", async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${s.origin}/settings?token=${s.token}`);
      await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Personas" }).click();
      await expect(page.getByTestId("personas-section")).toBeVisible();
      const row = page.getByTestId("persona-guide");
      await expect.soft(row).toBeVisible({ timeout: 15_000 });
      await expect.soft(row).toContainText("Guide");
      // The fixed entry is neutral (no colour dot) with no delete and
      // no disable switch.
      await expect.soft(page.getByTestId("persona-guide-swatch")).toHaveCount(0);
      await expect.soft(row.getByRole("button", { name: /Delete/ })).toHaveCount(0);
      await row.getByTestId("persona-guide-edit").click();
      await expect.soft(page.getByTestId("persona-guide-lens")).toBeVisible();
      // No card-instruction field and no model-source choice on the Guide.
      await expect.soft(page.getByTestId("persona-guide-card-instruction")).toHaveCount(0);
      await expect.soft(page.getByTestId("persona-guide-follow-main")).toHaveCount(0);
      await page.getByTestId("persona-guide-lens").fill(LENS);
      await page.getByTestId("persona-guide-save").click();
      await expect.soft(page.getByTestId("persona-guide-lens")).toHaveCount(0);
      const list = await personas(s);
      expect.soft(list.find((p) => p.id === "guide")?.lens).toBe(LENS);
    });

    await test.step("point the Guide at another model through the API (no agent CLIs on PATH, so the UI model list stays empty)", async () => {
      const seed = await personas(s);
      const res = await apiJson(s, "PUT", "/api/settings", {
        personas: seed.map((p) => (p.id === "guide" ? { ...p, provider: "codex", model: "gpt-6.1-sol" } : p)),
      });
      expect(res.status).toBe(200);
      expect((res.json as { personas: PersonaBody[] }).personas.find((p) => p.id === "guide")).toMatchObject({
        provider: "codex",
        model: "gpt-6.1-sol",
      });
    });

    await test.step("deeper on the Guide version runs on the Guide model with the lens up front", async () => {
      const before = (
        (await apiJson(s, "GET", `/api/jobs?review=${reviewId}`)).json as { jobs: { id: string }[] }
      ).jobs.map((j) => j.id);
      await openReview(page);
      // Earlier steps left persona tabs behind; the Guide version is the
      // untinted tab.
      const tabs = page.locator('[data-testid="versions-central"]');
      if (await tabs.isVisible()) {
        await tabs.locator('[data-version-tab="guide"]').click();
      }
      const card = page.locator("#C-central");
      await card.getByRole("button", { name: "Deeper" }).click();
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        const level = ((res.json as { pages: { cards: { id: string; level: string }[] }[] }).pages ?? [])
          .flatMap((p) => p.cards)
          .find((c) => c.id === "central")?.level;
        if (level === "deep") break;
        if (Date.now() > deadline) throw new Error("guide depth never landed");
        await new Promise((r) => setTimeout(r, 500));
      }
      // The new depth job ran on the Guide's model…
      const after = (await apiJson(s, "GET", `/api/jobs?review=${reviewId}`)).json as {
        jobs: { id: string; kind: string; provider: string; model: string }[];
      };
      const depth = after.jobs.filter((j) => j.kind === "depth" && !before.includes(j.id)).at(-1);
      expect(depth).toBeDefined();
      expect(depth).toMatchObject({ provider: "codex", model: "gpt-6.1-sol" });
      // …with the lens at the start of the turn and the task rules intact.
      const full = (await apiJson(s, "GET", `/api/jobs/${depth!.id}`)).json as {
        job: { promptSnapshot: string };
      };
      expect(full.job.promptSnapshot.startsWith(`# Writing style\n\n${LENS}\n\n`)).toBe(true);
      expect(full.job.promptSnapshot).toContain("# Depth rewrite");
      await expect.soft(card.locator(".prose, .lst").first()).toContainText("CRLF", { timeout: 15_000 });
    });
  });
});

// ---------------------------------------------------------------------------
// pi provider: pickers, a review run, fallback, stubs-only probing.
// ---------------------------------------------------------------------------

const FAKE_PI = fileURLToPath(new URL("../../../service/test/fake-pi.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));

/** Fake `pi` on PATH: the bundled RPC fake answering from the fixture recordings. */
function writeFakePi(binDir: string): void {
  const script = `#!/bin/sh\nexec "${process.execPath}" "${FAKE_PI}" "$@"\n`;
  writeFileSync(path.join(binDir, "pi"), script, { mode: 0o755 });
}

/**
 * Blocking agent stubs: `claude`, `codex` and `pi` that log every call,
 * print "blocked in tests" and answer `--version` with a fake version.
 * They must succeed (exit 0), not fail: diagnostics probes every PATH
 * candidate and skips broken ones, and the ACP adapter falls back to its
 * bundled binary when its override fails — either would execute a real
 * binary (a real `claude` startup writes first-run files and breaks the
 * temp guard). Answered first on PATH, the stubs are chosen and nothing
 * real ever runs. Every line appended is `<name> <args>`.
 */
function writeBlockedStubs(blockedDir: string, logFile: string): void {
  for (const name of ["claude", "codex", "pi"]) {
    const script = `#!/bin/sh\necho "${name} $*" >> "${logFile}"\necho "blocked in tests: ${name}" >&2\nif [ "$1" = "--version" ]; then echo "0.0.0-blocked"; exit 0; fi\nexit 1\n`;
    writeFileSync(path.join(blockedDir, name), script, { mode: 0o755 });
  }
}

function readBlockedLog(logFile: string): string[] {
  try {
    return readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Assert /api/diagnostics probed and chose only the expected binaries for
 * claude/codex/pi (issue #300, option A). With explicit overrides the
 * service never enumerates PATH, so exactly one candidate per tool proves
 * no real install was executed — by version probes, shim resolution, or
 * adapter sessions. A missing override (plain pi) must be the lone
 * candidate with a null choice.
 */
async function expectDiagnosedOnly(
  target: RunningService,
  expected: { tool: "claude" | "codex" | "pi"; candidates: string[]; chosen: string | null }[],
): Promise<void> {
  const res = await apiJson(target, "GET", "/api/diagnostics");
  expect(res.status).toBe(200);
  const tools = (res.json as {
    tools: { tool: string; candidates: { path: string }[]; chosen: string | null }[];
  }).tools;
  for (const { tool, candidates, chosen } of expected) {
    const t = tools.find((t) => t.tool === tool);
    expect(t, `${tool} diagnosed`).toBeDefined();
    expect(t!.candidates.map((c) => c.path)).toEqual(candidates);
    expect(t!.chosen).toBe(chosen);
  }
}

test.describe("L8 pi provider", () => {
  let binDir = "", blockedDir = "", blockedLog = "", dataDir = "", plainDir = "", scratchHome = "";
  let svc: RunningService | null = null;
  let plain: RunningService | null = null;

  test.beforeAll(async () => {
    binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8pi-bin-"));
    writeFakePi(binDir);
    blockedDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8pi-blocked-"));
    blockedLog = path.join(blockedDir, "calls.log");
    writeBlockedStubs(blockedDir, blockedLog);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8pi-data-"));
    plainDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8pi-plain-"));
    // Hermetic home: the service's login-shell PATH probe must not pick up
    // a real pi from the developer machine (shared box). The fake stays
    // first on the inherited PATH, so detection, Doctor and login probes
    // all see the fake only — no login, no spend.
    scratchHome = mkdtempSync(path.join(os.tmpdir(), "unvibe-l8pi-home-"));
    svc = await startService(dataDir, {
      liveRunner: true,
      label: "l8-pi",
      // Fixed port (not ephemeral): the service's MCP mount URL is built
      // from UNVIBE_PORT, and `:0` would leave agent sessions with dead
      // review-tool URLs.
      port: "4529",
      // Issue #370: the fake pi lives in binDir, the blocking stubs in
      // blockedDir — both are harness fakes the service may run.
      testBinDir: [binDir, blockedDir],
      extraEnv: {
        HOME: scratchHome,
        // Fake pi first, then the blocking stubs, then the rest: no real
        // agent binary is reachable even if settings fall back to
        // claude/codex or a login-shell PATH is applied.
        PATH: `${binDir}${path.delimiter}${blockedDir}${path.delimiter}${process.env.PATH ?? ""}`,
        // Issue #300, option A: pin the agent binaries to the fakes via
        // explicit overrides. An override is probed exclusively (no PATH
        // enumeration, so real installs are never even executed) and is
        // honoured even when "broken", so adapters drive the stubs,
        // which refuse loudly, instead of real CLIs.
        UNVIBE_CLAUDE_BIN: path.join(blockedDir, "claude"),
        UNVIBE_CODEX_BIN: path.join(blockedDir, "codex"),
        UNVIBE_PI_BIN: path.join(binDir, "pi"),
        UNVIBE_FAKE_PI_MODE: "replay",
        UNVIBE_FAKE_PI_FIXTURES: FIXTURES,
        // The fake reports its version from here; 1.4.0 meets the minimum.
        UNVIBE_FAKE_PI_VERSION: "1.4.0",
        UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "openai-codex", id: "gpt-fake-1", name: "Fake 1" }]),
        UNVIBE_FAKE_PI_THINKING: JSON.stringify(["low", "high"]),
      },
    });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    await plain?.stop().catch(() => {});
    for (const d of [binDir, blockedDir, dataDir, plainDir]) rmSync(d, { recursive: true, force: true });
    // Scratch HOME last, with retries: an async first-run flush can
    // recreate entries mid-cleanup (ENOTEMPTY on a bare rmSync, which
    // throws instead of retrying). Anything still present afterwards
    // fails loudly below via the per-run temp guard.
    for (let i = 0; i < 5 && existsSync(scratchHome); i++) {
      try {
        rmSync(scratchHome, { recursive: true, force: true });
      } catch {
        // Best effort per attempt; the existsSync check decides.
      }
      if (existsSync(scratchHome)) await new Promise((r) => setTimeout(r, 1000));
    }
    if (existsSync(scratchHome)) {
      throw new Error(`scratch HOME still present after cleanup: ${scratchHome}`);
    }
  });

  test("providers list pi; settings pickers offer it with models and effort; doctor reports it", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    const s: RunningService = svc;

    await test.step("the provider, model and thinking APIs offer pi", async () => {
      const providers = (await apiJson(s, "GET", "/api/providers")).json as { providers: string[] };
      expect.soft(providers.providers).toContain("pi");
      const models = (await apiJson(s, "GET", "/api/models?provider=pi")).json as {
        models: { id: string }[];
      };
      expect.soft(models.models.length).toBeGreaterThan(0);
      const modelId = models.models[0]!.id;
      expect.soft(modelId).not.toBe("");
      const thinking = (await apiJson(s, "GET", "/api/thinking?provider=pi")).json as {
        options: { value: string }[];
      };
      expect.soft(thinking.options.length).toBeGreaterThan(0);
    });

    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-small"]')).toBeVisible({ timeout: 30_000 });

    await test.step("pi is offered alongside claude/codex while detected", async () => {
      await page.locator("#prov-small").click();
      const providerOptions = openPopup(page).getByRole("option");
      await expect.soft(providerOptions.first()).toBeVisible({ timeout: 15_000 });
      const providerNames = await providerOptions.evaluateAll((os) => os.map((o) => (o.textContent ?? "").replace("✓", "").trim()));
      expect.soft(providerNames).toContain("pi");
      await page.keyboard.press("Escape");
    });

    await test.step("pick pi for small; the fake's models save", async () => {
      const models = (await apiJson(s, "GET", "/api/models?provider=pi")).json as { models: { id: string }[] };
      const modelId = models.models[0]!.id;
      await page.locator("#prov-small").click();
      const target = openPopup(page).getByRole("option", { name: "pi" });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      const saveModel = page.waitForResponse(
        (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
        { timeout: 15_000 },
      );
      await page.locator("#model-small").click();
      const modelOption = openPopup(page).getByRole("option").filter({ hasText: modelId });
      await modelOption.first().scrollIntoViewIfNeeded();
      await modelOption.first().click();
      await saveModel;
      await expect.soft(page.locator("#model-small")).toContainText(modelId, { timeout: 15_000 });
      // Thinking levels come from pi's adapter (#172).
      await expect.soft(page.locator("#effort-small")).not.toContainText("Couldn't load thinking levels", { timeout: 15_000 });
    });

    await test.step("pick pi for the Guide in Settings → Personas; the fake's models save", async () => {
      // Issue #379: the Guide owns the main model, so the main pi flow
      // runs through its edit form (the fake pi is detected here, so the
      // model list works — unlike the no-CLI services above).
      const models = (await apiJson(s, "GET", "/api/models?provider=pi")).json as { models: { id: string }[] };
      const modelId = models.models[0]!.id;
      await page.getByRole("tab", { name: "Personas" }).click();
      await expect(page.getByTestId("personas-section")).toBeVisible();
      const row = page.getByTestId("persona-guide");
      await expect(row).toBeVisible();
      await row.getByTestId("persona-guide-edit").click();
      await expect(page.getByTestId("persona-guide-provider")).toBeVisible();
      await page.getByTestId("persona-guide-provider").click();
      const target = openPopup(page).getByRole("option", { name: "pi" });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await expect(page.getByTestId("persona-guide-model")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("persona-guide-model").click();
      const modelOption = openPopup(page).getByRole("option").filter({ hasText: modelId });
      await modelOption.first().scrollIntoViewIfNeeded();
      await modelOption.first().click();
      // The form saves the whole list on Save (provider/model picks above
      // are local state until then).
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
        { timeout: 15_000 },
      );
      await page.getByTestId("persona-guide-save").click();
      await saved;
      await expect.soft(page.getByTestId("persona-guide-model")).toHaveCount(0);
      await expect.soft(row).toContainText(`pi/${modelId}`);
    });

    await test.step("doctor reports pi installed and logged in, in plain words", async () => {
      await page.goto(`${s.origin}/doctor?token=${s.token}`);
      await expect.soft(page.getByTestId("doctor-report")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.getByTestId("doctor-check-pi")).toContainText("logged in", { timeout: 30_000 });
      await expect.soft(page.getByTestId("doctor-tool-pi")).toContainText("fake-pi", { timeout: 30_000 });
    });
  });

  test("a review runs on pi and the guide fills", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Self-contained: pin the Guide + small to the fake pi through the API
    // so this test never depends on the picker test above (and never
    // touches a real agent when run alone).
    const models = (await apiJson(svc, "GET", "/api/models?provider=pi")).json as { models: { id: string }[] };
    const modelId = models.models[0]!.id;
    const before = (await apiJson(svc, "GET", "/api/settings")).json as { personas: PersonaBody[] };
    const saved = await apiJson(svc, "PUT", "/api/settings", {
      personas: before.personas.map((p) => (p.id === "guide" ? { ...p, provider: "pi", model: modelId } : p)),
      small: { provider: "pi", model: modelId, effort: "" },
    });
    expect(saved.status).toBe(200);
    const reviewId = await createDemoReview(svc, 180_000);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    await expect.soft(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
  });

  test("without pi on PATH the pickers go back to claude/codex", async ({ page }) => {
    test.setTimeout(120_000);
    // Deterministic absence whatever the machine has installed: an
    // override pointing nowhere hides the provider. Blocking stubs stand
    // in for claude/codex/pi so nothing real is reachable here either.
    plain = await startService(plainDir, {
      liveRunner: true,
      label: "l8-plain",
      port: "4530",
      // Issue #370: the blocking stubs are harness fakes (see above).
      testBinDir: [blockedDir],
      extraEnv: {
        HOME: scratchHome,
        PATH: `${blockedDir}${path.delimiter}${process.env.PATH ?? ""}`,
        UNVIBE_PI_BIN: path.join(plainDir, "no-such-pi"),
        // Same pinning as the main service (issue #300, option A): real
        // claude/codex installs must not be probed or driven here either.
        UNVIBE_CLAUDE_BIN: path.join(blockedDir, "claude"),
        UNVIBE_CODEX_BIN: path.join(blockedDir, "codex"),
      },
    });
    await test.step("the providers API drops pi", async () => {
      const providers = (await apiJson(plain!, "GET", "/api/providers")).json as { providers: string[] };
      expect.soft(providers.providers).not.toContain("pi");
    });
    await test.step("the Models picker drops pi", async () => {
      await page.goto(`${plain!.origin}/settings?token=${plain!.token}`);
      await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Models" }).click();
      await page.locator("#prov-small").click();
      const providerOptions = openPopup(page).getByRole("option");
      await expect.soft(providerOptions.first()).toBeVisible({ timeout: 15_000 });
      const providerNames = await providerOptions.evaluateAll((os) => os.map((o) => (o.textContent ?? "").replace("✓", "").trim()));
      expect.soft(providerNames).not.toContain("pi");
    });
  });

  test("only stubs and the fake are probed or chosen (no real agent binary runs)", async () => {
    // Runs last: both services above are still up. Issue #300, option A:
    // the services pin claude/codex/pi to the stubs/fake via explicit
    // overrides, and an override is probed exclusively — no PATH
    // enumeration, so a real install is never executed by a version
    // probe, a shim resolution, or an adapter session. The diagnostics
    // report is the direct signal: every probed candidate and the choice
    // must be a stub/fake path. The calls log below is the backstop: only
    // `--version` probes may have reached the stubs.
    if (!svc) throw new Error("no service");
    const claudeStub = path.join(blockedDir, "claude");
    const codexStub = path.join(blockedDir, "codex");
    const fakePi = path.join(binDir, "pi");
    await expectDiagnosedOnly(svc, [
      { tool: "claude", candidates: [claudeStub], chosen: claudeStub },
      { tool: "codex", candidates: [codexStub], chosen: codexStub },
      { tool: "pi", candidates: [fakePi], chosen: fakePi },
    ]);
    if (plain) {
      const missingPi = path.join(plainDir, "no-such-pi");
      await expectDiagnosedOnly(plain, [
        { tool: "claude", candidates: [claudeStub], chosen: claudeStub },
        { tool: "codex", candidates: [codexStub], chosen: codexStub },
        { tool: "pi", candidates: [missingPi], chosen: null },
      ]);
    }
    const calls = readBlockedLog(blockedLog);
    // Full file: both services ran, so probes must have happened (this
    // proves the blockers are on PATH and refusing). Under --grep only
    // this test runs and the log may be empty — the assertions below
    // still hold either way.
    if (plain) expect(calls.length).toBeGreaterThan(0);
    // Option A points the adapters at the stubs, so adapter bootstrap
    // reaches them too — and is refused (exit 1). Only these stub
    // interactions are expected: version probes, the adapter's login
    // and transport checks, and refused session setups. Anything else
    // would mean real work was attempted outside the fake.
    const unexpected = calls.filter(
      (l) =>
        !/^(claude|codex|pi) --version$/.test(l) &&
        !/^claude auth status --json$/.test(l) &&
        !/^codex app-server$/.test(l) &&
        !/^claude --output-format stream-json --verbose --input-format stream-json /.test(l),
    );
    expect(unexpected).toEqual([]);
  });
});
