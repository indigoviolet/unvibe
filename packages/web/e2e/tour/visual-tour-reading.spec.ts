import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { hoverFresh } from "../hover-fresh.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { tourCombos } from "../tour-matrix.js";
import { parseBlocks } from "@unvibe/shared";
import {apiJson, createDemoReview, createScratchReview, createSeededDemoReview, git, makeScratchRepo, realGitPath, stampDataFormat, writeFakeGh, writeFakeGitOffline, writeFakeShell, fakeServicePath} from "../journeys/journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

// ---- glossary-tour (frames re-added) ----
let dataDir = "";
let svc: RunningService | null = null;
let reviewId = "";

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-glossary-tour-data-"));
  svc = await startService(dataDir, { agent: "replay" });
  const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
  reviewId = (created.json as { review: { id: string } }).review.id;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const s = snap.json as unknown as { glossary?: unknown[]; pages: { id: string; cards: { id: string }[] }[] };
    const root = s.pages.find((p) => p.id === "root");
    if ((s.glossary?.length ?? 0) >= 3 && root?.cards.some((c) => c.id === "central")) break;
    if (Date.now() > deadline) throw new Error("demo guide with glossary did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  for (const d of [dataDir]) rmSync(d, { recursive: true, force: true });
});

for (const combo of [{ name: "1440-light", width: 1440, dark: false }] as const) {
  test(`glossary tour (${combo.name})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    const suffix = combo.name;
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#C-central a.gx[data-glossary]").first()).toBeVisible({ timeout: 30_000 });
    await page.locator("#C-central").scrollIntoViewIfNeeded();
    await checkLayout(page, "glossary-links");
    await page.screenshot({ path: path.join(SHOTS, `glossary-links-${suffix}.png`) });
    const link = page.locator('#C-central a.gx[data-glossary="HTTPHeaderDict"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await hoverFresh(page, link);
    await expect(page.locator("#pop")).toContainText("response header mapping", { timeout: 30_000 });
    await expect(page.locator("#pop [data-src]")).toHaveCount(1);
    await checkLayout(page, "glossary-hover");
    await page.screenshot({ path: path.join(SHOTS, `glossary-hover-${suffix}.png`) });
  });
}


// ---- j20-critic-concepts-godeeper.spec.ts (frames re-added) ----
/** J20 (#215/#216/#217): one critic job, concept pages on open, auto go-deeper — real service, replay. */


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

      // Findings show in the guide; open a go-deeper card (issue #341:
      // the re-recorded reader's pending cards are g-alt/g-regex/
      // g-tests/g-reach). It stays collapsed until opened (#217);
      // opening shows the written content instantly and starts no job.
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const gdCard = page.locator("#C-g-alt");
      await gdCard.scrollIntoViewIfNeeded();
      await expect(gdCard).toHaveClass(/collapsed/);
      await expect(gdCard.locator(".why")).toContainText("rewriting the http.client message");
      await expect(gdCard).not.toContainText("delete and re-add");
      await gdCard.getByRole("button", { name: "Expand" }).click();
      await expect(gdCard).toContainText("delete and re-add", { timeout: 10_000 });
      await page.screenshot({ path: "test-results/j20-godeeper-opened.png", fullPage: true });
      expect((await jobs(svc, reviewId)).filter((j) => j.kind === "go-deeper")).toHaveLength(gdJobsBefore);
      // The bare-LF finding page renders directly (issue #341: no guide
      // card links findings anymore, so navigate to the page itself).
      await page.goto(`${svc.origin}/review/${reviewId}/page/f-critic-2?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Bare-LF", { timeout: 60_000 });

      // #216: opening a concept page writes it, then shows it (issue #341:
      // the re-recorded guide carries no concept links, so fire the
      // concept action for obs-fold via API, then open the page).
      const acted = await apiJson(svc, "POST", `/api/reviews/${reviewId}/actions`, {
        kind: "concept",
        slug: "obs-fold",
      });
      if (acted.status !== 200) throw new Error(`concept action failed: ${acted.status}`);
      await page.goto(`${svc.origin}/review/${reviewId}/page/c-obs-fold?token=${svc.token}`);
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


// ---- j306-select-popup-zindex.spec.ts (frames re-added) ----
/** J306 (#306): every shared select popup paints above cards.
 *
 * The shared Select's popup portal and the #297 author combobox both
 * render `.ui-select-popup` in a body-level portal, while `main` is a
 * stacking context (`z-index: 1`): without a z-index on the positioner
 * the popup asserts present but paints under the card below it. This
 * journey opens each select that uses the shared popup over a card and
 * asserts the popup is the topmost element at its own centre
 * (`elementsFromPoint`), with a card underneath it in the same stack.
 * Frames land in visual-tour/ for the owner to look at.
 */



interface FakePr {
  number: number;
  title: string;
  author: { login: string };
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  reviewRequests: { login?: string; slug?: string }[];
  state: string;
  isDraft: boolean;
}

function pr(n: number, title: string, author: string): FakePr {
  return {
    number: n,
    title,
    author: { login: author },
    updatedAt: new Date().toISOString(),
    headRefName: `ask-branch-${n}`,
    additions: 10 + n,
    deletions: n,
    changedFiles: 2,
    url: `https://github.com/acme/widgets/pull/${n}`,
    reviewRequests: [],
    state: "OPEN",
    isDraft: false,
  };
}

const DIRECT: FakePr[] = [
  pr(301, "Review ask 301", "alice"),
  pr(302, "Review ask 302", "bob"),
  pr(303, "Review ask 303", "alice"),
  pr(304, "Review ask 304", "bob"),
];
const AUTHORING: FakePr[] = [pr(101, "My folded-header PR", "you")];

function toNode(p: FakePr): unknown {
  return {
    __typename: "PullRequest",
    number: p.number,
    title: p.title,
    author: p.author,
    updatedAt: p.updatedAt,
    headRefName: p.headRefName,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    url: p.url,
    state: p.state,
    isDraft: p.isDraft,
    reviewRequests: { nodes: p.reviewRequests.map((r) => ({ requestedReviewer: r })) },
    latestReviews: { nodes: [] },
  };
}

function searchPage(rows: FakePr[]): string {
  return JSON.stringify({
    data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: rows.map(toNode) } },
  });
}

