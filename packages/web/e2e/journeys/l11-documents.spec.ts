/**
 * L11 — Documents and side panel (#363 package D).
 *
 * Document reviews in usage order: create with three context repos from
 * the documents screen, read, Explain, Ask, Comment, and a `code:`
 * citation in an answer opening the cited file (from the repo its sha
 * names, the third repo) in a source-pane tab; the PR start page shows
 * no Document section and no document reviews; #254 (the review bar
 * names the document, the Documents list shows the same name, the
 * browser tab titles the document); the side panel flow (one thread,
 * answers from two repos, active-repo checkboxes, panel model picker,
 * install help, Show-folder via the runner, the connected line, web
 * reviews under Documents' Web pages group, never in Reviews).
 *
 * Boots: ONE replay service over three context repos (document CRUD +
 * citations); ONE agent:none service on a candidate port for the panel
 * flow (retriever evidence, no agent).
 *
 * Absorbs: `j222-document` (the review-bar doc loop moves to the tour —
 * it is frames + layout geometry; the bar behaviour stays here) and
 * `extension-panel-322.spec.ts` (panel screenshot → tour).
 *
 * Guards kept: #254 (document identity in bar/list/tab); #81 (code
 * citation opens the cited repo's bytes); #181 (replayed Explain
 * offered as AI-suggested comment); #222 (no Diff tab on documents);
 * #226 (document Outbox Markdown under its block); #236 (no GitHub
 * side on documents); #238 (Documents next to Unvibe); #333 (one
 * conversation button — full flow lives in L12); extension origin +
 * token gate (403s on panel endpoints); `GITHUB_TOKEN` stripped in the
 * harness; no network beyond the loopback service (network-guard).
 *
 * Frames removed (tour owns them; package D re-adds in
 * `e2e/tour/visual-tour-system.spec.ts`): j222's reviewbar-doc shots
 * (1440 light default + studio/console-dark named keeps) and the
 * extension-panel shot.
 *
 * Brittleness fixed here (#363 §4): none of these files used fixed
 * sleeps for state; the DB-seed-then-restart pattern keeps the
 * replay-jobs-settled wait before stopping (orphaned `unvibe-d2-*`
 * temp dirs fail the per-run temp guard).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import {apiJson, git, makeScratchRepo, realGitPath, stampDataFormat, writeFakeGitOffline, writeFakeShell, fakeServicePath} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

import { fileURLToPath } from "node:url";

const EXTENSION_DIR = fileURLToPath(new URL("../../../../extension", import.meta.url));
// Ports the extension worker probes (see extension/background.js).
const CANDIDATE_PORTS = [4517, 4518, 4519, 4520, 4521];

/**
 * Start a service on the first free extension-probe port (#322, #370):
 * probing only one port races parallel checkouts and TIME_WAIT holds,
 * so a bind refusal retries the next candidate instead of failing.
 */
