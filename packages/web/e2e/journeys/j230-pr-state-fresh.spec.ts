/**
 * J230 (#230): refreshing a review updates its PR state with no new commits.
 *
 * Fake `gh` flips state + decision (OPEN + REVIEW_REQUIRED → MERGED +
 * APPROVED) with the same head SHA. The review bar and the Reviews list
 * both change after the refresh button — the steady-head `prChanged`
 * path in `versions/refresh.ts`, surfaced through the snapshot (bar)
 * and the summary (list). No new commits, no agent jobs.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { checkLayout } from "../layout-check.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Fake `gh`: first view OPEN + REVIEW_REQUIRED (shows as no decision, #230), later views MERGED + APPROVED. Same head. */
function writeFakeGhFlip(binDir: string, logDir: string, headSha: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  COUNT=$(ls "$LOG"/view-* 2>/dev/null | wc -l)
  touch "$LOG/view-$COUNT"
  if [ "$COUNT" -ge 2 ]; then
    cat <<EOF
{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  else
    cat <<EOF
{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  fi
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J230 refresh updates PR state with no new commits", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j230-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j230-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j230-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j230-bin-"));
    writeFakeGhFlip(fakeBin, logDir, repo.headSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("refresh button flips the bar and the Reviews list (no new commits)", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");

    // Reviews list first: OPEN with no decision shows no badges (#230:
    // REVIEW_REQUIRED never shows; #234: open has no icon).
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const row = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('[data-testid="pr-badges"]')).toHaveCount(0);

    // Review bar starts the same way.
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#reviewbar [data-testid="pr-badges"]')).toHaveCount(0);
    const bar = page.locator("#reviewbar");

    // The refresh button: same head, new state — no new version, no banner.
    // #241: Refresh lives in the review top bar now, next to the status icon.
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh" }).click();
    // #245: the status icons sit INSIDE the GitHub link box, after owner/repo#N.
    const barLink = bar.locator('a[title="Open PR on GitHub"]');
    await expect(barLink.getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
    await expect(barLink.getByRole("img", { name: "Approved" })).toBeVisible();
    await expect(bar).not.toContainText("Merged");
    await expect(bar).not.toContainText("Approved");
    // No sibling badges in the row — the icons live inside the link.
    await expect(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
    // The icon keeps its shared tooltip inside the link.
    await barLink.getByRole("img", { name: "Merged" }).hover({ timeout: 15_000 });
    await expect(page.locator("#tip")).toContainText("Merged", { timeout: 15_000 });

    // #239: home, GitHub link (when present), Refresh and Debug all line
    // up on the bottom (within 1–2px) on a PR with a status icon (merged
    // here, not open). #244: the link is boxed with the shared Button
    // styling, like the Comments button — same height, bottoms within
    // 2px. #245: the icon is inside the link, so it is not a separate
    // bottom — its centre sits on the bar's centre line instead.
    const bottoms = await page.evaluate(() => {
      const barEl = document.getElementById("reviewbar");
      if (!barEl) return null;
      const pick = (sel: string): Element | null => barEl.querySelector(sel);
      const els: Element[] = [
        pick('a[aria-label="Back to the start page"]'),
        pick('a[title="Open PR on GitHub"]'),
        pick('button[aria-label="Refresh"]'),
        pick('a[aria-label="Debug"]'),
      ].filter((el): el is Element => el !== null);
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
        return { label, bottom: r.bottom, height: r.height };
      });
    });
    expect(bottoms).not.toBeNull();
    expect(bottoms!.length).toBeGreaterThanOrEqual(4);
    const bs = bottoms!.map((b) => b.bottom);
    expect(
      Math.max(...bs) - Math.min(...bs),
      `review bar bottoms misaligned: ${JSON.stringify(bottoms)}`,
    ).toBeLessThanOrEqual(2);
    const iconMid = await page.evaluate(() => {
      const barEl = document.getElementById("reviewbar");
      const link = barEl?.querySelector('a[title="Open PR on GitHub"]');
      const icon = link?.querySelector('[data-testid="pr-badges"] [role="img"]');
      const lr = link?.getBoundingClientRect();
      const ir = icon?.getBoundingClientRect();
      if (!lr || !ir) return null;
      return { linkMid: lr.top + lr.height / 2, iconMid: ir.top + ir.height / 2 };
    });
    expect(iconMid).not.toBeNull();
    expect(
      Math.abs(iconMid!.iconMid - iconMid!.linkMid),
      `icon not centred in link: ${JSON.stringify(iconMid)}`,
    ).toBeLessThanOrEqual(1);
    // #244: the boxed link matches the Comments button height.
    const heights = await page.evaluate(() => {
      const barEl = document.getElementById("reviewbar");
      if (!barEl) return null;
      const link = barEl.querySelector('a[title="Open PR on GitHub"]');
      const comments = barEl.querySelector('[data-cm=""]');
      if (!link || !comments) return null;
      return {
        link: link.getBoundingClientRect().height,
        comments: comments.getBoundingClientRect().height,
      };
    });
    expect(heights).not.toBeNull();
    expect(
      Math.abs(heights!.link - heights!.comments),
      `boxed link height ${heights!.link} != Comments height ${heights!.comments}`,
    ).toBeLessThanOrEqual(1);
    await checkLayout(page, "j230-bar");

    // The stored review moved too: the API summary carries the new state.
    const summary = await apiJson(svc, "GET", "/api/reviews");
    const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string }[] }).reviews.find(
      (r) => r.id === reviewId,
    );
    expect(found?.prState).toBe("merged");
    expect(found?.reviewDecision).toBe("approved");

    // And the Reviews list shows it after returning to the start page.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const rowAfter = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(rowAfter).toBeVisible({ timeout: 30_000 });
    await expect(rowAfter.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
    await expect(rowAfter.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Approved" })).toBeVisible();

    // No extra gh calls beyond the two views (ingest + refresh): the pr
    // list was never fetched, no polling on open.
    const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
    const views = calls.split("\n").filter((l) => l.includes("pr view")).length;
    expect(views).toBeLessThanOrEqual(3);
  });
});