function writeFakeGhSelect(binDir: string, poolDir: string): void {
  writeFileSync(path.join(poolDir, "authoring.json"), searchPage(AUTHORING));
  writeFileSync(path.join(poolDir, "direct.json"), searchPage(DIRECT));
  writeFileSync(path.join(poolDir, "team.json"), searchPage(DIRECT));
  const script = `#!/bin/sh
POOL="${poolDir}"
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *"author:@me"*) cat "$POOL/authoring.json" ;;
    *"author:"*) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}' ;;
    *"user-review-requested:@me"*) cat "$POOL/direct.json" ;;
    *"review-requested:@me"*) cat "$POOL/team.json" ;;
    *) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}' ;;
  esac
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"reviewer"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as reviewer"; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/**
 * The popup at its centre: the topmost hit must be inside the popup.
 * With `overCard`, the same point's stack must also reach a card below
 * it — the popup opened over a card, not over bare page. The repo
 * picker sits in the page heading, so only its in-card siblings get
 * the over-card half.
 */
async function expectPopupTopmostOverCard(
  page: Page,
  what: string,
  overCard = true,
): Promise<void> {
  const popup = openPopup(page);
  await expect(popup, `${what}: popup is open`).toBeVisible({ timeout: 15_000 });
  const box = await popup.boundingBox();
  expect(box, `${what}: popup has a box`).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const probe = await page.evaluate(
    ([x, y]: readonly [number, number]) => {
      const els = document.elementsFromPoint(x, y);
      const first = els[0];
      return {
        topInPopup: first ? first.closest(".ui-select-popup") !== null : false,
        topDesc: first ? `${first.tagName}.${String(first.className).slice(0, 60)}` : "none",
        overCard: els.some(
          (e) => e.classList.contains("ui-card") || e.getAttribute("data-testid") === "pr-block",
        ),
        stack: els.slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`),
      };
    },
    [cx, cy] as const,
  );
  if (overCard) {
    expect(
      probe.overCard,
      `${what}: popup centre stack reaches a card (stack: ${probe.stack.join(" | ")})`,
    ).toBe(true);
  }
  expect(
    probe.topInPopup,
    `${what}: popup is topmost at its centre (top: ${probe.topDesc}; stack: ${probe.stack.join(" | ")})`,
  ).toBe(true);
}

