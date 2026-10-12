/**
 * Dedicated network-privacy walk (PRD §16): front screen, a review with
 * guide + diff + a D2 diagram, and settings — asserting zero
 * non-local requests and zero CSP violations throughout.
 *
 * The shared `./network-guard` fixture already fails every spec on any
 * non-local request or CSP violation; this spec walks the heaviest screens
 * (self-hosted fonts, inlined D2 SVG with its `<style>` blocks + inline
 * styles and embedded `data:` fonts, API + WS over loopback) and asserts
 * the collected guard state explicitly.
 */
import { test, expect } from "./network-guard.js";

test("main screens make no non-local requests and raise no CSP violations", async ({
  page,
  guard,
}) => {
  // Front screen: repo-scoped reviews + demo row (fonts load here).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.locator('[data-testid^="session-"]').first()).toBeVisible();

  // Review with guide + diff + D2 diagram (service-rendered SVG inlined
  // with its styles; fonts embedded as data:).
  await page.goto("/review/demo");
  await expect(page.locator("#C-g-flow #B-b1 .dg-svg > svg")).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[id^="F-"]').first()).toBeVisible();

  // Settings: models + environment (readiness fetch over loopback).
  await page.goto("/settings?review=demo");
  await expect(page.getByText("Repositories, models, prompts, limits, jobs, shared context")).toBeVisible();
  await expect(page.locator("#environment")).toBeVisible();

  expect(guard.nonLocal, `non-local requests: ${guard.nonLocal.join("; ")}`).toEqual([]);
  expect(guard.csp, `CSP violations: ${guard.csp.join("; ")}`).toEqual([]);
});
