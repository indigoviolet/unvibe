/**
 * J245 (#245): the review bar on a PR review with the boxed GitHub link
 * and a status icon inside it — one frame per theme, kept for review.
 *
 * Fake `gh` reports OPEN + APPROVED (open has no state icon, so the bar
 * shows the single Approved icon inside the link box). The scratch repo
 * carries a long `origin` remote
 * (`example-org/a-fairly-long-repository-name`), so the link reads
 * `example-org/a-fairly-long-repository-name#7502`: the box must grow to
 * fit the text without clipping or overflowing the bar, and the icon
 * must still sit inside, after the number. Every control is one height
 * and centred, with `checkLayout` on each frame — against the real
 * service, no agent.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { checkLayout } from "../layout-check.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

const LONG_OWNER = "example-org";
const LONG_NAME = "a-fairly-long-repository-name";
const PR_NUMBER = 7502;
const SHORT = `${LONG_OWNER}/${LONG_NAME}#${PR_NUMBER}`;

/** Fake `gh`: OPEN + APPROVED with the call-time feature head, so the bar shows one icon. */
function writeFakeGhApproved(binDir: string, logDir: string, repoDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  HEAD=$(git -C "${repoDir}" rev-parse feature 2>/dev/null || echo "unknown")
  cat <<EOF
{"title":"Long name PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"$HEAD"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/*/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J245 PR review bar frames (boxed link, icon inside)", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-repo-"));
    await makeScratchRepo(repoDir);
    // Long repo identity comes from the origin remote (deriveIdentity).
    await git(repoDir, "remote", "add", "origin", `https://github.com/${LONG_OWNER}/${LONG_NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-bin-"));
    writeFakeGhApproved(fakeBin, logDir, repoDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: PR_NUMBER });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of [
    { theme: "studio", scheme: "light", dark: false },
    { theme: "default", scheme: "light", dark: false },
    { theme: "console", scheme: "dark", dark: true },
  ] as const) {
    test(`PR bar with icon inside the link (${combo.theme} ${combo.scheme}, #245)`, async ({ page }) => {
      test.setTimeout(240_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      // Theme is server-side truth; mirror it locally like Settings → Appearance does.
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

      // The long boxed link with the single Approved icon inside it.
      const bar = page.locator("#reviewbar");
      const link = bar.locator('a[title="Open PR on GitHub"]');
      await expect(link).toContainText(SHORT, { timeout: 15_000 });
      // Moved from start-lists.spec.ts (#258): the label links to the PR
      // without opening the review.
      await expect(link).toHaveAttribute(
        "href",
        `https://github.com/${LONG_OWNER}/${LONG_NAME}/pull/${PR_NUMBER}`,
      );
      await expect(link).toHaveAttribute("target", "_blank");
      const badges = link.locator('[data-testid="pr-badges"]');
      await expect(badges.getByRole("img", { name: "Approved" })).toBeVisible();
      await expect(badges.getByRole("img", { name: "Open" })).toHaveCount(0);
      // No sibling badges in the row — the icon lives inside the link.
      await expect(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
      // The icon keeps its shared tooltip inside the link.
      await badges.getByRole("img", { name: "Approved" }).hover({ timeout: 15_000 });
      await expect(page.locator("#tip")).toContainText("Approved", { timeout: 15_000 });

      // Every control is one height and centred on one line (#245).
      const boxes = await bar.evaluate((el) => {
        const sels: [string, string][] = [
          ["home", 'a[aria-label="Back to the start page"]'],
          ["github", 'a[title="Open PR on GitHub"]'],
          ["refresh", 'button[aria-label="Refresh"]'],
          ["version", '[data-testid="version-switcher"] .ui-select'],
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
      expect(boxes.map((b) => b.name)).toEqual(expect.arrayContaining(["home", "github", "refresh", "panes", "comments", "submit"]));
      const h = boxes[0].height;
      for (const b of boxes) expect(Math.abs(b.height - h), `${b.name} height ${b.height} vs ${h}`).toBeLessThanOrEqual(1);
      const mids = boxes.map((b) => b.mid);
      expect(Math.max(...mids) - Math.min(...mids), JSON.stringify(boxes)).toBeLessThanOrEqual(1);

      // The long box grows to fit the text: no clipping in the link, no
      // overflow of the bar, and the icon sits inside the link, after the number.
      const fit = await bar.evaluate((el) => {
        const barEl = el;
        const linkEl = barEl.querySelector('a[title="Open PR on GitHub"]');
        const iconEl = linkEl?.querySelector('[data-testid="pr-badges"] [role="img"]');
        if (!linkEl) return null;
        const lr = linkEl.getBoundingClientRect();
        const ir = iconEl?.getBoundingClientRect() ?? null;
        return {
          linkClip: linkEl.scrollWidth - linkEl.clientWidth,
          barOverflow: barEl.scrollWidth - barEl.clientWidth,
          link: { left: lr.left, right: lr.right, height: lr.height, mid: lr.top + lr.height / 2 },
          icon: ir ? { left: ir.left, right: ir.right, mid: ir.top + ir.height / 2 } : null,
        };
      });
      expect(fit).not.toBeNull();
      expect(fit!.linkClip, "link text clipped").toBeLessThanOrEqual(1);
      expect(fit!.barOverflow, "bar overflows").toBeLessThanOrEqual(1);
      expect(fit!.icon).not.toBeNull();
      expect(fit!.icon!.left, "icon left of link text").toBeGreaterThanOrEqual(fit!.link.left - 1);
      expect(fit!.icon!.right, "icon outside link box").toBeLessThanOrEqual(fit!.link.right + 1);
      expect(Math.abs(fit!.icon!.mid - mids[0]), "icon not on the centre line").toBeLessThanOrEqual(1);

      await checkLayout(page, `reviewbar-pr-${combo.theme}-${combo.scheme}`);
      await bar.screenshot({ path: path.join(SHOTS, `reviewbar-pr-${combo.theme}-${combo.scheme}.png`) });
    });
  }
});
