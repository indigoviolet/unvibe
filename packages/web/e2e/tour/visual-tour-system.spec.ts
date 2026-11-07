/**
 * Tour: system (package D frames for the on-demand visual tour).
 *
 * On-demand only (`mise run visual-tour`): the system states the owner
 * reviews as frames — the stale/updated update banners with the #368
 * header chip, the document review bar across themes, the extension
 * button + confirm + conversation header + side panel, and the static
 * demo guide/explain/install/outbox/settings states. Behaviour for all
 * of these lives in `e2e/journeys/l7-since.spec.ts` (update banners),
 * `l11-documents.spec.ts` (document bar, side panel), `l12-extension`
 * (button flows) and `l13-static-demo.spec.ts`; this file keeps just
 * enough asserts to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { tourCombos } from "../tour-matrix.js";
import { selectText } from "../select-text.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createScratchReview, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "../journeys/journey-helpers.js";
import { startStaticServer, type StaticServer } from "../static-server.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");

// ---------------------------------------------------------------------------
// Update banners (j367 states reframed for the owner).
// ---------------------------------------------------------------------------

test.describe("tour update banners", () => {
  const appKey = fileKeyForPath("src-app.py");
  const appFile = `[id="F-${appKey}"]`;
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    mkdirSync(path.join(SHOTS, "367"), { recursive: true });
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour367-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22"));
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour367-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "tour367" });
    reviewId = await createScratchReview(svc, repoDir);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const pages = (snap.json as { pages?: { cards: unknown[] }[] }).pages ?? [];
      if (pages.some((p) => p.cards.length > 0)) break;
      if (Date.now() > deadline) throw new Error("guide cards did not appear");
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("stale and updated banners with the header chip", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });

    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });

    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();

    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toHaveAttribute("data-update-state", "stale", { timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "367", "stale-banner-1440-light.png") });
    await page.locator(appFile).locator(".dhunk").first().screenshot({ path: path.join(SHOTS, "367", "hunk-header-chip-1440-light.png") });

    await banner.getByRole("button", { name: "Update", exact: true }).click();
    const jobDeadline = Date.now() + 90_000;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (res.json as { jobs: { kind: string; state: string }[] }).jobs ?? [];
      const updateJob = jobs.find((j) => j.kind === "update-pass");
      if (updateJob && updateJob.state !== "running" && updateJob.state !== "queued") break;
      if (Date.now() > jobDeadline) throw new Error("update-pass job never finished");
      await new Promise((r) => setTimeout(r, 500));
    }
    await expect(banner).toHaveAttribute("data-update-state", "current", { timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "367", "updated-banner-1440-light.png") });
  });
});

// ---------------------------------------------------------------------------
// Document review bar across themes (from j222's framed loop).
// ---------------------------------------------------------------------------

test.describe("tour document review bar", () => {
  let dataDir = "", repoDir = "", repoId = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourdoc-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourdoc-repo-"));
    await makeScratchRepo(repoDir);
    svc = await startService(dataDir, { agent: "replay", label: "tourdoc" });
    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
    repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repoDir,
    )!.id;
    const doc = await apiJson(svc, "POST", "/api/reviews", {
      kind: "document",
      markdown: "# Design note\n\nThe widget folds obsolete headers before parsing.\n",
      contextRepos: [{ repoId, source: "local" }],
    });
    expect(doc.status).toBe(201);
    reviewId = (doc.json as { review: { id: string } }).review.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  for (const combo of tourCombos("docBar", [
    { name: "default-light", theme: "default", scheme: "light", dark: false },
    { name: "studio-light", theme: "studio", scheme: "light", dark: false },
    { name: "console-dark", theme: "console", scheme: "dark", dark: true },
  ] as const)) {
    test(`document bar frame (${combo.name})`, async ({ page }) => {
      test.setTimeout(240_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await apiJson(svc, "PUT", "/api/settings", { uiTheme: combo.theme });
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
    });
  }
});

// ---------------------------------------------------------------------------
// Extension frames: button, confirm, conversation header, side panel.
// ---------------------------------------------------------------------------

const EXTENSION_DIR = fileURLToPath(new URL("../../../../extension", import.meta.url));
const CANDIDATE_PORTS = [4517, 4518, 4519, 4520, 4521];
const OWNER = "acme";
const NAME = "app";
const PR_NUMBER = 7;
const PR_URL = `https://github.com/${OWNER}/${NAME}/pull/${PR_NUMBER}`;

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

const CONVERSATION_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fix the thing · Pull Request #${PR_NUMBER} · ${OWNER}/${NAME}</title>
<style>body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:0;color:#1f2328;background:#fff}
.pr-conversation-header{border-bottom:1px solid #d1d9e0;padding:16px 24px}
.pr-title-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pr-title{font-size:28px;font-weight:400;margin:0}
.pr-title-actions{display:inline-flex;gap:8px;margin-left:auto}
.pr-title-actions button{font:inherit;font-size:12px;font-weight:500;height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(31,35,40,.15);background:#f6f8fa;color:#1f2328;cursor:pointer}
.pr-meta{color:#59636e;margin-top:8px}
</style></head>
<body>
<header class="pr-conversation-header">
  <div class="pr-title-row">
    <h1 class="pr-title">Fix the thing <span>#${PR_NUMBER}</span></h1>
    <div class="pr-title-actions" data-testid="pr-conversation-header-actions" role="group" aria-label="Pull request header actions"><button type="button">Merge status</button> <button type="button">Code</button></div>
  </div>
  <div class="pr-meta"><strong>author</strong> wants to merge 1 commit into <code>main</code> from <code>feature</code></div>
</header>
<main><p>Fixture PR body. Served locally; github.com is routed here.</p></main>
</body></html>`;

const PANEL_FIXTURE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Token check fails · Issue #12 · acme/service</title></head><body><main><h1>Token check fails</h1><p>Users report validateToken rejects valid sessions. The client calls fetchSession first.</p></main></body></html>`;

function writeFakeGhExt(binDir: string, logDir: string, repoDir: string): void {
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

async function launchWithExtension(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`],
  });
}

test.describe("tour extension frames", () => {
  let repoDir = "", dataDir = "", fakeBin = "", logDir = "";
  let svc: RunningService | null = null;
  let context: BrowserContext | null = null;
  const profiles: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "remote", "add", "origin", `https://github.com/${OWNER}/${NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-bin-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-gh-"));
    writeFakeGhExt(fakeBin, logDir, repoDir);
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
      label: "tourext",
    });
    expect((await apiJson(svc, "POST", "/api/repos", { path: repoDir })).status).toBe(200);
  });
  test.afterAll(async () => {
    await context?.close().catch(() => {});
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, fakeBin, logDir, ...profiles]) if (d) rmSync(d, { recursive: true, force: true });
  });

  test("button and styled confirm frames", async () => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-profile-"));
    profiles.push(userDataDir);
    context = await launchWithExtension(userDataDir);
    try {
      await context.addCookies([{ name: "__unvibe_token", value: svc.token, url: svc.origin }]);
      await context.route("https://github.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML });
      });
      const page = await context.newPage();
      await cpuThrottleFromEnv(page);
      await page.goto(PR_URL);
      const button = page.locator("#unvibe-review-button");
      await expect(button).toBeVisible({ timeout: 30_000 });
      await expect(button).toHaveText("Review in Unvibe");
      await page.screenshot({ path: path.join(SHOTS, "extension-button-1440-light.png"), clip: { x: 0, y: 0, width: 760, height: 190 } });

      // The styled in-app confirm (frame only: nothing is created here).
      await page.goto(`${svc.origin}/open?pr=${encodeURIComponent(PR_URL)}`);
      await expect(page.getByRole("heading", { name: "Review acme/app#7 in Unvibe?" })).toBeVisible({
        timeout: 30_000,
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, "extension-open-confirm-1440-light.png") });
    } finally {
      await context?.close().catch(() => {});
      context = null;
    }
  });

  test("conversation header frame", async () => {
    test.setTimeout(240_000);
    const profileDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext333-profile-"));
    const ctx = await launchWithExtension(profileDir);
    try {
      await ctx.route("https://github.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: CONVERSATION_FIXTURE_HTML });
      });
      const page = await ctx.newPage();
      await cpuThrottleFromEnv(page);
      await page.goto(PR_URL);
      const button = page.locator("#unvibe-review-button");
      await expect(button).toBeVisible({ timeout: 30_000 });
      await page.locator(".pr-conversation-header").screenshot({
        path: path.join(SHOTS, "extension-333-conversation-light.png"),
      });
    } finally {
      await ctx.close().catch(() => {});
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test("side panel frame", async () => {
    test.setTimeout(240_000);
    // The panel answers from its own two repos (acme/service +
    // acme/client) — a separate service from the button flow above.
    const panelServiceDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-panel-service-"));
    const panelClientDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-panel-client-"));
    const panelBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-panel-bin-"));
    const panelData = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-panel-data-"));
    let panelSvc: RunningService | null = null;
    try {
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
      await makeRepo(panelServiceDir, "acme", "service", "auth.ts", "export function validateToken(t: string) { return t.length > 3; }\n");
      await makeRepo(panelClientDir, "acme", "client", "api.ts", "export async function fetchSession() { return 1; }\n");
      writeFakeGitOffline(panelBin, realGitPath());
      const panelShell = path.join(panelBin, "fakeshell");
      writeFileSync(panelShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${panelBin}:$PATH"\n`, { mode: 0o755 });
      const port = await freeCandidatePort();
      panelSvc = await startService(panelData, {
        agent: "none",
        port: String(port),
        extraEnv: { SHELL: panelShell, PATH: `${panelBin}${path.delimiter}${process.env.PATH ?? ""}` },
        label: "tourextpanel",
      });
      expect((await apiJson(panelSvc, "POST", "/api/repos", { path: panelServiceDir })).status).toBe(200);
      expect((await apiJson(panelSvc, "POST", "/api/repos", { path: panelClientDir })).status).toBe(200);
      const svc = panelSvc;
      const PAGE_URL = "https://github.com/acme/service/issues/12";
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tourext-panel-"));
    const ctx = await launchWithExtension(userDataDir);
    try {
      await ctx.addCookies([{ name: "__unvibe_token", value: svc.token, url: svc.origin }]);
      await ctx.route("https://github.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: PANEL_FIXTURE_HTML });
      });
      const page = await ctx.newPage();
      await cpuThrottleFromEnv(page);
      await page.goto(PAGE_URL);
      await expect(page.locator("h1")).toHaveText("Token check fails");
      const extId = "fmmhgmdbecooajgmpkmcclidchaekiko";
      const panel = await ctx.newPage();
      await cpuThrottleFromEnv(panel);
      const q = new URLSearchParams({ url: PAGE_URL, title: "Token check fails · Issue #12 · acme/service", selection: "validateToken rejects valid sessions", context: "validateToken fetchSession" });
      await panel.goto(`chrome-extension://${extId}/panel/panel.html?${q.toString()}`);
      await expect(panel.locator("#page-title")).toContainText("Token check fails", { timeout: 30_000 });
      await expect(panel.locator("#repos")).toContainText("acme/service", { timeout: 30_000 });
      // An empty panel state is a legitimate frame: the question has not
      // been asked yet in this tour context.
      await panel.setViewportSize({ width: 400, height: 800 });
      await panel.screenshot({ path: path.join(SHOTS, "extension-panel-322.png") });
    } finally {
      await ctx.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
    }
    } finally {
      await panelSvc?.stop().catch(() => {});
      for (const d of [panelServiceDir, panelClientDir, panelBin, panelData]) rmSync(d, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Static demo frames.
// ---------------------------------------------------------------------------

const DEMO_DIST = fileURLToPath(new URL("../../dist-demo", import.meta.url));

test.describe("tour static demo frames", () => {
  test.skip(!existsSync(DEMO_DIST), "needs `mise run demo:build` first");
  let demo: StaticServer | null = null;

  test.beforeAll(async () => {
    demo = await startStaticServer(DEMO_DIST, "/demo");
  });
  test.afterAll(async () => {
    await demo?.stop().catch(() => {});
    demo = null;
  });

  function origin(): string {
    if (!demo) throw new Error("static server not started");
    return demo.origin;
  }

  async function gotoDemo(page: import("@playwright/test").Page): Promise<void> {
    await page.goto(`${origin()}/`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/#\/review\/demo/);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
  }

  async function closeSeedCard(page: import("@playwright/test").Page): Promise<void> {
    await page.locator('#C-problem section.ithread[data-thread]').getByRole("button", { name: "Close" }).first().click();
  }

  /** Fail on any request outside the static build's own path (`/demo/`). */
  async function sameOriginOnly(page: import("@playwright/test").Page): Promise<string[]> {
    const base = origin();
    const violations: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (!url.startsWith(`${base}/`) && url !== `${base}/`) violations.push(`${req.method()} ${url}`);
    });
    return violations;
  }

  test("guide and explain frames", async ({ page }) => {
    const violations = await sameOriginOnly(page);
    await gotoDemo(page);
    await expect(page.locator("#C-central")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "demo-guide-1440-light.png") });

    await closeSeedCard(page);
    await selectText(page, "#C-central", "optional whitespace");
    await page.locator('#selbar [data-act="explain"]').click();
    const thread = page.locator('#C-central section.ithread[data-thread] .exp-b');
    await expect(thread.first()).toContainText(/obs-fold|RFC 9112/i, { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "demo-explain-1440-light.png") });
    expect(violations).toEqual([]);
  });

  test("install message frame", async ({ page }) => {
    const violations = await sameOriginOnly(page);
    await page.goto(`${origin()}/?nohl=1#/review/demo`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const file = '[id="F-src-urllib3-connection.py"]';
    await expect(page.locator(`${file} table.diff`).first()).toBeVisible({ timeout: 15_000 });
    await selectText(page, `${file} table.diff`, "_normalize_header_value");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator(`${file} .ithread[data-pending-thread]`);
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What color is a ripe banana?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator(`${file} section.ithread[data-thread]`, {
      hasText: "What color is a ripe banana?",
    });
    await expect(card.first()).toContainText("The demo only has recorded answers", { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "demo-install-message-1440-light.png") });
    expect(violations).toEqual([]);
  });

  test("seeded outbox toggle frame", async ({ page }) => {
    const violations = await sameOriginOnly(page);
    await gotoDemo(page);
    await closeSeedCard(page);
    const seed = page.locator('#C-central section.ithread[data-thread="t-seed"]');
    await expect(seed).toBeVisible({ timeout: 10_000 });
    await expect(seed.getByRole("button", { name: "Add to Outbox" })).toBeVisible({ timeout: 10_000 });
    await seed.getByRole("button", { name: "Add to Outbox" }).click();
    await expect(seed.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible({ timeout: 10_000 });
    await seed.screenshot({ path: path.join(SHOTS, "static-demo-t-seed-outbox-1440-light.png") });
    expect(violations).toEqual([]);
  });  test("read-only settings frames", async ({ page }) => {
    const violations = await sameOriginOnly(page);
    await page.goto(`${origin()}/#/settings`);
    await expect(page.getByText("Settings are read-only in the static demo")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "demo-settings-1440-light.png") });
    await page.locator('[role="tablist"]').getByRole("tab", { name: "Models" }).click();
    await expect(page.getByText("Opus 5.5 (claude-opus-5-5)").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, "demo-settings-models-1440-light.png") });
    expect(violations).toEqual([]);
  });
});
