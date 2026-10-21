/**
 * Start page filtered-lists block (#148) in mock mode: the PR and branch
 * lists governed by the recency filter sit in one delineated block with
 * the filter and a refresh icon in its heading row. Reviews stays outside
 * the block; the fetch time rides the icon's tooltip.
 */
import { test, expect } from "./network-guard.js";
import { pickOption, expectTriggerText } from "./select.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByText("Your PRs")).toBeVisible();
});

test("PR and branch lists form one block with the filter and refresh in its heading row", async ({
  page,
}) => {
  const block = page.getByTestId("pr-block");
  await expect(block).toBeVisible();
  await expect(block.getByRole("heading", { name: "PRs and branches" })).toBeVisible();
  // The recency control lives in the block's heading row, compact: the
  // window alone with an accessible label, not a sentence beside it.
  await expect(block.getByLabel("Updated within", { exact: true })).toBeVisible();
  await expect(block.getByText("Updated within", { exact: true })).toHaveCount(0);
  // Reviews stays outside the block.
  await expect(block.getByRole("heading", { name: "Reviews" })).toHaveCount(0);
  // The refresh icon carries the fetch time and re-fetches on click.
  const refresh = block.getByTestId("lists-refresh");
  await expect(refresh).toHaveAttribute("title", /^Updated /);
  await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
  await refresh.click();
  await expect(refresh).toHaveAttribute("title", /refreshing/);
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(refresh).toHaveAttribute("title", /^Updated /);
});

test("the recency filter empties lists inside the block with a way back", async ({ page }) => {
  const block = page.getByTestId("pr-block");
  await pickOption(page, "Updated within", "Last day");
  // The filtered-out team asks name their window inside the block.
  await expect(block.getByTestId("requested-team-empty")).toContainText("No PRs updated in the last day.");
  await block.getByTestId("requested-team-empty").getByRole("button", { name: "Show all" }).click();
  await expectTriggerText(page, "Updated within", "All");
  await expect(page.getByText("CI: pin the lint action")).toBeVisible();
});
