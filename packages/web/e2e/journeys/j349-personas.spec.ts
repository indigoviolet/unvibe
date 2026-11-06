/**
 * J349 (#349 step 1): Settings → Personas against the real service.
 *
 * The built-in Second opinion is seeded and listed; a custom persona is
 * added, edited and deleted (delete through the shared #346 inline
 * confirm, with the Escape path). The API backs every UI assertion.
 * Frames land in `visual-tour/` for the owner to look at.
 *
 * Persona models are managed through the API here: with no agent CLIs
 * on PATH the service cannot list provider models, so the UI model
 * dropdown shows the adapter error while the saved picks still apply.
 * Fake runner only; no live spend.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";
import { checkLayout } from "../layout-check.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

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

  test("built-in Second opinion is seeded and listed", async ({ page }) => {
    if (!svc) throw new Error("service not running");
    const list = await personas(svc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "second-opinion",
      name: "Second opinion",
      provider: "codex",
      model: "gpt-6.1-sol",
      enabled: true,
    });
    expect(list[0].lens).toContain("second reader");
    expect(list[0].cardInstruction).toContain("check its claims against the code");

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, svc);
    const row = page.getByTestId("persona-second-opinion");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Second opinion");
    await expect(row).toContainText("codex/gpt-6.1-sol");
    await expect(row.getByTestId("persona-second-opinion-swatch")).toBeVisible();
    await checkLayout(page, "personas-1440-light");
    await page.screenshot({ path: path.join(SHOTS, "personas-1440-light.png") });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await checkLayout(page, "personas-1440-dark");
    await page.screenshot({ path: path.join(SHOTS, "personas-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
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
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "personas-edit-form-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
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
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "personas-add-form-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
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
    expect((added.json as { personas: PersonaBody[] }).personas).toHaveLength(2);

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
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "personas-delete-confirm-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page.keyboard.press("Escape");
    await expect(row.getByText("Confirm delete the “Perf sceptic” persona")).toHaveCount(0);
    await expect(row).toBeVisible();
    // Confirm: the row goes and the API forgets it.
    await row.getByRole("button", { name: "Delete Perf sceptic" }).click();
    await row.getByRole("button", { name: "Confirm delete the “Perf sceptic” persona" }).click();
    await expect(row).toHaveCount(0);
    expect((await personas(svc)).map((p) => p.id)).toEqual(["second-opinion"]);
  });
});
