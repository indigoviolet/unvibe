/**
 * Shared Playwright helper (issue #119): wait until a subtree stops
 * mutating instead of sleeping a fixed settle interval.
 */
import type { Page } from "@playwright/test";

/**
 * Resolve once `selector` sees no DOM mutations for `quietMs` (default
 * 250 ms). For highlight/marking convergence: late token and mark passes
 * settle at different times on loaded machines, so a fixed sleep either
 * wastes time or fires too early.
 */
export async function waitForDomQuiet(page: Page, selector: string, quietMs = 250): Promise<void> {
  await page.evaluate(
    ({ selector, quietMs }: { selector: string; quietMs: number }) =>
      new Promise<void>((resolve) => {
        const root = document.querySelector(selector);
        if (!root) {
          resolve();
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const obs = new MutationObserver(() => {
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(() => {
            obs.disconnect();
            resolve();
          }, quietMs);
        });
        obs.observe(root, { childList: true, subtree: true, characterData: true });
        timer = setTimeout(() => {
          obs.disconnect();
          resolve();
        }, quietMs);
      }),
    { selector, quietMs },
  );
}
