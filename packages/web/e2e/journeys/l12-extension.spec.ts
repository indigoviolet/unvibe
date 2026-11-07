/**
 * L12 — Extension button (#363 package D).
 *
 * The unpacked Chrome extension on a local GitHub PR fixture (never
 * real GitHub): the button appears and clicking it makes the worker
 * call the create-or-open endpoint itself, landing on the review with
 * no confirm page; a plain `/open?pr=…` link keeps the styled in-app
 * confirm and creates nothing until confirmed (targeted CSRF check:
 * a cross-site link clones/creates nothing; a foreign POST is refused);
 * the token cookie drives the worker's lookup; no page request leaves
 * a non-local origin; an unknown extension origin is refused while the
 * pinned one is not; the Conversation header keeps exactly one button
 * across Turbo-style tab swaps (#333, brand look intact, fails quietly
 * with no header and recovers).
 *
 * Boots: ONE agent:none service on a candidate port over a scratch repo
 * (stub `gh` + offline git), plus persistent Chromium contexts with
 * `--load-extension` for the button and conversation-header flows.
 *
 * Absorbs: `extension-322.spec.ts` (both tests) and the button half of
 * `j322-extension.spec.ts` (the smoke halves live in L11's panel flow).
 *
 * Guards kept: #322 (button starts the review, confirm flow intact);
 * #333 (one conversation button, no duplicates, quiet failure);
 * extension origin + token gate (403 on unknown origin for pr-status,
 * open and the create-or-open endpoint; pinned origin allowed);
 * network privacy (github.com routed locally, no non-local page
 * request; failures equal []).
 *
 * Frames removed (tour owns them; package D re-adds in
 * `e2e/tour/visual-tour-system.spec.ts`): the button close-up, the
 * 1440-light open-confirm frame and the conversation-header frame.
 *
 * Brittleness fixed here (#363 §4): the `waitForTimeout(800)` no-header
 * settle (B2 — the removal is a mutation-observer state: poll
 * `toHaveCount(0)` with a timeout instead of sleeping a fixed window).
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

const EXTENSION_DIR = fileURLToPath(new URL("../../../../extension", import.meta.url));
const OWNER = "acme";
const NAME = "app";
const PR_NUMBER = 7;
const PR_URL = `https://github.com/${OWNER}/${NAME}/pull/${PR_NUMBER}`;
// Ports the extension worker probes (see extension/background.js).
const CANDIDATE_PORTS = [4517, 4518, 4519, 4520, 4521];

const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fix the thing · Pull Request #${PR_NUMBER} · ${OWNER}/${NAME}</title>
<style>body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:24px;color:#1f2328}
.gh-header{border-bottom:1px solid #d1d9e0;padding-bottom:16px}.gh-header-title{font-size:28px;font-weight:400}
.gh-header-actions{display:inline-block;margin-left:12px}.gh-header-meta{color:#59636e;margin-top:8px}
button{font:inherit}</style></head>
<body>
<div class="gh-header">
  <div class="gh-header-show"><h1 class="gh-header-title">Fix the thing <span>#${PR_NUMBER}</span></h1></div>
  <div class="gh-header-actions"><button type="button">Review changes</button> <button type="button">Code</button></div>
  <div class="gh-header-meta"><strong>author</strong> wants to merge 1 commit into <code>main</code> from <code>feature</code></div>
</div>
<main><p>Fixture PR body. Served locally; github.com is routed here.</p></main>
</body></html>`;

// #333: the Conversation header shape — the PR title with the Merge
// status / Code buttons beside it, none of the classic `.gh-header-*`
// hooks. Structure only (own class names plus a data attribute, an
// ARIA group label, and the "Code" button text the content script keys
// off); the shared style block also covers the classic shape so
// Turbo-style in-page swaps between the two stay styled.
const CONVERSATION_STYLE = `body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:0;color:#1f2328;background:#fff}
.pr-conversation-header{border-bottom:1px solid #d1d9e0;padding:16px 24px}
.pr-title-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pr-title{font-size:28px;font-weight:400;margin:0}
.pr-title-actions{display:inline-flex;gap:8px;margin-left:auto}
.pr-title-actions button{font:inherit;font-size:12px;font-weight:500;height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(31,35,40,.15);background:#f6f8fa;color:#1f2328;cursor:pointer}
.pr-meta{color:#59636e;margin-top:8px}
.gh-header{border-bottom:1px solid #d1d9e0;padding-bottom:16px;margin:24px 24px 0}.gh-header-title{font-size:28px;font-weight:400}
.gh-header-actions{display:inline-block;margin-left:12px}.gh-header-meta{color:#59636e;margin-top:8px}
button{font:inherit}
@media (prefers-color-scheme: dark){
body{background:#0d1117;color:#e6edf3}
.pr-conversation-header{border-color:#30363d}
.pr-title-actions button{background:#21262d;color:#e6edf3;border-color:rgba(240,246,252,.1)}
.pr-meta{color:#9198a1}
.gh-header{border-color:#30363d}.gh-header-meta{color:#9198a1}
}`;

const CONVERSATION_BODY = `<header class="pr-conversation-header">
  <div class="pr-title-row">
    <h1 class="pr-title">Fix the thing <span>#${PR_NUMBER}</span></h1>
    <div class="pr-title-actions" data-testid="pr-conversation-header-actions" role="group" aria-label="Pull request header actions"><button type="button">Merge status</button> <button type="button">Code</button></div>
  </div>
  <div class="pr-meta"><strong>author</strong> wants to merge 1 commit into <code>main</code> from <code>feature</code></div>
</header>
<main><p>Fixture PR body. Served locally; github.com is routed here.</p></main>`;

const CONVERSATION_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fix the thing · Pull Request #${PR_NUMBER} · ${OWNER}/${NAME}</title>
<style>${CONVERSATION_STYLE}</style></head>
<body>
${CONVERSATION_BODY}
</body></html>`;

// Classic Files-tab header body for the in-page tab-swap step.
const CLASSIC_SWAP_BODY = `<div class="gh-header">
  <div class="gh-header-show"><h1 class="gh-header-title">Fix the thing <span>#${PR_NUMBER}</span></h1></div>
  <div class="gh-header-actions"><button type="button">Review changes</button> <button type="button">Code</button></div>
  <div class="gh-header-meta"><strong>author</strong> wants to merge 1 commit into <code>main</code> from <code>feature</code></div>
</div>
<main><p>Fixture PR body. Served locally; github.com is routed here.</p></main>`;

function writeFakeGh(binDir: string, logDir: string, repoDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  HEAD=$(git -C "${repoDir}" rev-parse feature 2>/dev/null || echo "unknown")
  cat <<EOF
{"title":"Fix the thing","body":"Fixture PR body.","author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"$HEAD"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
case "$*" in *pulls/*/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

