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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

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

function writeFakeGh(binDir: string, poolDir: string): void {
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
    writeFakeGh(fakeBin, poolDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
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

  for (const combo of [
    { name: "1440-light", dark: false },
    { name: "1440-dark", dark: true },
  ] as const) {
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
