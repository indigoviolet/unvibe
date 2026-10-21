/**
 * J222 (#222): document review — create with two context repos, read,
 * Explain, Ask, Comment, and a `code:` citation in an answer opening
 * the cited file (from the repo its sha names) in a source-pane tab.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  let repo2Dir = "";
  let repoId = "";
  let repo2Id = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
    // Second context repo: the SAME path as repo 1's src/app.ts, with
    // different content, so a citation's sha decides whose bytes open.
    repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo2-"));
    await git(repo2Dir, "init", "-b", "main");
    await git(repo2Dir, "config", "user.email", "t@example.com");
    await git(repo2Dir, "config", "user.name", "T");
    mkdirSync(path.join(repo2Dir, "src"));
    writeFileSync(
      path.join(repo2Dir, "src", "app.ts"),
      'export function greet(): string {\n  return "hello from the second repo";\n}\n',
    );
    await git(repo2Dir, "add", ".");
    await git(repo2Dir, "commit", "-m", "second repo");
    await git(repo2Dir, "remote", "add", "origin", "https://github.com/acme/app-two.git");
    svc = await startService(dataDir, { agent: "replay" });
    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
    repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repoDir,
    )!.id;
    const added2 = await apiJson(svc, "POST", "/api/repos", { path: repo2Dir });
    expect(added2.status).toBe(200);
    repo2Id = (added2.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repo2Dir,
    )!.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(repo2Dir, { recursive: true, force: true });
  });

  test("create a document review, read it, explain and comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill(
      "# Design note\n\nThe widget folds obsolete headers before parsing.\n\nIt keeps the fast path for modern responses.\n",
    );
    // Two context repos: the scratch repo and the second repo, both local.
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Add another context repo" }).click();
    await page.getByTestId("doc-repo-select-1").selectOption(repo2Id);
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 30_000 });
    reviewId = page.url().split("/review/")[1].split(/[/?#]/)[0];

    // The document renders in the left pane with both repos as context;
    // the source pane holds no Diff tab on a document (file tabs only).
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

    // A document answer citing code in the SECOND repo (#81 wiring):
    // seed the answer (the J81 pattern), then click its chip — the file
    // tab must show the second repo's bytes for the same path.
    const sha2 = (snap.json as { contextRepos: { repoId: string; sha?: string }[] }).contextRepos.find(
      (c) => c.repoId === repo2Id,
    )?.sha;
    expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const seeded = JSON.parse(row.snapshot) as { annotations: unknown[] };
      seeded.annotations.push({
        id: "ann-doc-cite",
        type: "conversation",
        anchor: {
          host: { kind: "block", blockId: "document#p2" },
          quotedText: "folds obsolete headers",
          prefix: "The widget ",
          suffix: " before parsing.",
          position: 11,
          version: 1,
        },
        open: true,
        pinned: true,
        messages: [],
        post: false,
        turns: [
          {
            question: null,
            blocks: [
              {
                type: "paragraph",
                id: "b-cite",
                text: { standard: "The greeting lives in the second repo." },
                citations: [{ target: `code:src/app.ts:2@${sha2}` }],
              },
            ],
          },
        ],
      });
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(seeded),
        reviewId,
      );
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "replay" });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const cited = page.locator("#C-document [data-expansion]", { hasText: "The greeting lives in the second repo." });
    await expect(cited.first()).toBeVisible({ timeout: 30_000 });
    await cited.first().getByRole("button", { name: "Source" }).click();
    await expect(page.getByRole("tab", { name: "app.ts" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("hello from the second repo");
    await expect(page.locator(".codefile")).not.toContainText("hello from the feature branch");
    await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);
  });
});