async function startOnExtensionPort(
  dataDir: string,
  extraEnv: Record<string, string | undefined>,
  label: string,
  opts: { agent?: "none" | "replay"; testBinDir?: string } = {},
): Promise<RunningService> {
  const failures: string[] = [];
  for (const port of CANDIDATE_PORTS) {
    try {
      return await startService(dataDir, {  // eslint-disable-line no-await-in-loop
        agent: opts.agent ?? "none",
        port: String(port),
        ...(opts.testBinDir !== undefined ? { testBinDir: opts.testBinDir } : {}),
        extraEnv,
        label,
      });
    } catch (e) {
      // The bind refusal ("already in use") reaches the harness only as
      // an exit code (stderr, not stdout), so every bind failure retries
      // the next candidate — but the FIRST error is what throws, with the
      // attempts listed, so a genuine failure (bad repo, bad env) never
      // masks itself as "no free port".
      failures.push(`${port}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`no free extension port (${failures.length} attempts): ${failures[0]}`);
}

test.describe("L11 document review", () => {
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
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l11-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l11-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
    // Second and third context repos: the SAME path as repo 1's
    // src/app.ts, with different content, so a citation's sha decides
    // whose bytes open.
    repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l11-repo2-"));
    await makeContextRepo(repo2Dir, "hello from the second repo");
    repo3Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l11-repo3-"));
    await makeContextRepo(repo3Dir, "hello from the third repo");
    svc = await startService(dataDir, { agent: "replay", label: "l11doc" });
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

  test("create a document review, read it, explain, ask and comment; citations open the cited repo", async ({ page }) => {
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
    // #245: the doc identity keeps one height on one centre line (framed
    // in the tour; asserted here so the tour stays capture-only).
    const docBarBoxes = await bar.locator(".docid").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { height: r.height, mid: r.top + r.height / 2 };
    });
    expect(docBarBoxes.height).toBeGreaterThan(0);
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
    // Select the full phrase: the replayed Explain answer also
    // contains "fast path", so the short text would anchor there.
    await selectText(page, "#C-document", "fast path for modern responses");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Please expand this part.");
    await composer.getByRole("button", { name: /comment|save/i }).first().click();
    await expect(page.locator("#C-document .ithread", { hasText: "Please expand this part." }).first()).toBeVisible({
      timeout: 15_000,
    });
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    type Reply = { kind?: string; who?: string; suggested?: boolean; blocks?: { text?: { standard?: string } }[] };
    const annotations = (snap.json as { annotations: { replies?: Reply[]; post: boolean }[] }).annotations;
    // The replayed Explain answer contributes an open question, offered
    // as an AI-suggested comment thread (#181): skip suggested threads
    // and match the user's own comment by its text.
    const comment = annotations.find((a) =>
      (a.replies ?? []).some(
        (r) =>
          r.kind === "comment" &&
          !r.suggested &&
          (r.blocks ?? []).some((b) => b.text?.standard?.includes("Please expand this part.")),
      ),
    );
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
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "replay", label: "l11doc2" });

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
  });
});

// ---------------------------------------------------------------------------
// Side panel (extension part 2): one thread, two repos, web group.
// ---------------------------------------------------------------------------

test.describe("L11 side panel over two repos", () => {
  let svc: RunningService | null = null;
  let context: BrowserContext | null = null;
  const dirs: string[] = [];
  const tmp = (p: string) => {
    const d = mkdtempSync(path.join(os.tmpdir(), p));
    dirs.push(d);
    return d;
  };

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const serviceDir = tmp("unvibe-l11panel-service-");
    const clientDir = tmp("unvibe-l11panel-client-");
    const makeRepo = async (dir: string, owner: string, name: string, file: string, body: string): Promise<void> => {
      mkdirSync(path.join(dir, "src"), { recursive: true });
      await git(dir, "init", "-b", "main");
      await git(dir, "config", "user.email", "t@example.com");
      await git(dir, "config", "user.name", "T");
      writeFileSync(path.join(dir, "src", file), body);
      await git(dir, "add", ".");
      await git(dir, "commit", "-m", "base");
      await git(dir, "remote", "add", "origin", `https://github.com/${owner}/${name}.git`);
    };
    await makeRepo(serviceDir, "acme", "service", "auth.ts", "export function validateToken(t: string) { return t.length > 3; }\n");
    await makeRepo(clientDir, "acme", "client", "api.ts", "export async function fetchSession() { return 1; }\n");
    const fakeBin = tmp("unvibe-l11panel-bin-");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    // No fake `gh` in this bin dir (retriever evidence only), so the
    // `fakeshell` convention cannot auto-detect it: confine explicitly.
    svc = await startOnExtensionPort(
      tmp("unvibe-l11panel-data-"),
      { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
      "l11panel",
      { testBinDir: fakeBin },
    );
    expect((await apiJson(svc, "POST", "/api/repos", { path: serviceDir })).status).toBe(200);
    expect((await apiJson(svc, "POST", "/api/repos", { path: clientDir })).status).toBe(200);
  });

  test.afterAll(async () => {
    await context?.close().catch(() => {});
    await svc?.stop().catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("settings extension, panel ask, documents web group", async ({ page }) => {
    if (!svc) throw new Error("no service");
    const PAGE_URL = "https://github.com/acme/service/issues/12";
    await page.goto(`${svc.origin}/settings?tab=extension&token=${svc.token}`);
    await expect(page.getByTestId("extension-show-folder")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("extension-path")).toContainText("extension");
    await expect(page.getByTestId("extension-steps")).toContainText("chrome://extensions");
    await expect(page.getByTestId("extension-status")).toContainText("Extension");
    // Active repo checkbox visible and checked by default (most recent).
    const boxes = page.locator('[data-testid^="extension-repo-"]');
    await expect(boxes.first()).toBeVisible();
    // Panel ask via the extension endpoint creates a web review.
    const asked = await apiJson(svc, "POST", "/api/extension/panel/ask", {
      url: PAGE_URL, title: "A page", selection: "", context: "page about validateToken",
      question: "Where is validateToken?",
    });
    expect(asked.status).toBe(200);
    // Never in Reviews (PRs and branches only, no toggle any more).
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("show-web-reviews")).toHaveCount(0);
    await expect(page.getByText("A page")).toHaveCount(0);
    // Visible under Documents, in its own Web pages group.
    await page.goto(`${svc.origin}/documents?token=${svc.token}`);
    const row = page.getByTestId("web-thread-row");
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText("A page");
    await expect(row).toContainText("github.com");
    await expect(row).toContainText("1 question");
    await expect(row).toContainText(/just now|ago/);
  });

  test("panel shows one thread and answers from two repos", async () => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const PAGE_URL = "https://github.com/acme/service/issues/12";
    const FIXTURE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Token check fails · Issue #12 · acme/service</title></head><body><main><h1>Token check fails</h1><p>Users report validateToken rejects valid sessions. The client calls fetchSession first.</p></main></body></html>`;
    const userDataDir = tmp("unvibe-l11panel-profile-");
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      // Playwright's default args carry --disable-extensions; loading the
      // unpacked extension requires dropping exactly that one.
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`],
    });
    await context.addCookies([{ name: "__unvibe_token", value: svc.token, url: svc.origin }]);
    await context.route("https://github.com/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML });
    });
    const page = await context.newPage();
    await cpuThrottleFromEnv(page);
    await page.goto(PAGE_URL);
    await expect(page.locator("h1")).toHaveText("Token check fails");

    // The manifest `key` pins this id (see shared extension.ts). Open the
    // exact side-panel page (headless Chromium cannot open the side-panel
    // chrome UI) — the worker, service and rendering are the real ones.
    const extId = "fmmhgmdbecooajgmpkmcclidchaekiko";
    const panel = await context.newPage();
    await cpuThrottleFromEnv(panel);
    const q = new URLSearchParams({ url: PAGE_URL, title: "Token check fails · Issue #12 · acme/service", selection: "validateToken rejects valid sessions", context: "validateToken fetchSession" });
    await panel.goto(`chrome-extension://${extId}/panel/panel.html?${q.toString()}`);
    await expect(panel.locator("#page-title")).toContainText("Token check fails", { timeout: 30_000 });
    await expect(panel.locator("#repos")).toContainText("acme/service", { timeout: 30_000 });
    await expect(panel.locator("#repos")).toContainText("acme/client");

    await panel.locator("#question").fill("How does validateToken work with fetchSession?");
    await panel.locator("#ask").click();
    await expect(panel.locator("#thread")).toContainText("acme/service", { timeout: 30_000 });
    await expect(panel.locator("#thread")).toContainText("acme/client");
    await expect(panel.locator("#thread")).toContainText("code:acme/service:src/auth.ts:1-1");
    await expect(panel.locator("#thread")).toContainText("code:acme/client:src/api.ts:1-1");
    await expect(panel.locator("#status")).toContainText("acme/service");
    await expect(panel.locator("#status")).toContainText("acme/client");

    // One thread per page: a second ask appends, it does not start over.
    await panel.locator("#question").fill("Where is validateToken?");
    await panel.locator("#ask").click();
    await expect(panel.locator("#thread .msg")).toHaveCount(4, { timeout: 30_000 });

    // Unknown extension origin is refused for panel endpoints too.
    const bad = await fetch(`${svc.origin}/api/extension/panel/active-repos`, {
      headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", authorization: `Bearer ${svc.token}` },
    });
    expect(bad.status).toBe(403);
  });
});
