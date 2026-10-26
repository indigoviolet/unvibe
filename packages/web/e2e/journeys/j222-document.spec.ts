/**
 * J222 (#222): document review — create with three context repos from the
 * documents screen, read, Explain, Ask, Comment, and a `code:` citation in
 * an answer opening the cited file (from the repo its sha names, the
 * third repo) in a source-pane tab. The PR start page shows no Document
 * section and no document reviews. #254: the review bar names the
 * document (icon + short name), the Documents list shows the same name,
 * and the browser tab titles the document.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { checkLayout } from "../layout-check.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, git, makeScratchRepo } from "./journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J222 document review", () => {
  let dataDir = "";
  let repoDir = "";
  let repo2Dir = "";
  let repo3Dir = "";
  let repoId = "";
  let repo2Id = "";
  let repo3Id = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  async function makeContextRepo(dir: string, greeting: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "app.ts"), `export function greet(): string {\n  return "${greeting}";\n}\n`);
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "context repo");
    await git(dir, "remote", "add", "origin", `https://github.com/acme/${path.basename(dir)}.git`);
  }

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
    // Second and third context repos: the SAME path as repo 1's
    // src/app.ts, with different content, so a citation's sha decides
    // whose bytes open.
    repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo2-"));
    await makeContextRepo(repo2Dir, "hello from the second repo");
    repo3Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j222-repo3-"));
    await makeContextRepo(repo3Dir, "hello from the third repo");
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
    const added3 = await apiJson(svc, "POST", "/api/repos", { path: repo3Dir });
    expect(added3.status).toBe(200);
    repo3Id = (added3.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repo3Dir,
    )!.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(repo2Dir, { recursive: true, force: true });
    rmSync(repo3Dir, { recursive: true, force: true });
  });

  test("create a document review, read it, explain and comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    // The PR start page holds no Document section and, later, no document
    // reviews: the form lives on the documents screen.
    await expect(page.getByRole("button", { name: "New document review" })).toHaveCount(0);
    await expect(page.getByTestId("document-form")).toHaveCount(0);

    // #238: the Documents icon sits next to the Unvibe home link on the
    // left, before the breadcrumb, badge, update and Settings controls.
    const barOrder = await page.evaluate(() =>
      [...(document.querySelector("header.top")?.children ?? [])].map(
        (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
      ),
    );
    expect(barOrder[0]).toBe("Unvibe");
    expect(barOrder[1]).toBe("Documents");
    expect(barOrder.indexOf("Documents")).toBeLessThan(barOrder.indexOf("Settings"));

    // The top-bar icon opens the documents screen.
    await page.getByRole("link", { name: "Documents" }).click();
    await page.waitForURL(/\/documents/, { timeout: 30_000 });
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill(
      "# Design note\n\nThe widget folds obsolete headers before parsing.\n\nIt keeps the fast path for modern responses.\n",
    );
    // Three context repos. Removing a row drops it; adding brings back a
    // removable row, so the form ends with three picks again.
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Add another context repo" }).click();
    await page.getByTestId("doc-repo-select-1").selectOption(repo2Id);
    await page.getByRole("button", { name: "Add another context repo" }).click();
    await page.getByTestId("doc-repo-select-2").selectOption(repo3Id);
    await expect(page.getByTestId("doc-markdown")).toBeVisible();
    await page.locator('[data-testid="doc-repo-1"]').getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("doc-repo-select-2")).toHaveCount(0);
    await page.getByRole("button", { name: "Add another context repo" }).click();
    await page.getByTestId("doc-repo-select-1").selectOption(repo2Id);
    await page.getByTestId("doc-repo-select-2").selectOption(repo3Id);
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 30_000 });
    reviewId = page.url().split("/review/")[1].split(/[/?#]/)[0];

    // The documents screen lists the new review (#254: same document
    // name with the document icon).
    await page.goto(`${svc.origin}/documents?token=${svc.token}`);
    await expect(page.getByTestId(`session-${reviewId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`session-${reviewId}`)).toContainText("Design note");
    // The PR start page lists no document reviews.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByTestId(`session-${reviewId}`)).toHaveCount(0);

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    // #254: the review bar names the document (icon + short name), never
    // the first context repo; the browser tab titles the document too.
    const bar = page.locator("#reviewbar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar.locator(".docid")).toContainText("Design note", { timeout: 15_000 });
    await expect(bar.locator(".docid")).toHaveAttribute("title", "Design note");
    await expect(bar.locator(".docid svg.ic")).toHaveCount(1);
    await expect(bar).not.toContainText("acme/");
    await expect(page).toHaveTitle(/Design note/, { timeout: 15_000 });
    // The document renders in the left pane with all three repos as
    // context; the source pane holds no Diff tab on a document (file
    // tabs only).
    await expect(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-view")).toContainText("folds obsolete headers");
    await expect(page.getByTestId("document-context")).toContainText("local copy");
    await expect(page.getByRole("tab", { name: "Diff" })).toHaveCount(0);

    // Explain on document text (replay agent answers from the base fork).
    await selectText(page, "#C-document", "folds obsolete headers");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator('#C-document section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // Ask on document text: an Ask thread answers from the context repos.
    await selectText(page, "#C-document", "fast path for modern responses");
    await page.locator('#selbar [data-act="ask"]').click();
    const askComposer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(askComposer).toBeVisible({ timeout: 10_000 });
    await askComposer.locator("textarea").fill("Why does it keep a fast path?");
    await askComposer.getByRole("button", { name: "Ask" }).click();
    const askCard = page.locator('#C-document section.ithread[data-thread]:has([data-reply][data-kind="ask"])', { hasText: "Why does it keep a fast path?" });
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
    const annotations = (snap.json as { annotations: { replies?: { kind?: string }[]; post: boolean }[] }).annotations;
    const comment = annotations.find((a) => (a.replies ?? []).some((r) => r.kind === "comment"));
    expect(comment?.post).toBe(true);

    // A document answer citing code in the THIRD repo (#81 wiring):
    // seed the answer (the J81 pattern), then click its chip — the file
    // tab must show the third repo's bytes for the same path.
    const sha3 = (snap.json as { contextRepos: { repoId: string; sha?: string }[] }).contextRepos.find(
      (c) => c.repoId === repo3Id,
    )?.sha;
    expect(sha3).toMatch(/^[0-9a-f]{40}$/);
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
        type: "thread",
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
        post: false,
        replies: [
          {
            id: "ans-doc-cite-1",
            kind: "ask",
            who: "agent",
            question: null,
            blocks: [
              {
                type: "paragraph",
                id: "b-cite",
                text: { standard: "The greeting lives in the third repo." },
                citations: [{ target: `code:src/app.ts:2@${sha3}` }],
              },
            ],
            level: "standard",
            revision: 1,
            undoStack: [],
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
    const cited = page.locator('#C-document section.ithread[data-thread]', { hasText: "The greeting lives in the third repo." });
    await expect(cited.first()).toBeVisible({ timeout: 30_000 });
    await cited.first().getByRole("button", { name: "Source" }).click();
    await expect(page.getByRole("tab", { name: "app.ts" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("hello from the third repo");
    await expect(page.locator(".codefile")).not.toContainText("hello from the feature branch");
    await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);

    // The earlier document comment is in the Outbox (#223, #226),
    // exported under its document block with a Copy-able Markdown box.
    // A document has no GitHub side on either tab (#236): no
    // "On GitHub" section, no Submit-drafts line, and a short entry
    // meta (the guide pattern).
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await expect(page.locator(".cmenu")).not.toContainText("On GitHub");
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    await expect(page.locator('.cmenu [data-cmsec="outbox"]')).toContainText("Please expand this part.");
    await expect(page.locator('.cmenu [data-cmsec="outbox"]')).toContainText("Design note");
    await expect(page.locator(".cmenu")).not.toContainText("On GitHub");
    await expect(page.locator(".cmenu")).not.toContainText("Nothing reaches GitHub");
    await expect(page.locator(".cmenu")).not.toContainText("stays in the Outbox");
    await expect(page.locator("[data-outbox-md]")).toContainText("# Comments on Design note", { timeout: 15_000 });
    await expect(page.locator("[data-outbox-md]")).toContainText("## Design note › p3");
    await expect(page.locator("[data-outbox-md]")).toContainText("Please expand this part.");
    await page.keyboard.press("Escape");

    // #254: tour frames of the document review's bar (Default, Studio and
    // Console) with layout checks. The bar keeps #245's one height and
    // centre line with the icon + name.
    for (const combo of [
      { theme: "default", scheme: "light", dark: false },
      { theme: "studio", scheme: "light", dark: false },
      { theme: "console", scheme: "dark", dark: true },
    ] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      else await page.emulateMedia({ colorScheme: "light" });
      const staged = await apiJson(svc, "PUT", "/api/settings", { uiTheme: combo.theme });
      expect(staged.status).toBe(200);
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("unvibe:ui-theme", t);
        } catch {
          // Boot falls back; the assert below fails.
        }
      }, combo.theme);
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const docBar = page.locator("#reviewbar");
      await expect(docBar.locator(".docid")).toContainText("Design note", { timeout: 15_000 });
      // One height, centred on one line (#245 applies to the doc identity too).
      const boxes = await docBar.evaluate((el) => {
        const sels: [string, string][] = [
          ["home", 'a[aria-label="Back to the start page"]'],
          ["doc", ".docid"],
          ["debug", 'a[aria-label="Debug"]'],
          ["panes", ".seg"],
          ["comments", '[data-cm=""]'],
          ["submit", ".ra .ui-btn[data-variant='primary']"],
        ];
        return sels.flatMap(([name, sel]) => {
          const n = el.querySelector(sel);
          if (!n) return [];
          const r = n.getBoundingClientRect();
          return r.height > 0 ? [{ name, height: r.height, mid: r.top + r.height / 2 }] : [];
        });
      });
      expect(boxes.map((b) => b.name)).toEqual(
        expect.arrayContaining(["home", "doc", "panes", "comments", "submit"]),
      );
      const h = boxes[0].height;
      for (const b of boxes) expect(Math.abs(b.height - h), `${b.name} height ${b.height} vs ${h}`).toBeLessThanOrEqual(1);
      const mids = boxes.map((b) => b.mid);
      expect(Math.max(...mids) - Math.min(...mids), JSON.stringify(boxes)).toBeLessThanOrEqual(1);
      await checkLayout(page, `reviewbar-doc-${combo.theme}-${combo.scheme}`);
      await docBar.screenshot({ path: path.join(SHOTS, `reviewbar-doc-${combo.theme}-${combo.scheme}.png`) });
    }
  });
});
