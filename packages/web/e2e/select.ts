/**
 * Shared Base UI Select driver (#225): the shared Select is Base UI's —
 * the trigger (found by accessible label) shows the picked label, and
 * picking means opening the popup and clicking the option.
 *
 * A closed popup lingers mounted (zero-size, `data-closed`) until Base
 * UI unmounts it, so option lookups scope to the open popup and trigger
 * labels match exactly (a group labelled "Repos" would otherwise match
 * "Repo").
 */
import type { Locator, Page } from "@playwright/test";
import { expect } from "./network-guard.js";

/** The currently open Select popup (closed ones linger mounted with `data-closed`). */
export function openPopup(page: Page): Locator {
  return page.locator('.ui-select-popup:not([data-closed])');
}

/** Open the Select trigger and click the option (name matches substring, case-insensitive). */
export async function pickOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  const target = openPopup(page).getByRole("option", { name: option });
  // Settle Floating UI first: scrolling the option into view repositions
  // the popup, and clicking mid-reposition can land outside the item
  // (popup closes with no selection). Wait until the option's box stops
  // moving instead of sleeping a fixed delay (#363 B2).
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
  await target.click();
}

/** The trigger shows the picked label (not an input value). */
export async function expectTriggerText(page: Page, label: string, text: string | RegExp): Promise<void> {
  await expect(page.getByLabel(label, { exact: true })).toContainText(text);
}
