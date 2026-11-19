/**
 * L16 — Experimental settings gates (#422).
 *
 * Both flags default off. Off: the card's Help-me-understand button is a
 * plain Simplify press (one click runs Simplify, no menu); the top-bar
 * Documents link hides, /documents shows the notice instead of the
 * document form and list, doc creation refuses with 403, and direct
 * document-review URLs show the notice — while the #322 panel web group
 * stays visible and the panel ask API keeps working. On: the #418 menu
 * and the document flow work. A UI toggle takes effect without a reload
 * (no `page.reload()` or fresh `goto` between the toggle and the
 * assertion — only history back / client-side link navigation).
 *
 * Boots: ONE replay service over a seeded demo review (Explain flow) and
 * ONE agent:none service over a scratch repo (Markdown-docs flow).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createSeededDemoReview, makeScratchRepo } from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Slower jobs on a review (l8 pattern): the plain press creates one. */
async function slowerJobs(svc: RunningService, reviewId: string): Promise<string[]> {
  const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
  return ((res.json as { jobs: { id: string; kind: string }[] }).jobs ?? [])
    .filter((j) => j.kind === "slower")
    .map((j) => j.id);
}

async function gotoExperimental(page: Page, svc: RunningService): Promise<void> {
  await page.goto(`${svc.origin}/settings?tab=experimental&token=${svc.token}`);
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
}

