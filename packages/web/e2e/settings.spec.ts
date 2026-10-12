/**
 * Settings page + versions banner behaviour tests against mock mode
 * (PRD §4.14, §8): model pickers with adapter errors and the
 * same-model warning, prompt template/expanded views, limits persistence,
 * Tips popover, and the stale-review banner with range-diff + version
 * switching. (Jobs and shared context live on the per-review debug page
 * now: `debug.spec.ts`.)
 */
import { expect, test } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings?review=demo");
  await expect(page.getByText("Models, prompts, limits")).toBeVisible();
});

test("model pickers list provider models and warn on same-model second opinion", async ({ page }) => {
  const main = page.locator('[data-testid="model-main"]');
  await expect(main.locator("select").nth(1)).toHaveValue("mock-main");

  // Unknown provider (stored before the adapter went away): a clear
  // message, not an empty list.
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.settings",
      JSON.stringify({ main: { provider: "custom", model: "custom-1" } }),
    );
  });
  await page.goto("/settings?review=demo");
  await expect(page.locator('[data-testid="model-main"]').getByText(/adapter not installed or not logged in/)).toBeVisible();

  // Second opinion on the same model as main warns (PRD §4.10).
  const second = page.locator('[data-testid="model-secondOpinion"]');
  await second.locator("select").first().selectOption("claude");
  await expect(second.locator("select").nth(1)).toBeVisible();
  await second.locator("select").nth(1).selectOption("mock-main");
  await expect(page.getByText(/same model as main/)).toBeVisible();
});

test("prompts show template variables and layered expansions", async ({ page }) => {
  const card = page.locator('[data-testid="prompt-reader"]');
  await card.getByRole("button", { name: "Expand reader" }).click();
  // Template view: {{variables}} marked.
  await expect(card.getByText("role: user · tier: main", { exact: false })).toBeVisible();
  await expect(card.locator("mark.tm").first()).toContainText("{{source}}");
  // Expanded view: layers collapsed by default, cached part set apart.
  await card.getByRole("button", { name: "Expanded for this review" }).click();
  await expect(card.getByText(/total · .* cached/)).toBeVisible();
  const l1 = card.locator('details.lay[data-layer="L1"]');
  await expect(l1).toBeVisible();
  await expect(l1).toContainText("cached");
  await l1.locator("summary").click();
  await expect(l1).toContainText("PR #5020");
});

test("limits persist across reload", async ({ page }) => {
  const input = page.locator("#limit-sessionsPerProvider");
  await input.fill("6");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Models, prompts, limits")).toBeVisible();
  await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("6");
});

test("limits show service validation errors inline", async ({ page }) => {
  // Mock accepts anything, so drive the inline-error path through the
  // real-service spec; here just assert the field + hint render.
  await expect(page.locator("#limit-inlineBudgetTokens")).toBeVisible();
  await expect(page.getByText("L1 budget, ~40k default.")).toBeVisible();
});

test("tips popover opens from the review top bar", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("button", { name: "Usage tips" }).click();
  await expect(page.getByRole("dialog", { name: "Usage tips" })).toContainText("Select text to Explain it");
  await expect(page.getByRole("dialog", { name: "Usage tips" })).toContainText("Settings");
});

test("settings links carry the review context", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?review=demo/);
  await expect(page.getByRole("link", { name: "Back to review" })).toHaveAttribute("href", "/review/demo");
});

test("stale review shows banner counts, range-diff and stale hunks", async ({ page }) => {
  await page.goto("/review/r-old");
  const banner = page.locator('[data-testid="stale-banner"]');
  await expect(banner).toContainText("New commits on this branch · v1 → v2 (1 changed · 2 new · 0 removed hunks)");
  await banner.getByText("range-diff").click();
  await expect(page.locator('[data-testid="range-diff"]')).toContainText("add socket-level test");
  // Reviewed flag cleared only on the changed hunk.
  await expect(page.getByText("changed since reviewed")).toBeVisible();
});

test("version switcher views the older version read-only", async ({ page }) => {
  await page.goto("/review/r-old");
  await expect(page.locator('[data-testid="version-switcher"]')).toBeVisible();
  await page.locator("#version-pick").selectOption("1");
  await expect(page).toHaveURL(/version=1/);
  await expect(page.locator('[data-testid="version-switcher"]').getByText("Viewing v1 · read-only")).toBeVisible();
  await expect(page.getByText("Viewing v1 · read-only", { exact: false }).first()).toBeVisible();
  await expect(page.locator('[data-testid="stale-banner"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Back to current" }).click();
  await expect(page).not.toHaveURL(/version=1/);
  await expect(page.locator('[data-testid="stale-banner"]')).toBeVisible();
});
