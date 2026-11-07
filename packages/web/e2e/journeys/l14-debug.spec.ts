/**
 * L14 — Debug and traces (#363 package D).
 *
 * The debug area in usage order: the review bar links to the debug
 * page with Jobs as the default tab (no re-do button on the page);
 * switching tabs shows one panel and replaces the history entry;
 * `?tab=` deep links survive reload with other query params kept;
 * shared-context blocks collapse and expand with Base open, expand /
 * collapse all, and open blocks surviving a tab switch; jobs show
 * state, tokens, cache rate and tool counts with a turn-by-turn Output
 * (no Prompt button — the Output already shows each turn's prompt);
 * prompts expand to the review's text; deleting a contribution removes
 * it without collapsing open blocks; the page links back to the
 * review; no full-access marker while the setting is off; re-do from
 * the top bar lands on a fresh review (#345/#346 inline confirm with
 * Cancel and Escape); and the lean traces behaviour (the Debug section
 * names the matching debug install instead of recording, every trace
 * route 501s while settings still save).
 *
 * Boots: ONE replay service over a freshly built demo review (debug
 * page, jobs, prompts, delete); ONE agent:none service over a scratch
 * repo for the re-do flow; ONE agent:none service with
 * UNVIBE_DISABLE_TRACING=1 for the lean traces behaviour.
 *
 * Absorbs: `debug.spec.ts` (all 12 — the queued-cancel/backing-off row
 * stays mock-covered in a small mock-mode describe, everything else
 * runs against the real service), the debug-page and re-do thirds of
 * `j14-diagrams-debug-redo.spec.ts` (the diagram third — the two
 * render tests plus the seeded-D2 block — lives in L3 per the plan),
 * and `j356-traces.spec.ts` (both lean tests; the debug-build-only
 * record/export journey stays in `j356-traces-debug.spec.ts`).
 *
 * Guards kept: #32 (debug page tabs, one panel, history replace);
 * #60 (collapsible shared-context blocks, sticky summaries);
 * #207 (one view per job, tool counts, Output per turn, no Prompt
 * button); #345 (re-do icon button with tooltip, no visible text);
 * #346 (shared inline confirm, what-is-lost copy, Cancel/Escape);
 * #356 (lean builds record nothing: 501s + debug-install pointer);
 * GITHUB_TOKEN stripped; no network beyond loopback (network-guard).
 *
 * Frames removed: none in this area (the j356 debug frames already
 * live in the debug-only `j356-traces-debug.spec.ts`, which never runs
 * in the gate).
 *
 * Brittleness fixed here (#363 §4): the debug flows had no fixed
 * sleeps; the delete test seeds its contribution through the snapshot
 * DB (the J81/j14 pattern) instead of racing the pipeline; the
 * lean-traces `waitForLoadState("networkidle")` asserts are UI-state
 * asserts (the notice/switch visibility), kept as-is on settled
 * settings content.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview, createScratchReview, makeScratchRepo, stampDataFormat } from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// ---------------------------------------------------------------------------
// Debug page over a replay-built demo review.
// ---------------------------------------------------------------------------

test.describe("L14 debug page", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l14-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "l14debug" });
    reviewId = await createDemoReview(svc);
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

  async function gotoSharedContext(page: import("@playwright/test").Page): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}/debug?token=${s.token}`);
    await page.getByRole("tab", { name: "Shared context" }).click();
  }

  test("review bar links to the debug page, which defaults to the Jobs tab", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await page.getByRole("link", { name: "Debug", exact: true }).click();
    await expect(page).toHaveURL(/\/review\/[^/]+\/debug/);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toContainText("Debug");
    await expect(crumbs.getByText("Debug")).toHaveAttribute("aria-current", "page");

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
    // The debug page carries no re-do at all (it moved to the top bar).
    await expect(page.getByRole("button", { name: "Re-do guide" })).toHaveCount(0);
  });

  test("switching tabs shows one panel and replaces the history entry; ?tab= survives reload", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await page.getByRole("link", { name: "Debug", exact: true }).click();
    await page.getByRole("tab", { name: "Shared context" }).click();
    await expect(page).toHaveURL(/\/debug\?tab=context/);
    await expect(page.getByRole("tabpanel", { name: "Shared context" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeHidden();
    await page.getByRole("tab", { name: "Prompts" }).click();
    await expect(page).toHaveURL(/\/debug\?tab=prompts/);
    // Replaced, not pushed: Back leaves the page instead of stepping tabs.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/review/${reviewId}(\\?|$)`));

    // ?tab= deep link survives reload; other query parameters are kept.
    await page.goto(`${s.origin}/review/${reviewId}/debug?tab=prompts&extra=1&token=${s.token}`);
    await expect(page.getByRole("tab", { name: "Prompts" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Prompts" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Prompts" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Shared context" }).click();
    await expect(page).toHaveURL(/tab=context/);
    await expect(page).toHaveURL(/extra=1/);
  });

  test("shared context blocks collapse and expand; open blocks survive a tab switch", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoSharedContext(page);
    const base = page.locator('section[aria-label="Base"]');
    const log = page.locator('section[aria-label="Log"]');
    const contribs = page.locator('section[aria-label="Contributions"]');
    // Base starts open; Log and Contributions start closed.
    await expect(base.locator("details")).toHaveAttribute("open", "");
    await expect(log.locator("details")).not.toHaveAttribute("open", "");
    await expect(contribs.locator("details")).not.toHaveAttribute("open", "");
    await expect(base).not.toBeEmpty();
    // Long blocks keep their collapse control reachable: summaries stick.
    await expect(base.locator("summary")).toHaveCSS("position", "sticky");

    await base.locator("summary").click();
    await expect(base.locator("details")).not.toHaveAttribute("open", "");
    await base.locator("summary").click();
    await expect(base.locator("details")).toHaveAttribute("open", "");

    // Expand all / collapse all.
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

    // Open blocks survive a tab switch.
    await log.locator("summary").click();
    await expect(log.locator("details")).toHaveAttribute("open", "");
    await page.getByRole("tab", { name: "Jobs" }).click();
    await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeVisible();
    await page.getByRole("tab", { name: "Shared context" }).click();
    await expect(log.locator("details")).toHaveAttribute("open", "");
  });

  test("jobs show state, tokens, cache rate, tool counts and Output; prompts expand", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}/debug?token=${s.token}`);
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/reader|hunk|ask/i, { timeout: 30_000 });
    // #207: one view per job — there is no separate Prompt button; the
    // Output view shows each turn's prompt.
    await expect(page.getByRole("button", { name: "Prompt" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hide prompt" })).toHaveCount(0);
    // #207: a finished job's row shows tokens and cache, a tool count
    // that expands to one line per call, and a line expands to its full
    // arguments and result.
    const toolsButton = page.getByRole("button", { name: /^Tools: \d+$/ }).first();
    await expect(toolsButton).toBeVisible({ timeout: 60_000 });
    await toolsButton.click();
    const jobTools = page.locator('[data-testid="job-tools"]').first();
    await expect(jobTools).toBeVisible({ timeout: 15_000 });
    const jobToolLines = jobTools.locator('[data-testid="job-tool"]');
    await expect(jobToolLines.first()).toContainText("Read", { timeout: 15_000 });
    await jobToolLines.first().locator("summary").click();
    await expect(jobToolLines.first()).toContainText("Arguments");
    // #207: a finished job's Output shows, per turn, its prompt, its
    // reply, a tool call with its result, and the raw usage payload.
    await page.getByRole("button", { name: "Output" }).first().click();
    const output = page.locator('[data-testid="job-output"]').first();
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).toContainText("Reply 1");
    await expect(output).toContainText("Prompt");
    await expect(output).toContainText("Output");
    // Inside the view, tool calls are one line each in a bounded list;
    // a line expands to the full arguments and result.
    const turnTools = output.locator('[data-testid="job-turn-tools"]').first();
    await expect(turnTools).toBeVisible({ timeout: 15_000 });
    const turnToolLines = turnTools.locator('[data-testid="job-turn-tool"]');
    await expect(turnToolLines.first()).toContainText("Read");
    await turnToolLines.first().locator("summary").click();
    await expect(turnToolLines.first()).toContainText("Arguments");
    await expect(output).toContainText("Raw usage");
    await expect(output).toContainText("quota");

    // Prompts show the expanded text for this review.
    await page.getByRole("tab", { name: "Prompts" }).click();
    const card = page.locator('section[aria-label="Prompts"]').locator('[data-testid="prompt-reader"]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Expand reader" }).click();
    await expect(card.getByText(/total · .* cached/)).toBeVisible({ timeout: 15_000 });
    const l1 = card.locator('details.lay[data-layer="L1"]');
    await expect(l1).toBeVisible();
    await l1.locator("summary").click();
    await expect(l1).not.toBeEmpty();
    // Expand all / collapse all on the Prompts tab.
    const promptsPanel = page.getByRole("tabpanel", { name: "Prompts" });
    await promptsPanel.getByRole("button", { name: "Expand all" }).click();
    await expect(promptsPanel.locator('[data-testid="prompt-reader"]')).not.toBeEmpty();
    await promptsPanel.getByRole("button", { name: "Collapse all" }).click();

    // Back to the review itself.
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  });

  test("delete removes the contribution without collapsing open blocks", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    // Seed one contribution through the snapshot DB while stopped (the
    // seeded demo carries none), then restart and delete it in the UI.
    await svc!.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const seeded = JSON.parse(row.snapshot) as { contributions: unknown[] };
      seeded.contributions = seeded.contributions ?? [];
      seeded.contributions.push({
        id: "ct-l14-1",
        sourceSession: "sess-reader-1",
        items: [
          { kind: "fact", text: "The L14 seed fact cites the demo hunk.", citations: [] },
        ],
        status: "pending",
      });
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(seeded),
        reviewId,
      );
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "replay", label: "l14debug2" });

    await gotoSharedContext(page);
    const contribs = page.locator('section[aria-label="Contributions"]');
    const log = page.locator('section[aria-label="Log"]');
    await contribs.locator("summary").click();
    await log.locator("summary").click();
    await expect(contribs).toContainText("The L14 seed fact");
    await page.getByRole("button", { name: "Delete ct-l14-1" }).click();
    await expect(page.locator('[data-testid="debug-delete-ct-l14-1"]')).toHaveCount(0);
    await expect(contribs).not.toContainText("The L14 seed fact");
    // The refetch leaves the other open blocks alone.
    await expect(contribs.locator("details")).toHaveAttribute("open", "");
    await expect(log.locator("details")).toHaveAttribute("open", "");
  });

  test("debug page links back to the review; no full-access marker while off", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}/debug?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Debug sections" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("full-access-marker")).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: /urllib3|demo/i })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/review/${reviewId}(\\?|$)`), { timeout: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// Mock-mode debug rows that need canned queued/backing-off jobs.
// ---------------------------------------------------------------------------

test.describe("L14 mock-mode job rows", () => {
  test("queued job cancels; backing-off row shows retry; totals line", async ({ page }) => {
    await page.goto("/review/demo/debug");
    const running = page.locator('[data-testid="job-job-explain-1"]');
    await expect(running).toContainText("ask");
    await expect(running).toContainText("running");
    await expect(running).toContainText("42.5k in");
    await expect(running).toContainText("47.8% hit");

    const backing = page.locator('[data-testid="job-job-critic-1"]');
    await expect(backing).toContainText(/backing-off · retry in/);

    const queued = page.locator('[data-testid="job-job-hunk-1"]');
    await queued.getByRole("button", { name: "Cancel" }).click();
    await expect(queued).toContainText("cancelled");

    await expect(page.locator('[data-testid="jobs-totals"]')).toContainText("Totals:");
  });
});

// ---------------------------------------------------------------------------
// Re-do from the top bar (j14 re-do third).
// ---------------------------------------------------------------------------

test.describe("L14 re-do from the top bar", () => {
  test("re-do lands on a fresh review; Cancel and Escape keep the review", async ({ page }) => {
    test.setTimeout(240_000);
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l14r-repo-"));
    const redoData = mkdtempSync(path.join(os.tmpdir(), "unvibe-l14r-data-"));
    let redoSvc: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      redoSvc = await startService(redoData, { agent: "none", label: "l14redo" });
      const id = await createScratchReview(redoSvc, repoDir);
      await page.goto(`${redoSvc.origin}/review/${id}?token=${redoSvc.token}`);
      await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      // #345: the toolbar icon button carries its label as the tooltip,
      // with no visible text.
      const redo = page.getByRole("button", { name: "Re-do guide" });
      await expect(redo).toBeVisible({ timeout: 30_000 });
      await expect(redo).toHaveAttribute("title", "Re-do guide");
      await expect(redo).toHaveText("");
      await redo.click();
      // #346: the shared inline confirm; the what-is-lost copy lives in
      // the pill's accessible name.
      const pill = page.locator("#reviewbar .uic-pill");
      await expect(pill).toContainText("Confirm re-do guide", { timeout: 15_000 });
      await expect(pill).toHaveAttribute("aria-label", /Anything already on GitHub stays there/);
      // Cancel and Escape close the confirmation without leaving the review.
      await pill.getByRole("button", { name: "Cancel" }).click();
      await expect(pill).toHaveCount(0);
      await expect(page.url()).toContain(`/review/${id}`);
      await redo.click();
      await expect(pill).toContainText("Confirm re-do guide", { timeout: 15_000 });
      await page.keyboard.press("Escape");
      await expect(pill).toHaveCount(0);
      await expect(page.url()).toContain(`/review/${id}`);
      await redo.click();
      await expect(pill).toContainText("Confirm re-do guide", { timeout: 15_000 });
      await pill.getByRole("button", { name: "Confirm re-do guide" }).click();
      await expect.poll(() => page.url(), { timeout: 60_000 }).not.toContain(`/review/${id}`);
      await expect(page.locator("#right")).toBeVisible({ timeout: 60_000 });
    } finally {
      await redoSvc?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(redoData, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Lean traces (j356): no OTel — the Debug section names the matching
// debug install and every trace route 501s while settings still save.
// ---------------------------------------------------------------------------

test.describe("L14 traces unavailable without OTel", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    // UNVIBE_DISABLE_TRACING=1 simulates the lean install (no OTel
    // packages): the loader degrades to null and every trace route 501s.
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l14-lean-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_DISABLE_TRACING: "1" }, label: "l14lean" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
      // The sibling trace store lives outside the data dir.
      rmSync(`${dataDir}-traces`, { recursive: true, force: true });
    }
  });

  test("Debug names the matching debug install instead of recording", async ({ page }) => {
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
    await page.waitForLoadState("networkidle");
    // The source checkout behind a test build carries no channel, so
    // the notice falls back to the release debug build.
    await expect(page.getByText(/aren't available in this build/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("npm install -g github:indigoviolet/unvibe#release-debug"),
    ).toBeVisible();
    await expect(page.getByLabel("Record performance traces")).toHaveCount(0);
  });

  test("trace routes answer 501 while settings still saves", async () => {
    if (!svc) throw new Error("no service");
    const put = await apiJson(svc, "PUT", "/api/settings", { recordTraces: true });
    expect(put.status).toBe(200);
    for (const [method, url] of [
      ["GET", "/api/traces/status"],
      ["GET", "/api/traces/export"],
      ["POST", "/api/traces/spans"],
      ["POST", "/api/traces/clear"],
    ] as const) {
      const res = await apiJson(svc, method, url, method === "POST" ? { spans: [] } : undefined);
      expect(res.status, url).toBe(501);
    }
  });
});