async function freeCandidatePort(): Promise<number> {
  for (const port of CANDIDATE_PORTS) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("no free extension candidate port (4517-4521)");
}

// The extension flows drive their own contexts; each created page gets the
// shared throttle hook (one throttled core in `test:affected`, #363 §6).

test.describe("L12 extension PR button", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let context: BrowserContext | null = null;
  let userDataDir = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "remote", "add", "origin", `https://github.com/${OWNER}/${NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-bin-"));
    writeFakeGh(fakeBin, logDir, repoDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, {
      mode: 0o755,
    });
    const port = await freeCandidatePort();
    svc = await startService(dataDir, {
      agent: "none",
      port: String(port),
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      label: "l12ext",
    });
    // Known repo, but no review for the PR yet.
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(repos.status).toBe(200);
  });

  test.afterAll(async () => {
    await context?.close().catch(() => {});
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin, userDataDir]) {
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  test("button starts the review directly; plain links keep the styled confirm", async () => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    userDataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-profile-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`],
    });
    // The token cookie the web app would have set on the service origin.
    await context.addCookies([{ name: "__unvibe_token", value: svc.token, url: svc.origin }]);
    // github.com never leaves the machine: every request is fulfilled here.
    const seen: string[] = [];
    await context.route("https://github.com/**", async (route) => {
      seen.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML });
    });
    const page = await context.newPage();
    await cpuThrottleFromEnv(page);
    const pageRequests: string[] = [];
    page.on("request", (r) => pageRequests.push(r.url()));

    await page.goto(PR_URL);
    const button = page.locator("#unvibe-review-button");
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveText("Review in Unvibe");

    // CSRF check: a cross-site link to /open for a NEW repo must not
    // clone or create anything — it only lands on the styled in-app
    // confirm page.
    const reposBefore = await apiJson(svc, "GET", "/api/repos");
    const reviewsBefore = await apiJson(svc, "GET", "/api/reviews");
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.id = "cross-site-open";
      a.href = href;
      a.textContent = "cross-site open";
      document.body.appendChild(a);
    }, `${svc.origin}/open?pr=${encodeURIComponent("https://github.com/othercorp/other/pull/3")}`);
    await page.locator("#cross-site-open").click();
    // The service redirects to the web app's confirm route, which renders
    // inside the app frame (top bar, app styling) — not bare HTML.
    await expect(page.getByRole("heading", { name: "Review othercorp/other#3 in Unvibe?" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("open-confirm")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Unvibe" })).toBeVisible();
    expect(JSON.stringify((await apiJson(svc, "GET", "/api/repos")).json)).toBe(
      JSON.stringify((reposBefore as { json: unknown }).json),
    );
    expect(JSON.stringify((await apiJson(svc, "GET", "/api/reviews")).json)).toBe(
      JSON.stringify((reviewsBefore as { json: unknown }).json),
    );
    // A POST from a foreign origin is refused outright.
    const foreignPost = await fetch(`${svc.origin}/open`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${svc.token}`,
      },
      body: `pr=${encodeURIComponent(PR_URL)}`,
    });
    expect(foreignPost.status).toBe(403);

    // The plain-link confirm flow still creates the review on confirm:
    // open the confirm for this PR and start it there.
    await page.goto(`${svc.origin}/open?pr=${encodeURIComponent(PR_URL)}`);
    await expect(page.getByRole("heading", { name: "Review acme/app#7 in Unvibe?" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Start review" }).click();
    await page.waitForURL(/\/review\/[^/]+$/, { timeout: 60_000 });
    expect(page.url().startsWith(`${svc.origin}/review/`)).toBe(true);
    // The review lands (ingest via the stub gh): loading clears.
    await expect(page.getByTestId("review-loading")).toBeHidden({ timeout: 60_000 });

    // Back to the PR: a review exists now, so the button reads Open
    // review — and clicking it goes straight to the review. The worker
    // calls the create-or-open endpoint itself; there is no confirm page.
    await page.goto(PR_URL);
    await expect(button).toHaveText("Open review", { timeout: 30_000 });
    const [againPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 30_000 }),
      button.click(),
    ]);
    await againPage.waitForURL(/\/review\/[^/]+$/, { timeout: 60_000 });
    expect(againPage.url().startsWith(`${svc.origin}/review/`)).toBe(true);
    await expect(againPage.getByTestId("open-confirm")).toHaveCount(0);
    await againPage.close();

    // The token cookie drives that: without it the worker cannot know.
    await context.clearCookies();
    await page.reload();
    await expect(button).toHaveText("Review in Unvibe", { timeout: 30_000 });

    // No page request left to a non-local origin (github.com was routed).
    for (const url of pageRequests) {
      const host = new URL(url).hostname;
      expect(["github.com", "unvibe.localhost", "127.0.0.1"].includes(host), url).toBe(true);
    }
    expect(seen.length).toBeGreaterThan(0);

    // An unknown extension origin is refused; the pinned one is not.
    // The new create-or-open endpoint refuses it too.
    const bad = await fetch(`${svc.origin}/api/extension/pr-status?pr=${encodeURIComponent(PR_URL)}`, {
      headers: {
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        authorization: `Bearer ${svc.token}`,
      },
    });
    expect(bad.status).toBe(403);
    const badOpen = await fetch(`${svc.origin}/api/extension/open`, {
      method: "POST",
      headers: {
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        authorization: `Bearer ${svc.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ pr: PR_URL }),
    });
    expect(badOpen.status).toBe(403);
    const good = await fetch(`${svc.origin}/api/extension/pr-status?pr=${encodeURIComponent(PR_URL)}`, {
      headers: {
        origin: "chrome-extension://fmmhgmdbecooajgmpkmcclidchaekiko",
        authorization: `Bearer ${svc.token}`,
      },
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ exists: true });
  });

  test("conversation header: one button across tab swaps (#333)", async () => {
    test.setTimeout(240_000);
    const profileDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l12-333-profile-"));
    const ctx = await chromium.launchPersistentContext(profileDir, {
      channel: "chromium",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`],
    });
    try {
      await ctx.route("https://github.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: CONVERSATION_FIXTURE_HTML });
      });
      const page = await ctx.newPage();
      await cpuThrottleFromEnv(page);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(PR_URL);

      // Conversation header: exactly one button, in the actions beside
      // Merge status / Code, with the u-mark icon and a known label.
      const button = page.locator("#unvibe-review-button");
      await expect(button).toBeVisible({ timeout: 30_000 });
      expect(await page.locator("#unvibe-review-button").count()).toBe(1);
      await expect(
        page.locator('[data-testid="pr-conversation-header-actions"] #unvibe-review-button'),
      ).toBeVisible();
      await expect(button.locator("svg.unvibe-review-icon")).toBeVisible();
      await expect(button).toHaveText(/^(Review in Unvibe|Open review|Start Unvibe)$/);
      // Brand look survives host button rules: computed background is
      // indigo #38309E with white text.
      expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        "rgb(56, 48, 158)",
      );
      expect(await button.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");

      // Turbo-style morph drops the data attribute: the ARIA/structure
      // hooks still land the same single button in the header actions.
      await page.evaluate(() => {
        document.querySelector("[data-testid]")?.removeAttribute("data-testid");
      });
      await expect(button).toBeVisible({ timeout: 30_000 });
      expect(await page.locator("#unvibe-review-button").count()).toBe(1);
      await expect(
        page.locator('[aria-label="Pull request header actions"] #unvibe-review-button'),
      ).toBeVisible();

      // Tab swap to the classic Files-tab header: the button moves,
      // it does not duplicate.
      await page.evaluate((body) => {
        document.body.innerHTML = body;
      }, CLASSIC_SWAP_BODY);
      await expect(page.locator(".gh-header-actions #unvibe-review-button")).toBeVisible({
        timeout: 30_000,
      });
      expect(await page.locator("#unvibe-review-button").count()).toBe(1);

      // No header at all: fails quietly, and recovers when it returns.
      // The removal rides the content script's mutation observer — poll
      // for the gone state, never sleep a fixed window (#363 B2).
      await page.evaluate(() => {
        document.body.innerHTML = "<main><p>No header on this tab.</p></main>";
      });
      await expect(page.locator("#unvibe-review-button")).toHaveCount(0, { timeout: 15_000 });
      await page.evaluate((body) => {
        document.body.innerHTML = body;
      }, CONVERSATION_BODY);
      await expect(button).toBeVisible({ timeout: 30_000 });
      expect(await page.locator("#unvibe-review-button").count()).toBe(1);

      expect(errors).toEqual([]);
    } finally {
      await ctx.close().catch(() => {});
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