async function closePopup(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(openPopup(page)).toHaveCount(0, { timeout: 10_000 });
}

test.describe("J306 select popup z-index", () => {
  let repoDir = "";
  let dataDir = "";
  let poolDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j306-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j306-data-"));
    poolDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j306-pool-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j306-bin-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    writeFakeGhSelect(fakeBin, poolDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, poolDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of tourCombos("selectPopup", [
    { name: "1440-light", dark: false },
    { name: "1440-dark", dark: true },
  ] as const)) {
    test(`select popups paint above cards (${combo.name})`, async ({ page }) => {
      test.setTimeout(180_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("unvibe.start.repoId", id);
        } catch {
          // Start page falls back to no selection; asserts below fail.
        }
      }, repoId);
      await page.goto(`${svc.origin}/?token=${svc.token}`);
      const prBlock = page.getByTestId("pr-block");
      await expect(prBlock.getByText("Review ask 301")).toBeVisible({ timeout: 30_000 });

      // Repo picker (shared Select): its popup drops over the PR card.
      await page.getByLabel("Repo", { exact: true }).click();
      await expectPopupTopmostOverCard(page, "repo picker", false);
      await page.screenshot({ path: `${SHOTS}/select-popup-repo-${combo.name}.png` });
      await closePopup(page);

      // Recency (shared Select) inside the PR card toolbar.
      await page.getByLabel("Updated within", { exact: true }).click();
      await expectPopupTopmostOverCard(page, "recency select");
      await page.screenshot({ path: `${SHOTS}/select-popup-recency-${combo.name}.png` });
      await closePopup(page);

      // Author combobox: same shared popup classes, its own positioner.
      await page.getByLabel("Author", { exact: true }).click();
      await expectPopupTopmostOverCard(page, "author combobox");
      await page.screenshot({ path: `${SHOTS}/select-popup-author-${combo.name}.png` });
      await closePopup(page);

      // Settings model + effort pickers (shared Select) inside a card.
      await page.goto(`${svc.origin}/settings?token=${svc.token}`);
      await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Models" }).click();
      await expect(page.locator("#model-main")).toBeVisible({ timeout: 30_000 });
      await page.locator("#prov-main").click();
      await expectPopupTopmostOverCard(page, "settings provider select");
      await closePopup(page);
      await page.locator("#model-main").click();
      await expectPopupTopmostOverCard(page, "settings model select");
      await page.screenshot({ path: `${SHOTS}/select-popup-settings-model-${combo.name}.png` });
      await closePopup(page);
      await page.locator("#effort-main").click();
      await expectPopupTopmostOverCard(page, "settings effort select");
      await closePopup(page);

      // Settings theme picker (shared Select) on Appearance.
      await page.getByRole("tab", { name: "Appearance" }).click();
      const themeSelect = page.locator('[data-testid="ui-theme"]');
      await expect(themeSelect).toBeVisible({ timeout: 15_000 });
      await themeSelect.click();
      await expectPopupTopmostOverCard(page, "settings theme select");
      await closePopup(page);
    });
  }
});


// ---- j314-loose-lists.spec.ts (frames re-added) ----
/** J314 (#314): a loose numbered list renders as one <ol> numbered 1-4. */



