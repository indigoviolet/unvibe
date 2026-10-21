/**
 * Shared Base UI Select driver (#225): the shared Select is Base UI's —
 * the trigger (found by accessible label or id) shows the picked label,
 * and picking means opening the popup and clicking the option.
 */
import type { Page } from "@playwright/test";
import { expect } from "./network-guard.js";

/** Open the Select trigger and click the option (name matches substring, case-insensitive). */
export async function pickOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}

/** The trigger shows the picked label (not an input value). */
export async function expectTriggerText(page: Page, label: string, text: string | RegExp): Promise<void> {
  await expect(page.getByLabel(label, { exact: true })).toContainText(text);
}