test.describe("L16 Explain terms gate", () => {
  let dataDir = "";
  let reviewId = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l16-data-"));
    reviewId = createSeededDemoReview(dataDir, "l16-seed");
    svc = await startService(dataDir, { agent: "replay", label: "l16explain" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page): Promise<void> {
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("both gates default off", async () => {
    const s = service();
    const res = await apiJson(s, "GET", "/api/settings");
    expect(res.status).toBe(200);
    expect((res.json as { experimental: unknown }).experimental).toEqual({
      explainTerms: false,
      markdownDocs: false,
    });
  });

  test("off: Help me understand runs Simplify on one click, with no menu", async ({ page }) => {
    const s = service();
    await openReview(page);
    const card = page.locator("#C-central");
    const button = card.getByRole("button", { name: "Help me understand" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    // No menu affordance while the gate is off.
    await expect(button).not.toHaveAttribute("aria-haspopup", "menu");
    const before = await slowerJobs(s, reviewId);
    await button.click();
    // One click ran Simplify: a slower job appears, and no menu opened.
    await expect
      .poll(async () => (await slowerJobs(s, reviewId)).filter((id) => !before.includes(id)), { timeout: 60_000 })
      .toHaveLength(1);
    await expect(page.locator('[data-understand-menu-list="central"]')).toHaveCount(0);
  });

  test("on: the menu with both items; the UI toggle takes effect without a reload", async ({ page }) => {
    const s = service();
    await openReview(page);
    // Flip the gate through the Settings UI (not the API).
    await gotoExperimental(page, s);
    await page.getByRole("tab", { name: "Experimental" }).click();
    const toggle = page.getByTestId("experimental-explain-terms");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    // Back to the review over history (no reload, no fresh goto): the
    // remount picks up the flipped gate.
    await page.goBack();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const card = page.locator("#C-central");
    const button = card.getByRole("button", { name: "Help me understand" });
    await expect(button).toHaveAttribute("aria-haspopup", "menu", { timeout: 15_000 });
    await button.click();
    const menu = page.locator('[data-understand-menu-list="central"]');
    await expect(menu).toBeVisible({ timeout: 15_000 });
    await expect(menu.getByRole("menuitem", { name: "Simplify" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Explain terms…" })).toBeVisible();
    // Simplify still runs from the menu.
    const before = await slowerJobs(s, reviewId);
    await menu.getByRole("menuitem", { name: "Simplify" }).click();
    await expect
      .poll(async () => (await slowerJobs(s, reviewId)).filter((id) => !before.includes(id)), { timeout: 60_000 })
      .toHaveLength(1);
  });
});

test.describe("L16 Markdown docs gate", () => {
  let dataDir = "";
  let repoDir = "";
  let repoId = "";
  let svc: RunningService | null = null;
  let docReviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l16md-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l16md-repo-"));
    await makeScratchRepo(repoDir);
    svc = await startService(dataDir, { agent: "none", label: "l16md" });
    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
    repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repoDir,
    )!.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function setDocs(on: boolean): Promise<void> {
    const s = service();
    const res = await apiJson(s, "PUT", "/api/settings", {
      experimental: { explainTerms: false, markdownDocs: on },
    });
    expect(res.status).toBe(200);
  }

  test("off: no entry points, but the panel web group stays", async ({ page }) => {
    const s = service();
    await setDocs(false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${s.origin}/?token=${s.token}`);
    // No top-bar Documents link…
    await expect(page.getByRole("link", { name: "Unvibe" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Documents" })).toHaveCount(0);
    // …and the start page holds no document entry.
    await expect(page.getByRole("button", { name: "New document review" })).toHaveCount(0);
    await expect(page.getByTestId("document-form")).toHaveCount(0);
    // /documents by URL shows the notice instead of the document flow.
    await page.goto(`${s.origin}/documents?token=${s.token}`);
    await expect(page.getByTestId("documents-experimental-notice")).toContainText(
      "Markdown docs is an experimental feature",
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: "New document review" })).toHaveCount(0);
    await expect(page.getByTestId("document-form")).toHaveCount(0);
    // The doc-creating API refuses while off…
    const denied = await apiJson(s, "POST", "/api/reviews", {
      kind: "document",
      markdown: "# T\n\nHello.\n",
      contextRepos: [{ repoId, source: "local" }],
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.json)).toContain("Settings → Experimental");
    // …but the panel ask API stays ungated, and its web thread stays
    // visible under the Web pages group (#322 is not experimental).
    const asked = await apiJson(s, "POST", "/api/extension/panel/ask", {
      url: "https://github.com/acme/app/issues/7",
      title: "A page",
      selection: "",
      context: "about the widget",
      question: "Where is the widget?",
    });
    expect(asked.status).toBe(200);
    await page.reload();
    await expect(page.getByTestId("web-thread-row")).toContainText("A page", { timeout: 15_000 });
    await expect(page.getByTestId("documents-experimental-notice")).toBeVisible();
  });

  test("on: the UI toggle opens the flow without a reload; off again hides it", async ({ page }) => {
    const s = service();
    await setDocs(false);
    // Flip the gate through the Settings UI.
    await gotoExperimental(page, s);
    await page.getByTestId("experimental-markdown-docs").click();
    await expect(page.getByTestId("experimental-markdown-docs")).toBeChecked({ timeout: 15_000 });
    // Client-side home (the top bar remounts and picks up the gate),
    // then the Documents link — still no reload and no fresh goto.
    await page.getByRole("link", { name: "Unvibe" }).click();
    // The token lives in localStorage (stripped from the bar), so the
    // start-page URL carries no query.
    await page.waitForURL(/\/(\?.*)?$/, { timeout: 30_000 });
    const docsLink = page.getByRole("link", { name: "Documents" });
    await expect(docsLink).toBeVisible({ timeout: 15_000 });
    await docsLink.click();
    await page.waitForURL(/\/documents/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "New document review" })).toBeVisible({ timeout: 15_000 });
    // Create a document review through the form.
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill("# L16 note\n\nThe widget folds headers.\n");
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 30_000 });
    docReviewId = page.url().split("/review/")[1].split(/[/?#]/)[0];
    await expect(page.getByTestId("document-view")).toContainText("folds headers", { timeout: 30_000 });
    // Flip the gate back off through the Settings UI.
    await gotoExperimental(page, s);
    await page.getByTestId("experimental-markdown-docs").click();
    await expect(page.getByTestId("experimental-markdown-docs")).not.toBeChecked({ timeout: 15_000 });
    // /documents shows the notice again (the web group still lists).
    await page.goto(`${s.origin}/documents?token=${s.token}`);
    await expect(page.getByTestId("documents-experimental-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "New document review" })).toHaveCount(0);
    // The existing review stays in storage (the API still reads it) but
    // its URL shows the notice — unreachable while off.
    const reread = await apiJson(s, "GET", `/api/reviews/${docReviewId}`);
    expect(reread.status).toBe(200);
    await page.goto(`${s.origin}/review/${docReviewId}?token=${s.token}`);
    await expect(page.getByTestId("document-experimental-notice")).toContainText(
      "Markdown docs is an experimental feature",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("document-view")).toHaveCount(0);
  });
});
