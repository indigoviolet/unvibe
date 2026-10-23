/**
 * J255 (#255): fenced code blocks highlight with the diff Shiki setup.
 *
 * A document review whose Markdown holds a `python` block and an unknown
 * language block: the python block upgrades from plain text to token
 * spans (same text, no layout shift), the unknown block stays plain.
 * Selecting text inside the highlighted block and commenting places the
 * anchor mark inside the `pre` — the comment lands on the code.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, git, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J255 code-block highlighting", () => {
  let dataDir = "";
  let repoDir = "";
  let svc: RunningService | null = null;

  const MARKDOWN = [
    "# Highlight demo",
    "",
    "A paragraph before the code.",
    "",
    "```python",
    "def greet(name):",
    "    # say hello",
    '    return "hi " + name',
    "```",
    "",
    "```mysterylang",
    "some plain text here",
    "```",
    "",
  ].join("\n");

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j255-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j255-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
    svc = await startService(dataDir, { agent: "none" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("a python block highlights, an unknown block stays plain, and a code comment places", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");

    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
    const repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repoDir,
    )!.id;

    const created = await apiJson(svc, "POST", "/api/reviews", {
      kind: "document",
      markdown: MARKDOWN,
      contextRepos: [{ repoId, source: "local" }],
    });
    expect(created.status).toBe(201);
    const reviewId = (created.json as { review: { id: string } }).review.id;

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
    const blocks = page.locator("#C-document pre.code");
    await expect(blocks).toHaveCount(2);

    // The python block upgrades from plain text to token spans; the text
    // itself never changes (offsets for anchoring are preserved).
    const py = blocks.nth(0);
    const before = (await py.textContent()) ?? "";
    expect(before).toContain("say hello");
    await expect
      .poll(async () => py.locator("[class*='shk-']").count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect(((await py.textContent()) ?? "").replace(/\s+/g, " ").trim()).toBe(
      before.replace(/\s+/g, " ").trim(),
    );

    // The unknown language block stays plain text (today's render).
    const mystery = blocks.nth(1);
    expect(await mystery.locator("[class*='shk-']").count()).toBe(0);
    await expect(mystery).toContainText("some plain text here");

    // Select text inside the highlighted block and comment: the anchor
    // mark must land inside the `pre` (the comment places on the code).
    await selectText(page, "#C-document pre.code", "say hello");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Please explain this line.");
    await composer.getByRole("button", { name: /comment|save/i }).first().click();
    const thread = page.locator("#C-document .ithread", { hasText: "Please explain this line." });
    await expect(thread.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-document pre.code mark.anc[data-thr]").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
