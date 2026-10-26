/**
 * Progress signs (issues #98, #144) against mock mode: the review bar
 * shows a running / queued job count while jobs are live and hides it
 * when idle, linking to the Debug jobs list; while anything runs a
 * highlight travels around the pill's border with the inside calm. The
 * working dots run a visible sequential pulse in full motion; under
 * reduced motion nothing animates at all (#191) — the dots and pill
 * simply appear, still. The depth stepper never animates in either
 * mode.
 *
 * The mock demo seeds 1 running + 1 queued + 1 backing-off job, so the
 * count reads "1 running, 2 queued" on load.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./network-guard.js";

async function gotoDemo(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
}

/** Computed `animation-name` + `animation-duration` of the first working dot. */
async function dotsAnimation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("#C-g-flow .dots i");
    if (!el) return "missing";
    const cs = getComputedStyle(el);
    return `${cs.animationName} ${cs.animationDuration}`;
  });
}

/** Computed `animation-name` + `animation-duration` of the live pill's travelling border. */
async function pillBorderAnimation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("#reviewbar .jcount.live");
    if (!el) return "missing";
    const cs = getComputedStyle(el, "::before");
    return `${cs.animationName} ${cs.animationDuration}`;
  });
}

/** Computed `animation-name`s inside the depth stepper (must stay still). */
async function depthAnimation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll(".depth, .depth button, .pips i")];
    if (els.length === 0) return "missing";
    return els.map((el) => getComputedStyle(el).animationName).join(",");
  });
}

/**
 * Sample the computed `transform` of the first working dot five times.
 * Under reduced motion nothing may move: every sample is `none`.
 * Returns "missing" when the dots filled mid-sample (caller retries).
 */
async function dotsTransforms(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const out: string[] = [];
        const tick = (): void => {
          const el = document.querySelector("#C-g-flow .dots i");
          if (!el) {
            resolve("missing");
            return;
          }
          out.push(getComputedStyle(el).transform);
          if (out.length >= 5) resolve(out.join(" / "));
          else window.setTimeout(tick, 120);
        };
        tick();
      }),
  );
}

/** Six bounding boxes over ~1.8s (a full border-travel cycle): all identical. */
async function pillBoxes(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const out: string[] = [];
        const snap = (): void => {
          const pill = document.querySelector("#reviewbar .jcount.live");
          const submit = document.querySelector("#reviewbar #submitSlot [data-submit]");
          const box = (el: Element | null): string => {
            if (!el) return "missing";
            const r = el.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map((n) => n.toFixed(1)).join(",");
          };
          out.push(`pill=${box(pill)} submit=${box(submit)}`);
          if (out.length >= 6) resolve(out);
          else window.setTimeout(snap, 300);
        };
        snap();
      }),
  );
}

test("review bar shows the job count and links to the Debug jobs list", async ({ page }) => {
  await gotoDemo(page);
  const bar = page.locator("#reviewbar");
  const count = bar.getByRole("link", { name: "1 running, 2 queued" });
  await expect(count).toBeVisible();
  await expect(count).toContainText("1 · 2");
  await expect(count).toHaveAttribute("href", "/review/demo/debug");
  await count.click();
  await expect(page).toHaveURL("/review/demo/debug");
});

test("the count disappears once no job is live", async ({ page }) => {
  await gotoDemo(page);
  const bar = page.locator("#reviewbar");
  await expect(bar.getByRole("link", { name: "1 running, 2 queued" })).toBeVisible();
  // Cancel every live job from the Debug jobs list.
  await bar.getByRole("link", { name: "Debug", exact: true }).click();
  for (const id of ["job-job-explain-1", "job-job-hunk-1", "job-job-critic-1"]) {
    await page.locator(`[data-testid="${id}"]`).getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(`[data-testid="${id}"]`)).toContainText("cancelled");
  }
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "urllib3/urllib3#5020" })
    .click();
  await expect(page).toHaveURL("/review/demo");
  await expect(bar.getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
});

test("the count fits the 800px layout without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoDemo(page);
  await expect(page.locator("#reviewbar").getByRole("link", { name: "1 running, 2 queued" }))
    .toBeVisible();
  const overflow = await page
    .locator("#reviewbar")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("working dots pulse while the agent works", async ({ page }) => {
  await gotoDemo(page);
  // The follow-up chip shows dots on click, before the mock fill lands.
  await page.locator("#C-g-flow .follow button").first().click();
  await expect.poll(() => dotsAnimation(page), { timeout: 8000 }).toBe("dot-pulse 1s");
  // The work still completes normally afterwards.
  await expect(page.locator('#C-g-flow section.ithread[data-thread]:has([data-reply][data-kind="ask"])').first()).toContainText("Mock explanation", {
    timeout: 8000,
  });
});

test("the live pill travels its border without moving or resizing", async ({ page }) => {
  await gotoDemo(page);
  const pill = page.locator("#reviewbar .jcount.live");
  await expect(pill).toBeVisible();
  await expect.poll(() => pillBorderAnimation(page), { timeout: 8000 }).toBe("jcount-spin 1.6s");
  // Same box on every sample (and the Submit neighbour too): the
  // animation never moves, resizes or shifts its neighbours.
  const boxes = await pillBoxes(page);
  expect(new Set(boxes).size).toBe(1);
});

test("nothing inside the depth stepper animates", async ({ page }) => {
  await gotoDemo(page);
  await expect(page.locator(".depth").first()).toBeVisible();
  for (const name of (await depthAnimation(page)).split(",")) {
    expect(name).toBe("none");
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("dots and pill appear with no animation and nothing moves", async ({ page }) => {
    await gotoDemo(page);
    const bar = page.locator("#reviewbar");
    const count = bar.getByRole("link", { name: "1 running, 2 queued" });
    await expect(count).toBeVisible();
    // Still, not fading: the pill and its border carry no animation.
    await expect(count).toHaveCSS("animation-name", "none");
    await expect.poll(() => pillBorderAnimation(page), { timeout: 8000 }).toBe("none 0s");
    await page.locator("#C-g-flow .follow button").first().click();
    await expect.poll(() => dotsAnimation(page), { timeout: 8000 }).toBe("none 0s");
    // And nothing moves.
    await expect.poll(() => dotsTransforms(page), { timeout: 8000 }).toBe("none / none / none / none / none");
  });

  test("nothing inside the depth stepper animates", async ({ page }) => {
    await gotoDemo(page);
    await expect(page.locator(".depth").first()).toBeVisible();
    for (const name of (await depthAnimation(page)).split(",")) {
      expect(name).toBe("none");
    }
  });
});
