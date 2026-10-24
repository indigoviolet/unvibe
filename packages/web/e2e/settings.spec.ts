/**
 * Settings page + versions banner behaviour tests against mock mode
 * (PRD §4.14, §8): repositories (list + add by path, add by URL with busy
 * and error states, managed marks, remove with confirm copy and the 409
 * refusal), model pickers with adapter errors and the same-model warning,
 * prompt template view, limits persistence, and the
 * stale-review banner with range-diff + version switching. (Jobs, prompt
 * expansions and shared context live on the per-review debug page now:
 * `debug.spec.ts`.)
 *
 * (Data reset, path-checkout remove, the stale banner, the version
 * switcher and the access toggle now live in J5/J11/J12 against the
 * real service — #258.)
 */
import { expect, test } from "./network-guard.js";
import { openPopup } from "./select.js";

async function gotoSettings(page: import("@playwright/test").Page, url = "/settings"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
}

test("settings default to the Repos tab; tabs switch panels", async ({ page }) => {
  await gotoSettings(page);
  const tabs = page.getByRole("tablist", { name: "Settings sections" });
  await expect(tabs.getByRole("tab", { name: "Repos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: "Repos" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Models" })).toBeHidden();
  await tabs.getByRole("tab", { name: "Models" }).click();
  await expect(page).toHaveURL("/settings?tab=models");
  await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Repos" })).toBeHidden();
});

