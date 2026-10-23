/** J20 (#215/#216/#217): one critic job, concept pages on open, auto go-deeper — real service, replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

type Snap = {
  pages: { id: string; kind: string; title: string; cards: { id: string; pending?: unknown; blocks: unknown[]; collapsed?: boolean; why?: string }[] }[];
};
type JobRow = { kind: string; state: string; priority: number; cardId?: string };

async function snapshot(svc: RunningService, id: string): Promise<Snap> {
  const res = await apiJson(svc, "GET", `/api/reviews/${id}`);
  return res.json as Snap;
}

async function jobs(svc: RunningService, id: string): Promise<JobRow[]> {
  const res = await apiJson(svc, "GET", `/api/jobs?review=${id}`);
  return (res.json as { jobs: JobRow[] }).jobs;
}

async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.describe("J20 critic, concepts and go-deeper", () => {
  test("one critic job makes the findings; no concept pages until a link is opened; go-deeper fills itself", async ({ page }) => {
    test.setTimeout(240_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j20a-data-"));
    let svc: RunningService | null = null;
    try {
      svc = await startService(dataDir, { agent: "replay" });
      const reviewId = await createDemoReview(svc);
      // #217 (default on): every go-deeper card fills without a click, in
      // the background; #215: one critic job; #216: no concept pages yet.
      const snap = await poll(
        () => snapshot(svc!, reviewId),
        (s) => {
          const root = s.pages.find((p) => p.id === "root");
          return !!root && root.cards.length >= 8 && root.cards.every((c) => !c.pending);
        },
      );
      const root = snap.pages.find((p) => p.id === "root")!;
      expect(root.cards.every((c) => !c.pending)).toBe(true);
      expect(snap.pages.filter((p) => p.kind === "finding")).toHaveLength(2);
      expect(snap.pages.filter((p) => p.kind === "concept")).toHaveLength(0);
      const js = await poll(
        () => jobs(svc!, reviewId),
        (list) => list.filter((j) => j.kind === "critic").length >= 1 && list.filter((j) => j.kind === "go-deeper").length >= 4,
      );
      expect(js.filter((j) => j.kind === "critic")).toHaveLength(1);
      const gd = js.filter((j) => j.kind === "go-deeper");
      expect(gd.length).toBeGreaterThanOrEqual(4);
      expect(gd.every((j) => j.priority === 10)).toBe(true);
      expect(js.filter((j) => j.kind === "concept")).toHaveLength(0);

      // #217 follow-up: auto-written go-deeper cards stay collapsed
      // (title + why-line) until opened; opening shows the written
      // content instantly and starts no new job.
      const filledGd = root.cards.filter((c) => c.id.startsWith("g-"));
      expect(filledGd.length).toBeGreaterThanOrEqual(4);
      expect(filledGd.every((c) => c.collapsed)).toBe(true);
      expect(filledGd.every((c) => !!c.why)).toBe(true);
      const gdJobsBefore = (await jobs(svc, reviewId)).filter((j) => j.kind === "go-deeper").length;

      // Findings show in the guide; open the bare-LF finding page.
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const gdCard = page.locator("#C-g-flow");
      await gdCard.scrollIntoViewIfNeeded();
      await expect(gdCard).toHaveClass(/collapsed/);
      await expect(gdCard.locator(".why")).toContainText("Follows a folded header");
      await expect(gdCard).not.toContainText("getresponse()");
      await gdCard.getByRole("button", { name: "Expand" }).click();
      await expect(gdCard).toContainText("getresponse()", { timeout: 10_000 });
      await page.screenshot({ path: "test-results/j20-godeeper-opened.png", fullPage: true });
      expect((await jobs(svc, reviewId)).filter((j) => j.kind === "go-deeper")).toHaveLength(gdJobsBefore);
      // Findings show in the guide; open the bare-LF finding page. Its
      // link lives in the "Review checklist" go-deeper card, which stays
      // collapsed until opened (#217), so open that card first — its
      // written content (including the finding links) shows instantly.
      const gdCheck = page.locator("#C-g-check");
      await gdCheck.scrollIntoViewIfNeeded();
      await expect(gdCheck).toHaveClass(/collapsed/);
      await gdCheck.getByRole("button", { name: "Expand" }).click();
      const findingLink = gdCheck.locator('a.cx[data-link="page:f-lf"]');
      await expect(findingLink).toBeVisible({ timeout: 30_000 });
      await findingLink.click();
      await expect(page.locator("#page .doc h1.title")).not.toHaveText("Guide", { timeout: 60_000 });

      // #216: a concept link writes its page on open, then shows it.
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
      const conceptLink = page.locator('a.cx[data-link^="concept:"]').first();
      await expect(conceptLink).toBeVisible({ timeout: 30_000 });
      await conceptLink.click();
      await expect(page.locator("#page .doc h1.title")).not.toHaveText("Guide", { timeout: 60_000 });
      await poll(
        () => snapshot(svc!, reviewId),
        (s) => s.pages.filter((p) => p.kind === "concept").length === 1,
        60_000,
      );
      const after = await snapshot(svc, reviewId);
      expect(after.pages.filter((p) => p.kind === "concept")).toHaveLength(1);
      expect((await jobs(svc, reviewId)).filter((j) => j.kind === "concept")).toHaveLength(1);
      await page.screenshot({ path: "test-results/j20-concept-on-open.png", fullPage: true });
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("with the setting off in Settings, go-deeper cards wait for Generate", async ({ page }) => {
    test.setTimeout(240_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j20b-data-"));
    let svc: RunningService | null = null;
    try {
      svc = await startService(dataDir, { agent: "replay" });
      // Toggle off in Settings (Limits tab) before the review exists.
      await page.goto(`${svc.origin}/settings?token=${svc.token}`);
      await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Limits" }).click();
      const toggle = page.locator('[data-testid="auto-go-deeper-toggle"]');
      await expect(toggle).toBeChecked({ timeout: 30_000 });
      // Subscribe before clicking: the localhost save can answer before
      // the click resolves, so a wait started after the click can miss it
      // and time out (#251; same race #225A fixed in J11).
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
        { timeout: 15_000 },
      );
      await toggle.click();
      await saved;
      await expect(toggle).not.toBeChecked();

      const reviewId = await createDemoReview(svc);
      await poll(
        () => jobs(svc!, reviewId),
        (list) => list.some((j) => j.kind === "reader" && j.state === "done"),
      );
      await new Promise((r) => setTimeout(r, 500));
      expect((await jobs(svc, reviewId)).filter((j) => j.kind === "go-deeper")).toHaveLength(0);
      const snap = await snapshot(svc, reviewId);
      const root = snap.pages.find((p) => p.id === "root")!;
      expect(root.cards.some((c) => c.pending)).toBe(true);

      // Generate on click still writes the card.
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      const generate = page.locator("button[data-gen]").first();
      await expect(generate).toBeVisible({ timeout: 30_000 });
      const cardId = await generate.getAttribute("data-gen");
      await generate.click();
      const filledSnap = await poll(
        () => snapshot(svc!, reviewId),
        (s) => {
          const r = s.pages.find((p) => p.id === "root");
          const card = r?.cards.find((c) => c.id === cardId);
          return !!card && !card.pending && card.blocks.length > 0;
        },
        60_000,
      );
      // A Generate click is an explicit open: its card lands expanded.
      const manual = filledSnap.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === cardId)!;
      expect(manual.collapsed).toBe(false);
      await page.screenshot({ path: "test-results/j20-godeeper-off-generate.png", fullPage: true });
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
