/** J222 (#222 phase 1): document review — create, read, Explain, Comment. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, git, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J222 document review", () => {
  let dataDir = "";
  let repoDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
    svc = await startService(dataDir, { agent: "replay" });
    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("create a document review, read it, explain and comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill(
      "# Design note\n\nThe widget folds obsolete headers before parsing.\n\nIt keeps the fast path for modern responses.\n",
    );
    await expect(page.getByTestId("doc-repo-select-0")).not.toHaveValue("");
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 30_000 });
    reviewId = page.url().split("/review/")[1].split(/[/?#]/)[0];

    // The document renders in the left pane with its context; no diff pane.
    await expect(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-view")).toContainText("folds obsolete headers");
    await expect(page.getByTestId("document-context")).toContainText("local copy");
    await expect(page.getByRole("tab", { name: "Diff" })).toHaveCount(0);

    // Explain on document text (replay agent answers from the base fork).
    await selectText(page, "#C-document", "folds obsolete headers");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator("#C-document [data-expansion]").first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // Ask on document text: a conversation card answers from the context repos.
    await selectText(page, "#C-document", "fast path for modern responses");
    await page.locator('#selbar [data-act="ask"]').click();
    const askComposer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(askComposer).toBeVisible({ timeout: 10_000 });
    await askComposer.locator("textarea").fill("Why does it keep a fast path?");
    await askComposer.getByRole("button", { name: "Ask" }).click();
    const askCard = page.locator("#C-document [data-expansion]", { hasText: "Why does it keep a fast path?" });
    await expect(askCard.first()).toBeVisible({ timeout: 30_000 });
    await expect(askCard.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    // Comment on document text: local, marked for the Outbox (post=true).
    await selectText(page, "#C-document", "fast path");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Please expand this part.");
    await composer.getByRole("button", { name: /comment|save/i }).first().click();
    await expect(page.locator("#C-document .ithread", { hasText: "Please expand this part." }).first()).toBeVisible({
      timeout: 15_000,
    });
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const annotations = (snap.json as { annotations: { type: string; post: boolean }[] }).annotations;
    const comment = annotations.find((a) => a.type === "comment");
    expect(comment?.post).toBe(true);
  });
});
