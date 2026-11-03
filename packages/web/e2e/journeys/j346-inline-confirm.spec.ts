/**
 * J346 (#346): the shared inline confirm against the real service —
 * removing a review from Reviews and removing a document from Documents
 * through the in-place pill (idle → confirming → "✓ Confirmed" flash →
 * row gone), with Escape and outside-click cancel paths. The API list
 * backs every UI assertion. Re-do guide runs the same pill (J14 covers
 * its real-service flow); thread/comment deletes use no popout, so they
 * are out of scope.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J346 inline confirm", () => {
  let dataDir = "";
  let repoDir = "";
  let repoId = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j346-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j346-repo-"));
    await makeScratchRepo(repoDir);
    svc = await startService(dataDir, { agent: "none" });
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

  async function reviewIds(): Promise<string[]> {
    const list = await apiJson(svc!, "GET", "/api/reviews");
    expect(list.status).toBe(200);
    return (list.json as { reviews: { id: string }[] }).reviews.map((r) => r.id);
  }

  test("remove a review through the inline confirm", async ({ page }) => {
    const id = await createScratchReview(svc!, repoDir);
    await page.goto(`${svc!.origin}/?token=${svc!.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const row = page.locator(`[data-testid="session-${id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Escape cancels without touching the row; focus was on confirm.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect(row.getByText("Confirm remove review")).toBeVisible();
    await expect(row.getByRole("button", { name: "Confirm remove review" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(row.getByText("Confirm remove review")).toHaveCount(0);
    await expect(row).toBeVisible();
    // An outside click cancels too.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect(row.getByText("Confirm remove review")).toBeVisible();
    await page.getByRole("heading", { name: "Reviews" }).click();
    await expect(row.getByText("Confirm remove review")).toHaveCount(0);
    await expect(row).toBeVisible();
    // Confirm: the flash shows, then the row goes and the API forgets it.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await row.getByRole("button", { name: "Confirm remove review" }).click();
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(await reviewIds()).not.toContain(id);
  });

  test("remove a document through the inline confirm", async ({ page }) => {
    await page.goto(`${svc!.origin}/documents?token=${svc!.token}`);
    await expect(page.getByRole("button", { name: "New document review" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill("# Remove me\n\nDelete this document review.\n");
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 60_000 });
    const docId = page.url().split("/review/")[1].split(/[/?#]/)[0];
    await page.goto(`${svc!.origin}/documents?token=${svc!.token}`);
    const row = page.locator(`[data-testid="session-${docId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Remove me");
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect(row.getByText("Confirm remove review")).toBeVisible();
    await row.getByRole("button", { name: "Confirm remove review" }).click();
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("documents-empty")).toBeVisible();
    await expect(await reviewIds()).not.toContain(docId);
  });
});