test.describe("J314 loose numbered lists", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  const reviewId = "j314-seed";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j314-data-"));
    createSeededDemoReview(dataDir, reviewId);
    // Append a guide card whose body is a loose numbered list, parsed by
    // the real parser: blank lines between items must not split the list.
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as {
        snapshot: string;
      };
      const snapshot = JSON.parse(row.snapshot) as {
        pages: { id: string; cards: unknown[] }[];
      };
      const root = snapshot.pages.find((p) => p.id === "root");
      if (!root) throw new Error("seeded snapshot has no root page");
      root.cards.push({
        id: "loose-lists",
        pageId: "root",
        title: "Loose list",
        blocks: parseBlocks("1. First step\n\n2. Second step\n\n3. Third step\n\n4. Fourth step\n"),
        level: "standard",
        revision: 1,
        undoStack: [],
        collapsed: false,
      });
      db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(
        JSON.stringify(snapshot),
        reviewId,
      );
      // Raw-SQL seeds bypass the service's stamp-on-create (#311).
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a loose numbered list is one <ol> with items 1-4", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const card = page.locator("#C-loose-lists");
    await expect(card).toBeVisible({ timeout: 60_000 });

    // One <ol> (the bug made four, each rendering "1."), with four items.
    const lists = card.locator("ol.lst");
    await expect(lists).toHaveCount(1);
    const items = lists.first().locator(":scope > li");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("First step");
    await expect(items.nth(3)).toContainText("Fourth step");

    // No start override: native <ol> numbering renders these 1-4 (the
    // bug made four separate lists, each rendering "1.").
    await expect(lists.first()).not.toHaveAttribute("start", /./);

    await card.screenshot({ path: path.join(SHOTS, "loose-list.png") });
  });
});


// ---- j81-code-citations.spec.ts (frames re-added) ----
/** J81: `code:` citations outside the diff — hover, file tab, comment. */


