/**
 * Opt-in CPU throttling for reproducing CI-only timing races locally
 * (issue #195): the GitHub runner is ~4x slower than a dev machine, so
 * races that need a slow browser hide locally. Set
 * `UNVIBE_E2E_CPU_THROTTLE=4` (or higher) to throttle every test page
 * through CDP; unset, this is a no-op. Wire it in with one line:
 *
 *   test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
 */
import type { Page } from "@playwright/test";

export async function cpuThrottleFromEnv(page: Page): Promise<void> {
  const rate = Number(process.env.UNVIBE_E2E_CPU_THROTTLE);
  if (!rate || rate <= 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
}
