/**
 * Per-review debug page (issue #32, tabs + collapsible blocks issue #60)
 * against mock mode: reachable from the review top bar; Jobs / Prompts /
 * Shared context tabs with the selected tab in `?tab=`; jobs with prompt
 * links + cancel; prompts with expandable templates and layers; base + log
 * + contributions as collapsible blocks with delete; and the page links
 * back to the review.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./network-guard.js";

async function gotoSharedContext(page: Page): Promise<void> {
  await page.goto("/review/demo/debug");
  await page.getByRole("tab", { name: "Shared context" }).click();
}

test("top bar links to the debug page, which defaults to the Jobs tab", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("link", { name: "Debug", exact: true }).click();
  await expect(page).toHaveURL("/review/demo/debug");
  await expect(page.getByRole("heading", { name: "Jobs, prompts and shared context" })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Debug sections" });
  await expect(tabs.getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "Prompts" })).toHaveAttribute("aria-selected", "false");
  await expect(tabs.getByRole("tab", { name: "Shared context" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  // One panel visible at a time; the rest stay mounted but hidden.
  await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Prompts" })).toBeHidden();
  await expect(page.getByRole("tabpanel", { name: "Shared context" })).toBeHidden();
});

test("switching tabs shows one panel and replaces the history entry", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("link", { name: "Debug", exact: true }).click();
  await page.getByRole("tab", { name: "Shared context" }).click();
  await expect(page).toHaveURL("/review/demo/debug?tab=context");
  await expect(page.getByRole("tabpanel", { name: "Shared context" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeHidden();
  await page.getByRole("tab", { name: "Prompts" }).click();
  await expect(page).toHaveURL("/review/demo/debug?tab=prompts");
  // Replaced, not pushed: Back leaves the page instead of stepping tabs.
  await page.goBack();
  await expect(page).toHaveURL("/review/demo");
});

test("?tab= deep link survives reload; other query parameters are kept", async ({ page }) => {
  await page.goto("/review/demo/debug?tab=prompts&extra=1");
  await expect(page.getByRole("tab", { name: "Prompts" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Prompts" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Prompts" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Shared context" }).click();
  await expect(page).toHaveURL(/tab=context/);
  await expect(page).toHaveURL(/extra=1/);
});

test("unknown ?tab= falls back to Jobs", async ({ page }) => {
  await page.goto("/review/demo/debug?tab=bogus");
  await expect(page.getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeVisible();
});

test("shared context blocks collapse and expand; Base starts open", async ({ page }) => {
  await gotoSharedContext(page);
  const base = page.locator('section[aria-label="Base"]');
  const log = page.locator('section[aria-label="Log"]');
  const contribs = page.locator('section[aria-label="Contributions"]');
  // Base starts open; Log and Contributions start closed.
  await expect(base.locator("details")).toHaveAttribute("open", "");
  await expect(log.locator("details")).not.toHaveAttribute("open", "");
  await expect(contribs.locator("details")).not.toHaveAttribute("open", "");
  await expect(base).toContainText("v1|guide-mock|mock|mock-main");

  await base.locator("summary").click();
  await expect(base.locator("details")).not.toHaveAttribute("open", "");
  await base.locator("summary").click();
  await expect(base.locator("details")).toHaveAttribute("open", "");

  await log.locator("summary").click();
  await expect(log).toContainText("[1 new-card global]");
  await expect(log).toContainText("waiting for batch");

  await contribs.locator("summary").click();
  await expect(contribs).toContainText("ct-seed-1");
  await expect(contribs).toContainText("fact");
  await expect(contribs).toContainText("ct-seed-2");
  await expect(contribs).toContainText("correction");
  await expect(contribs).toContainText("diff:src-urllib3-connection.py:640-660");

  // Long blocks keep their collapse control reachable: summaries stick.
  await expect(base.locator("summary")).toHaveCSS("position", "sticky");
});

test("expand all / collapse all on the Shared context tab", async ({ page }) => {
  await gotoSharedContext(page);
  const panel = page.getByRole("tabpanel", { name: "Shared context" });
  await panel.getByRole("button", { name: "Expand all" }).click();
  for (const label of ["Base", "Log", "Contributions"]) {
    await expect(page.locator(`section[aria-label="${label}"] details`)).toHaveAttribute("open", "");
  }
  await panel.getByRole("button", { name: "Collapse all" }).click();
  for (const label of ["Base", "Log", "Contributions"]) {
    await expect(page.locator(`section[aria-label="${label}"] details`)).not.toHaveAttribute(
      "open",
      "",
    );
  }
});

test("open blocks survive a tab switch", async ({ page }) => {
  await gotoSharedContext(page);
  const log = page.locator('section[aria-label="Log"]');
  await log.locator("summary").click();
  await expect(log.locator("details")).toHaveAttribute("open", "");
  await page.getByRole("tab", { name: "Jobs" }).click();
  await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeVisible();
  await page.getByRole("tab", { name: "Shared context" }).click();
  await expect(log.locator("details")).toHaveAttribute("open", "");
  await expect(log).toContainText("[1 new-card global]");
});

test("jobs show state, tokens, cache rate, prompt link and cancel", async ({ page }) => {
  await page.goto("/review/demo/debug");
  const running = page.locator('[data-testid="job-job-explain-1"]');
  await expect(running).toContainText("explain");
  await expect(running).toContainText("running");
  await expect(running).toContainText("42.5k in");
  await expect(running).toContainText("91.5% cached");

  const backing = page.locator('[data-testid="job-job-critic-1"]');
  await expect(backing).toContainText(/backing-off · retry in/);

  await running.getByRole("button", { name: "Prompt" }).click();
  await expect(running).toContainText("Explain the quoted text");

  const queued = page.locator('[data-testid="job-job-hunk-1"]');
  await queued.getByRole("button", { name: "Cancel" }).click();
  await expect(queued).toContainText("cancelled");

  await expect(page.locator('[data-testid="jobs-totals"]')).toContainText("Totals:");
});

test("prompts show the expanded text for this review", async ({ page }) => {
  await page.goto("/review/demo/debug?tab=prompts");
  const card = page.locator('section[aria-label="Prompts"]').locator('[data-testid="prompt-reader"]');
  await card.getByRole("button", { name: "Expand reader" }).click();
  // Expanded view: layers collapsed by default, cached part set apart.
  await expect(card.getByText(/total · .* cached/)).toBeVisible();
  const l1 = card.locator('details.lay[data-layer="L1"]');
  await expect(l1).toBeVisible();
  await expect(l1).toContainText("cached");
  await l1.locator("summary").click();
  await expect(l1).toContainText("PR #5020");
});

test("prompts expand all opens every template; collapse all closes them", async ({ page }) => {
  await page.goto("/review/demo/debug?tab=prompts");
  const panel = page.getByRole("tabpanel", { name: "Prompts" });
  await panel.getByRole("button", { name: "Expand all" }).click();
  await expect(panel.locator('[data-testid="prompt-reader"]')).toContainText("PR #5020");
  await panel.getByRole("button", { name: "Collapse all" }).click();
  await expect(panel.locator('[data-testid="prompt-reader"]')).not.toContainText("PR #5020");
});

test("delete on the debug page removes the contribution without collapsing open blocks", async ({
  page,
}) => {
  await gotoSharedContext(page);
  const contribs = page.locator('section[aria-label="Contributions"]');
  const log = page.locator('section[aria-label="Log"]');
  await contribs.locator("summary").click();
  await log.locator("summary").click();
  await expect(contribs).toContainText("ct-seed-2");
  await page.getByRole("button", { name: "Delete ct-seed-2" }).click();
  await expect(page.locator('[data-testid="debug-delete-ct-seed-2"]')).toHaveCount(0);
  await expect(contribs).not.toContainText("ct-seed-2");
  await expect(contribs).toContainText("ct-seed-1");
  // The refetch leaves the other open blocks alone.
  await expect(contribs.locator("details")).toHaveAttribute("open", "");
  await expect(log.locator("details")).toHaveAttribute("open", "");
});

test("debug page links back to the review", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await page.getByRole("link", { name: "Back to review" }).click();
  await expect(page).toHaveURL("/review/demo");
});
