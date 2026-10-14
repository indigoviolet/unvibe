/**
 * Deepest-level "Underlying principle" end to end (PRD §4.4, audit #10).
 *
 * Real service (`mise run build` first) + `UNVIBE_AGENT: "replay"` demo
 * review via the shared harness. On a page card and on a conversation card:
 * step to the deepest level, press + again → exactly one "Underlying
 * principle" block appears; press + again → nothing more is added and the
 * user is told (toast); undo removes it.
 *
 * The deep fixture recordings (`depth-*-deep.md`) carry the principle in
 * the existing reply format; the service adds it only on + at the deepest
 * level, never on the normal standard→deep step.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

function principleLocator(scope: ReturnType<Page["locator"]>) {
  return scope.locator(".blk.gen-aside", { hasText: "Underlying principle" });
}

test.describe("deepest-level principle over the real service (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-principle-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "principle" });
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    reviewId = created.review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
        pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
      };
      const root = snap.pages.find((p) => p.id === "root");
      const ready =
        root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) &&
        root?.cards.some((c) => c.id === "central" && c.blocks.length > 0);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  async function stepToDeep(card: ReturnType<Page["locator"]>): Promise<void> {
    // Standard → deep is one Deeper click; if already deep this is a no-op
    // (second click would add the principle, so click at most twice and
    // stop once no principle is present but the level is deep).
    for (let i = 0; i < 3; i++) {
      const principles = await principleLocator(card).count();
      if (principles > 0) break;
      // The depth job settles on a new pip count (or overshoots into a
      // principle): wait for that state change instead of a fixed sleep.
      const pips = card.locator(".pips i.on");
      const pipsBefore = await pips.count();
      await card.getByRole("button", { name: "Deeper" }).click();
      await expect
        .poll(
          async () => ((await principleLocator(card).count()) > 0 ? -1 : await pips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(pipsBefore);
      // If a principle appeared we stepped past deep into principleOnly —
      // undo once and break so the caller drives + at deepest explicitly.
      if ((await principleLocator(card).count()) > 0) {
        await card.getByRole("button", { name: "Undo" }).click();
        await expect(principleLocator(card)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
      // Check whether further Deeper clicks still change depth: read pips?
      // Two clicks from standard always reach deep; break after two.
      if (i >= 1) break;
    }
  }

  test("page card: + at deepest adds one principle; + again tells; undo removes", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);
    const card = page.locator("#C-central");
    await expect(card).toBeVisible();

    await stepToDeep(card);
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });

    // + at the deepest level → exactly one principle block.
    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 60_000 });
    await expect(principleLocator(card).first()).toContainText("Underlying principle");

    // + again → nothing more is added and the user is told.
    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    // Undo removes it.
    await card.getByRole("button", { name: "Undo" }).click();
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });
  });

  test("conversation card: same principle flow", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);
    if (!svc) throw new Error("service not running");

    // Create a conversation card via the API (Explain on a central paragraph
    // that actually contains the quote) so the test does not depend on
    // selection mechanics. The quote must be a substring of the host block text.
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      pages: {
        id: string;
        cards: { id: string; blocks: { id: string; type: string; text?: { standard: string } }[] }[];
      }[];
    };
    const central = snap.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const paras = (central?.blocks ?? []).filter((b) => b.type === "paragraph" && b.text?.standard);
    const host = paras.find((b) => b.text!.standard.includes("fast path")) ?? paras[0];
    if (!host?.text) throw new Error("central has no paragraph blocks");
    const blockId = host.id;
    // Use a quote substring of the host text (first 9 chars of the match or
    // the first words) so the anchor resolves without going stale.
    const hay = host.text.standard;
    const quote = hay.includes("fast path") ? "fast path" : hay.slice(0, Math.min(12, hay.length));
    const created = (await apiJson(svc.origin, svc.token, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "explain",
      quote,
      anchor: { where: "block", blockId },
    })) as { annotationId: string; jobId?: string };
    const annId = created.annotationId;
    if (created.jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
          annotations: { id: string; turns?: { blocks: unknown[] }[] }[];
        };
        const ann = cur.annotations.find((a) => a.id === annId);
        if ((ann?.turns?.[0]?.blocks.length ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error("conversation did not fill in time");
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const exp = page.locator(`#C-central [data-expansion="${annId}"]`).first();
    await expect(exp).toBeVisible({ timeout: 30_000 });

    // Step the answer to deep (normal steps add no principle).
    for (let i = 0; i < 2; i++) {
      const expPips = exp.locator(".pips i.on");
      const expPipsBefore = await expPips.count();
      await exp.getByRole("button", { name: "Deeper" }).click();
      await expect
        .poll(
          async () => ((await principleLocator(exp).count()) > 0 ? -1 : await expPips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(expPipsBefore);
      if ((await principleLocator(exp).count()) > 0) {
        await exp.getByRole("button", { name: "Undo" }).click();
        await expect(principleLocator(exp)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
    }
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });

    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 60_000 });

    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    await exp.getByRole("button", { name: "Undo" }).click();
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });
  });
});
