/** J14 (#188 round 2): diagrams render/fallback, Debug page, re-do a review. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createDemoReview, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J14 diagrams, debug, redo", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a diagram in the guide renders as SVG", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    // The go-deeper flow card carries the fixture diagram (pipeline fills it).
    const svg = page.locator(".dg-svg svg").first();
    const fallback = page.locator(".dg-fallback").first();
    await expect(svg.or(fallback)).toBeVisible({ timeout: 90_000 });
    if ((await svg.count()) > 0) {
      await expect(svg).toBeVisible();
    } else {
      // No d2 on this machine: the source fallback must say where to fix it.
      await expect(fallback).toContainText(/Settings/);
    }
  });

  test("debug page shows jobs and prompts for the review", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/reader|hunk|ask/i, { timeout: 30_000 });
    await page.getByRole("tab", { name: "Prompts" }).click();
    await expect(page.locator('[data-testid^="prompt-"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Jobs" }).click();
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 15_000 });
    // Back to the review itself.
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  });

  test("without d2 an unseeded diagram shows the source fallback with a Settings link", async ({ page }) => {
    test.setTimeout(240_000);
    const badData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-badd2-"));
    let bad: RunningService | null = null;
    try {
      // Seed the fixture review plus one diagram whose hash has no
      // pre-rendered SVG (same technique as d2-diagrams-service.spec.ts):
      // without d2 it cannot render, so the fallback is the user-visible path.
      const { readFileSync } = await import("node:fs");
      const { DatabaseSync } = await import("node:sqlite");
      const { fileURLToPath } = await import("node:url");
      const fixtureDir = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
      const snapshot = JSON.parse(readFileSync(path.join(fixtureDir, "snapshot.json"), "utf8")) as {
        rev: number; review: { id: string };
        pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
      };
      const meta = JSON.parse(readFileSync(path.join(fixtureDir, "meta.json"), "utf8")) as { keyAliases: Record<string, string> };
      let json = JSON.stringify(snapshot);
      for (const [a, r] of Object.entries(meta.keyAliases)) json = json.split(`diff:${a}:`).join(`diff:${r}:`);
      const seeded = JSON.parse(json) as typeof snapshot;
      seeded.review.id = "j14-d2-seed";
      const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-flow");
      if (!card) throw new Error("fixture has no g-flow card");
      const { canonicalizeD2Source, diagramHash, D2_MIN_VERSION } = await import("@unvibe/shared");
      const source = ['probe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}', 'probe2: "probe target"', 'probe -> probe2: "probe edge"'].join("\n");
      card.blocks.push({
        type: "diagram", id: "b-j14-extra", source,
        citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
        render: { hash: diagramHash(canonicalizeD2Source(source), D2_MIN_VERSION), status: "pending" },
      });
      const db = new DatabaseSync(path.join(badData, "unvibe.db"));
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, snapshot JSON NOT NULL, updated_at INTEGER NOT NULL);`);
        db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot")
          .run("j14-d2-seed", seeded.rev, JSON.stringify(seeded), Date.now());
      } finally { db.close(); }
      bad = await startService(badData, { agent: "replay", extraEnv: { UNVIBE_D2_BIN: "/nonexistent-d2" } });
      await page.goto(`${bad.origin}/review/j14-d2-seed?token=${bad.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
      const fallback = page.locator(".dg-fallback").first();
      await expect(fallback).toBeVisible({ timeout: 90_000 });
      await expect(fallback).toContainText(/Settings/);
    } finally {
      await bad?.stop().catch(() => {});
      rmSync(badData, { recursive: true, force: true });
    }
  });

  test("re-do from the debug page lands on a fresh review", async ({ page }) => {
    test.setTimeout(240_000);
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-repo-"));
    const redoData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-redo-"));
    let redoSvc: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      redoSvc = await startService(redoData, { agent: "none" });
      const id = await createScratchReview(redoSvc, repoDir);
      await page.goto(`${redoSvc.origin}/review/${id}/debug?token=${redoSvc.token}`);
      await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Re-do guide" }).click();
      await expect(page.getByText(/Anything already on GitHub stays there/)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Re-do guide" }).last().click();
      await expect.poll(() => page.url(), { timeout: 60_000 }).not.toContain(`/review/${id}`);
      await expect(page.locator("#right")).toBeVisible({ timeout: 60_000 });
    } finally {
      await redoSvc?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(redoData, { recursive: true, force: true });
    }
  });
});
