/**
 * Anchored expansions vs highlight upgrade (issue #101, mock mode).
 *
 * Reported scenario: a review with expansions anchored on the diff,
 * reloaded while highlighting upgrades the rows — the anchor marks met
 * React-owned diff text nodes and the commit threw `removeChild`
 * NotFoundError, blanking the page. Achieved deterministically on one
 * load: the Shiki grammar requests are held until the expansion's quote
 * is marked, then released so the token upgrade lands onto marked cells
 * (on reload the same order arises from staggered completions + patches).
 * The spec fails on any page error and on a white page.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

// The app's service worker serves the Shiki chunks from its cache, which
// bypasses request routing; block it here so the upgrade can be held back
// deterministically (highlighting itself needs no worker).
test.use({ serviceWorkers: "block" });

const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;
const tsockFile = `[id="F-${TSOCK}"]`;

async function gotoReview(page: Page): Promise<void> {
  // Held Shiki requests never settle, so `load` never fires: commit on
  // DOM parse and wait for the content explicitly instead.
  await page.goto("/review/demo", { waitUntil: "domcontentloaded" });
  await expect(page.locator(connFile)).toBeVisible();
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

async function selectInDiff(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (file) => {
      document.querySelector(file)?.scrollIntoView({ block: "center" });
    },
    connFile,
  );
  await page.waitForTimeout(350);
  await page.evaluate(
    ({ connFile, text }) => {
      const root = document.querySelector(connFile);
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        const at = data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
      return false;
    },
    { connFile, text },
  );
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 3000 });
}

test("highlight upgrade onto marked diff cells shows no page error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  // Hold the Shiki library fetches (not the app's own `shiki.ts`
  // module, which the initial graph needs): the upgrade cannot land
  // until released.
  const held: (() => void)[] = [];
  let hold = true;
  await page.route("**/.vite/deps/shiki*", async (route) => {
    if (!hold) {
      await route.continue();
      return;
    }
    await new Promise<void>((release) => held.push(release));
    await route.continue();
  });

  await gotoReview(page);

  // Anchor an explanation on diff text; its quote is marked while the
  // upgrade is still held back.
  await selectInDiff(page, "_normalize_header_value");
  await page.locator('#selbar button[data-act="explain"]').click();
  await expect(page.locator('#right mark.anc[data-jump]').first()).toBeVisible({ timeout: 10000 });

  // Let the token upgrade land onto the marked cells. The unmarked
  // socketlevel file proves the upgrade landed even when the marked file
  // fails to render it.
  hold = false;
  for (const release of held.splice(0)) release();
  await expect(page.locator(`${tsockFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
  // Late marking passes + patch convergence run to completion.
  await page.waitForTimeout(1500);

  expect(errors.filter((e) => /removeChild|NotFoundError/.test(e))).toEqual([]);
  expect(errors).toEqual([]);
  // The page is not white and no file fell back: guide and diff render.
  await expect(page.locator("#page .doc h1.title")).toBeVisible();
  await expect(page.locator(connFile)).toBeVisible();
  await expect(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible();
  await expect(page.getByText("Couldn't show this file: something went wrong")).toHaveCount(0);
});