test("?tab= deep link survives reload", async ({ page }) => {
  await page.goto("/settings?tab=limits");
  await page.getByRole("tab", { name: "Limits" }).click();
  await expect(page.getByRole("tabpanel", { name: "Limits" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Limits" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#limit-sessionsPerProvider")).toBeVisible();
});

test("unsaved edits survive a tab switch", async ({ page }) => {
  await gotoSettings(page);
  await page.getByRole("tab", { name: "Limits" }).click();
  await page.locator("#limit-sessionsPerProvider").fill("9");
  await page.getByRole("tab", { name: "Models" }).click();
  await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible();
  await page.getByRole("tab", { name: "Limits" }).click();
  await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("9");
});

test("repositories section lists remembered repos and adds by path", async ({ page }) => {
  await gotoSettings(page);
  const section = page.locator('[data-testid="repositories-section"]');
  await expect(section).toBeVisible();
  await expect(section.getByText("urllib3/urllib3")).toBeVisible();
  await expect(section.getByText("~/code/urllib3")).toBeVisible();

  // Adding with an empty field shows a hint instead of doing nothing.
  await section.getByRole("button", { name: "Add by path" }).click();
  await expect(section.getByText("Enter a folder path first.")).toBeVisible();

  await section.getByLabel("Add a repo by path").fill("/tmp/fake-checkout");
  await section.getByRole("button", { name: "Add by path" }).click();
  const added = section.locator('[data-testid="repo-local-fake-checkout"]');
  await expect(added).toContainText("local/fake-checkout");
  await expect(added).toContainText("/tmp/fake-checkout");
});

test("repositories section is reachable at ?tab=repositories", async ({ page }) => {
  await page.goto("/settings?tab=repositories");
  await expect(page.locator('[data-testid="repositories-section"]')).toBeVisible();
});

test("older #section links land on the matching tab", async ({ page }) => {
  await page.goto("/settings#repositories");
  await expect(page.getByRole("tab", { name: "Repos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goto("/settings#environment");
  await expect(page.getByRole("tab", { name: "Environment" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-testid="env-git"]')).toBeVisible();
});

test("repositories add by URL clones with a busy state and marks the clone", async ({ page }) => {
  await gotoSettings(page);
  const section = page.locator('[data-testid="repositories-section"]');
  await section.getByLabel("Add a repo by URL").fill("https://github.com/acme/app");
  await section.getByRole("button", { name: "Clone and add" }).click();
  const added = section.locator('[data-testid="repo-managed-acme-app"]');
  await expect(added).toContainText("acme/app");
  await expect(added).toContainText("Cloned by Unvibe");
  await expect(added).toContainText("/mock/data/repos/acme/app");
});

test("repositories add by URL shows the clone busy state and disables the control", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.addRepoHold", "1");
  });
  await page.goto("/settings");
  const section = page.locator('[data-testid="repositories-section"]');
  await expect(section).toBeVisible();
  await section.getByLabel("Add a repo by URL").fill("acme/app");
  await section.getByRole("button", { name: "Clone and add" }).click();
  // While the synchronous clone runs: named busy state, control disabled,
  // and no second add can fire.
  const busy = section.getByRole("button", { name: /Cloning acme\/app/ });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(section.getByLabel("Add a repo by URL")).toBeDisabled();
  await expect(section.locator('[data-testid="repo-managed-acme-app"]')).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.addRepoHold"));
  await expect(section.locator('[data-testid="repo-managed-acme-app"]')).toContainText("Cloned by Unvibe");
});

test("repositories add by URL rejects invalid input inline without a request", async ({ page }) => {
  await gotoSettings(page);
  const section = page.locator('[data-testid="repositories-section"]');
  await section.getByLabel("Add a repo by URL").fill("not a repo!!!");
  await section.getByRole("button", { name: "Clone and add" }).click();
  await expect(section.getByText(/not a GitHub repo URL or owner\/name/)).toBeVisible();
  // No request fired: no toast, no row, control still usable.
  await expect(page.locator("#toast")).toBeHidden();
  await expect(section.getByRole("button", { name: "Clone and add" })).toBeEnabled();
});

test("repositories add by URL surfaces the service error", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.addRepoFail", "repository not found: acme/app (check the spelling)");
  });
  await page.goto("/settings");
  const section = page.locator('[data-testid="repositories-section"]');
  await expect(section).toBeVisible();
  await section.getByLabel("Add a repo by URL").fill("acme/app");
  await section.getByRole("button", { name: "Clone and add" }).click();
  // The service message stays inline under the row where it can be read
  // and acted on — not just a transient toast.
  await expect(section.getByRole("alert")).toContainText("repository not found: acme/app");
  await expect(section.locator('[data-testid="repo-managed-acme-app"]')).toHaveCount(0);
  // Typing clears it; the control stays usable.
  await section.getByLabel("Add a repo by URL").fill("acme/other");
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("repositories remove deletes a managed clone with clear confirm copy", async ({ page }) => {
  await gotoSettings(page);
  const section = page.locator('[data-testid="repositories-section"]');
  await section.getByLabel("Add a repo by URL").fill("acme/app");
  await section.getByRole("button", { name: "Clone and add" }).click();
  const row = section.locator('[data-testid="repo-managed-acme-app"]');
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove acme/app" }).click();
  await expect(row).toContainText("Delete the clone at /mock/data/repos/acme/app from this machine?");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("repositories remove is refused while reviews exist", async ({ page }) => {
  await gotoSettings(page);
  // The seed urllib3 repo has mock sessions: removing it 409s as is.
  const section = page.locator('[data-testid="repositories-section"]');
  const row = section.locator('[data-testid="repo-urllib3"]');
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove urllib3/urllib3" }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  // The refusal stays inline on the row, with Cancel working.
  await expect(row.getByRole("alert")).toContainText("still has 2 reviews");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("model pickers list provider models and warn on same-model second opinion", async ({ page }) => {
  await gotoSettings(page);
  await page.getByRole("tab", { name: "Models" }).click();
  const main = page.locator('[data-testid="model-main"]');
  await expect(main.locator("#model-main")).toContainText("mock-main");

  // Second opinion on the same model as main warns (PRD §4.10). This runs
  // before the unknown-provider override below replaces main, so the
  // default main (claude/mock-main) is still there to match against.
  const second = page.locator('[data-testid="model-secondOpinion"]');
  await second.locator("#prov-secondOpinion").click();
  await openPopup(page).getByRole("option", { name: "claude", exact: true }).click();
  // Switching provider only browses that provider's list (#87): nothing is
  // saved yet, so the model trigger waits on the placeholder pick.
  const secondModel = second.locator("#model-secondOpinion");
  await expect(secondModel).toContainText("Pick a claude model…");
  await secondModel.click();
  await openPopup(page).getByRole("option", { name: "mock-main" }).click();
  await expect(page.getByText(/same model as main/)).toBeVisible();

  // Unknown provider (stored before the adapter went away): a clear
  // message, not an empty list.
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.settings",
      JSON.stringify({ main: { provider: "custom", model: "custom-1", effort: "" } }),
    );
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Models" }).click();
  await expect(page.locator('[data-testid="model-main"]').getByText(/couldn't list custom models/)).toBeVisible();
});

test("prompts show template variables (expanded text lives on the debug page)", async ({ page }) => {
  await gotoSettings(page);
  await page.getByRole("tab", { name: "Prompts" }).click();
  const card = page.locator('[data-testid="prompt-reader"]');
  await card.getByRole("button", { name: "Expand reader" }).click();
  // Template view: {{variables}} marked.
  await expect(card.getByText("role: user · tier: main", { exact: false })).toBeVisible();
  await expect(card.locator("mark.tm").first()).toContainText("{{source}}");
  // No per-review expansion here any more.
  await expect(card.getByRole("button", { name: "Expanded for this review" })).toHaveCount(0);
});

// DISABLED(#119): mock-mode duplicate of the real-service persist test (here persist is the mock writing localStorage)
test.skip("limits persist across reload", async ({ page }) => {
  await gotoSettings(page);
  await page.getByRole("tab", { name: "Limits" }).click();
  const input = page.locator("#limit-sessionsPerProvider");
  await input.fill("6");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Limits" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("6");
});

// DISABLED(#119): body only renders the static hint; inline errors live in settings-versions-service.spec.ts
test.skip("limits show service validation errors inline", async ({ page }) => {
  await gotoSettings(page);
  await page.getByRole("tab", { name: "Limits" }).click();
  // Mock accepts anything, so drive the inline-error path through the
  // real-service spec; here just assert the field + hint render.
  await expect(page.locator("#limit-inlineBudgetTokens")).toBeVisible();
  await expect(page.getByText("Default 40,000.")).toBeVisible();
});

test("settings gear opens settings; the breadcrumb marks the page", async ({ page }) => {
  // Issue #141: Settings is reached from the start page only.
  await page.goto("/");
  await page
    .locator("header.top")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL("/settings");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByText("Settings")).toHaveAttribute("aria-current", "page");
  // The Settings screen itself has no Settings button.
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  // Browser back returns to the start page (Settings pushes a history entry).
  await page.goBack();
  await expect(page).toHaveURL("/");
});

test("settings gear sits only in the start top bar; the review bar has home and no gear", async ({
  page,
}) => {
  // Review page: one bar with a home control, no gear, no breadcrumb.
  await page.goto("/review/demo");
  await expect(page.locator("header.top")).toHaveCount(0);
  const bar = page.locator("#reviewbar");
  await expect(bar.getByRole("link", { name: "Back to the start page" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  // Start page top bar: brand, then the gear.
  await page.goto("/");
  const startGear = page.locator("header.top").getByRole("link", { name: "Settings", exact: true });
  await expect(startGear).toBeVisible();
  await expect(startGear).toHaveAttribute("title", "Settings");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
});
