/**
 * #322 part 1: the unpacked Chrome extension on a local GitHub PR fixture.
 *
 * Real built service (stub `gh`, scratch repo), persistent Chromium with
 * `--load-extension`, and `github.com` routed to a local fixture page that
 * mimics a PR header — never real GitHub. Checks: the button appears,
 * reads "Open review" once a review exists, clicking opens `/open?pr=…`
 * and lands on the review, the token cookie drives the worker's lookup,
 * no page request leaves to a non-local origin, and an unknown extension
 * origin is refused by the service.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import {
  apiJson,
  git,
  makeScratchRepo,
  realGitPath,
  writeFakeGitOffline,
} from "./journeys/journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const EXTENSION_DIR = fileURLToPath(new URL("../../../extension", import.meta.url));
const SHOT = fileURLToPath(new URL("../test-results/extension-button.png", import.meta.url));
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

test.describe("extension PR button (#322)", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let context: BrowserContext | null = null;
  let userDataDir = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-ext-repo-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "remote", "add", "origin", `https://github.com/${OWNER}/${NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-ext-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-ext-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-ext-bin-"));
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

  test("button appears, opens /open, then reads Open review", async () => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    userDataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-ext-profile-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
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
    const pageRequests: string[] = [];
    page.on("request", (r) => pageRequests.push(r.url()));

    await page.goto(PR_URL);
    const button = page.locator("#unvibe-review-button");
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveText("Review in Unvibe");
    await page.screenshot({ path: SHOT, clip: { x: 0, y: 0, width: 760, height: 190 } });

    // CSRF check: a cross-site link to /open for a NEW repo must not
    // clone or create anything — it only lands on the confirm page.
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
    await expect(page.getByRole("heading", { name: "Review othercorp/other#3 in Unvibe?" })).toBeVisible({
      timeout: 30_000,
    });
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

    // Back to the PR: the button is still there.
    await page.goto(PR_URL);
    await expect(button).toHaveText("Review in Unvibe", { timeout: 30_000 });

    // Click: the worker opens /open?pr=… in a new tab. GET never mutates,
    // so the new tab shows the in-app confirm page; its POST creates the
    // review and redirects to it.
    const [confirmPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 30_000 }),
      button.click(),
    ]);
    await expect(
      confirmPage.getByRole("heading", { name: "Review acme/app#7 in Unvibe?" }),
    ).toBeVisible({ timeout: 30_000 });
    const reviewPage = confirmPage;
    await reviewPage.getByRole("button", { name: "Start review" }).click();
    await reviewPage.waitForURL(/\/review\/[^/]+$/, { timeout: 60_000 });
    expect(reviewPage.url().startsWith(`${svc.origin}/review/`)).toBe(true);
    // The review lands (ingest via the stub gh): loading clears.
    await expect(reviewPage.getByTestId("review-loading")).toBeHidden({ timeout: 60_000 });

    // Now a review exists: the fixture button says so, and clicking it
    // goes straight to the review (no confirm page for an existing one).
    await page.reload();
    await expect(button).toHaveText("Open review", { timeout: 30_000 });
    const [againPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 30_000 }),
      button.click(),
    ]);
    await againPage.waitForURL(/\/review\/[^/]+$/, { timeout: 60_000 });
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
    const bad = await fetch(`${svc.origin}/api/extension/pr-status?pr=${encodeURIComponent(PR_URL)}`, {
      headers: {
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        authorization: `Bearer ${svc.token}`,
      },
    });
    expect(bad.status).toBe(403);
    const good = await fetch(`${svc.origin}/api/extension/pr-status?pr=${encodeURIComponent(PR_URL)}`, {
      headers: {
        origin: "chrome-extension://fmmhgmdbecooajgmpkmcclidchaekiko",
        authorization: `Bearer ${svc.token}`,
      },
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ exists: true });
  });
});