test.describe("J81 code citations outside the diff", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  // Stubbed `gh` only (AGENTS.md: tests never hit real GitHub).
  async function start(): Promise<RunningService> {
    const fakeShell = writeFakeShell(fakeBin);
    return startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
    });
  }

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 1\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 2\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    // Issue #332: a file whose path carries route-group parens and a
    // dynamic-segment bracket pair (Next.js-style, contents arbitrary).
    const pageFile = path.join(repoDir, "src", "app", "(group)", "items", "[id]", "page.tsx");
    mkdirSync(path.dirname(pageFile), { recursive: true });
    writeFileSync(
      pageFile,
      "export default function Page({ params }: { params: { id: string } }) {\n  return <h1>Item {params.id}</h1>;\n}\n",
    );
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "route with group and segment");
    const headSha = (await git(repoDir, "rev-parse", "HEAD")).trim();
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-bin-"));
    writeFakeGh(fakeBin, logDir, headSha);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-data-"));
    svc = await start();
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  test("hover previews, click opens a closable file tab, selection comments on the code host", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Wait for the ingest to really land (head SHA present, ingest
    // ready, no active jobs) before seeding: stopping over a snapshot
    // that still says "loading" lets boot recovery re-ingest on the
    // restart and replace the seeded guide with an empty one.
    type SnapProbe = {
      version: { headSha: string };
      files: { path: string }[];
      ingest?: { status: string };
      jobs?: { state: string }[];
      pages: { id: string; cards: { id: string }[] }[];
    };
    let before: SnapProbe | null = null;
    const settleDeadline = Date.now() + 90_000;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const snap = res.json as unknown as SnapProbe;
      const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
      if (snap.version.headSha !== "" && snap.ingest?.status === "ready" && !active) {
        before = snap;
        break;
      }
      if (Date.now() > settleDeadline) throw new Error("scratch ingest did not settle");
      await new Promise((r) => setTimeout(r, 250));
    }
    const head = before.version.headSha;
    expect(before.files.some((f) => f.path === "helper.py")).toBe(false);

    // Seed guide cards: a verified outside-diff citation, a past-the-end
    // one (valid under #81: no length check), and a missing file.
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; cards: unknown[] }[];
        pipeline?: { stages: Record<string, string> };
        ingest?: { status: string };
      };
      // Keep boot recovery from re-ingesting over the seed.
      snap.ingest = { status: "ready" };
      snap.pipeline = {
        stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" },
      };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guide", cards: [] };
        snap.pages.unshift(root);
      }
      const card = (id: string, text: string, target: string, unverified?: boolean): unknown => ({
        id,
        pageId: "root",
        title: id,
        level: "standard",
        collapsed: false,
        revision: 1,
        blocks: [
          {
            type: "paragraph",
            id: `b-${id}`,
            text: { standard: text },
            citations: [{ target, ...(unverified ? { unverified: true } : {}) }],
          },
        ],
        undoStack: [],
      });
      root.cards.push(
        card("c-beta", "Uses the helper beta value.", `code:helper.py:2@${head}`),
        card("c-past", "Cites past the end.", `code:helper.py:2-99@${head}`),
        card("c-missing", "Cites a missing file.", `code:nope.py:1@${head}`, true),
        // Issue #332: a bracket-path file outside the diff renders a
        // working chip that opens the file tab.
        card(
          "c-brackets",
          "Route group page shows the item.",
          `code:src/app/(group)/items/[id]/page.tsx:2@${head}`,
        ),
      );
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        reviewId,
      );
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await start();

    // The restarted service must actually serve the seeded guide
    // before the browser opens it (poll the served state, not a timer).
    await expect
      .poll(
        async () => {
          const res = await apiJson(svc as RunningService, "GET", `/api/reviews/${reviewId}`);
          const snap = res.json as unknown as SnapProbe;
          return snap.pages.some((p) => p.cards.some((c) => c.id === "c-beta"));
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });
    // Past-the-end is verified now; a missing file gets no marker at all
    // (#264): the surrounding text stays plain text.
    await expect(page.locator("#C-c-past .lk.unverified")).toHaveCount(0);
    await expect(page.locator("#C-c-missing .lk.unverified")).toHaveCount(0);
    await expect(page.locator("#C-c-missing .lk")).toHaveCount(0);
    await expect(page.locator("#C-c-missing")).toContainText("Cites a missing file.");

    // Hover previews the cited lines at the commit.
    await page.locator("#C-c-beta .lk[data-refs]").hover();
    await expect(page.locator("#pop")).toContainText("beta = 2", { timeout: 30_000 });

    // Click opens the file tab at the cited lines.
    await page.locator("#C-c-beta .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "helper.py" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("beta = 2");
    await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);

    // A past-the-end citation reuses the same tab and clamps the highlight.
    await page.locator("#C-c-past .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "helper.py" })).toHaveCount(1);
    await expect(page.locator('.codefile [data-code-line="3"]')).toHaveClass(/cited/);

    // Selecting cited text and commenting anchors to the code host.
    await page.evaluate(() => {
      const row = document.querySelector('.codefile [data-code-line="2"] .cf-c');
      if (!row?.firstChild) throw new Error("no cited row");
      const range = document.createRange();
      range.setStart(row.firstChild, 0);
      range.setEnd(row.firstChild, 4);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator("#selbar")).toBeVisible({ timeout: 30_000 });
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator(".codefile textarea");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Is beta still the right default?");
    await page.locator(".codefile").getByRole("button", { name: "Save", exact: true }).click();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as unknown as { annotations: { type: string; anchor: { host: { kind: string; path?: string } }; replies?: { kind?: string }[] }[] }).annotations;
      const thread = anns.find((a) => a.type === "thread" && a.anchor.host.kind === "code" && (a.replies ?? []).some((r) => r.kind === "comment"));
      if (thread) {
        expect(thread.anchor.host.path).toBe("helper.py");
        break;
      }
      if (Date.now() > deadline) throw new Error("code-host comment not stored");
      await new Promise((r) => setTimeout(r, 250));
    }
    await expect(page.locator(".codefile")).toContainText("Is beta still the right default?", { timeout: 30_000 });

    // The tab closes; the Diff tab remains.
    await page.getByRole("button", { name: "Close helper.py" }).click();
    await expect(page.locator(".codefile")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Diff" })).toBeVisible();
  });

  test("bracket-path citation renders a chip and opens the file tab (issue #332)", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-c-brackets")).toContainText("Route group page shows the item.", {
      timeout: 60_000,
    });

    // A chip, not raw [[code:…]] text, and verified (no unverified marker).
    const chip = page.locator("#C-c-brackets .lk[data-refs]");
    await expect(chip).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#C-c-brackets .lk.unverified")).toHaveCount(0);
    await expect(page.locator("#C-c-brackets")).not.toContainText("[[code:");

    // Hover previews the cited line; the frame goes to /tmp for the report.
    await chip.hover();
    await expect(page.locator("#pop")).toContainText("Item", { timeout: 30_000 });
    await page.locator("#C-c-brackets").screenshot({ path: "../../visual-tour/bracket-chip-1440-light.png" });

    // Click opens the file tab at the cited line.
    await chip.click();
    await expect(page.getByRole("tab", { name: "page.tsx" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("Item");
    await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);
  });
});
