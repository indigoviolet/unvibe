/**
 * #322 part 2 spike: side panel on a local GitHub fixture (never real
 * GitHub). Two active repos (acme/service + acme/client); one question
 * must answer with repo-qualified citations from BOTH. The panel page is
 * the manifest's side_panel default_path; Playwright loads that exact
 * page in a tab because headless Chromium cannot open the side-panel
 * chrome UI — the worker, service and rendering are the real ones.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { apiJson, git, writeFakeGitOffline, realGitPath } from "./journeys/journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const EXTENSION_DIR = fileURLToPath(new URL("../../../extension", import.meta.url));
const SHOT = fileURLToPath(new URL("../test-results/extension-panel-322.png", import.meta.url));
const CANDIDATE_PORTS = [4517, 4518, 4519, 4520, 4521];
const PAGE_URL = "https://github.com/acme/service/issues/12";
const FIXTURE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Token check fails · Issue #12 · acme/service</title></head>
<body><main><h1>Token check fails</h1><p>Users report validateToken rejects valid sessions. The client calls fetchSession first.</p></main></body></html>`;

async function makeRepo(dir: string, owner: string, name: string, file: string, body: string): Promise<void> {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "src", file), body);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "remote", "add", "origin", `https://github.com/${owner}/${name}.git`);
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
  throw new Error("no free extension candidate port");
}

test.describe("side panel (#322 spike)", () => {
  let svc: RunningService | null = null;
  let context: BrowserContext | null = null;
  const dirs: string[] = [];
  const tmp = (p: string) => { const d = mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const serviceDir = tmp("unvibe-panel-service-");
    const clientDir = tmp("unvibe-panel-client-");
    await makeRepo(serviceDir, "acme", "service", "auth.ts", "export function validateToken(t: string) { return t.length > 3; }\n");
    await makeRepo(clientDir, "acme", "client", "api.ts", "export async function fetchSession() { return 1; }\n");
    const fakeBin = tmp("unvibe-panel-bin-");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    const port = await freeCandidatePort();
    svc = await startService(tmp("unvibe-panel-data-"), { agent: "none", port: String(port), extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` } });
    expect((await apiJson(svc, "POST", "/api/repos", { path: serviceDir })).status).toBe(200);
    expect((await apiJson(svc, "POST", "/api/repos", { path: clientDir })).status).toBe(200);
  });

  test.afterAll(async () => {
    await context?.close().catch(() => {});
    await svc?.stop().catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("panel shows one thread and answers from two repos", async () => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const userDataDir = tmp("unvibe-panel-profile-");
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium", headless: true,
      // Playwright's default args carry --disable-extensions; loading the
      // unpacked extension requires dropping exactly that one.
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--load-extension=${EXTENSION_DIR}`, `--disable-extensions-except=${EXTENSION_DIR}`],
    });
    await context.addCookies([{ name: "__unvibe_token", value: svc.token, url: svc.origin }]);
    await context.route("https://github.com/**", async (route) => { await route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML }); });
    const page = await context.newPage();
    await page.goto(PAGE_URL);
    await expect(page.locator("h1")).toHaveText("Token check fails");

    // The manifest `key` pins this id (see shared extension.ts). Open the
    // exact side-panel page (see header note on headless side-panel UI).
    const extId = "fmmhgmdbecooajgmpkmcclidchaekiko";
    const panel = await context.newPage();
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
    await expect(panel.locator("#status")).toContainText("Used: acme/service, acme/client");
    await panel.setViewportSize({ width: 400, height: 800 });
    await panel.screenshot({ path: SHOT });

    // One thread per page: a second ask appends, it does not start over.
    await panel.locator("#question").fill("Where is validateToken?");
    await panel.locator("#ask").click();
    await expect(panel.locator("#thread .msg")).toHaveCount(4, { timeout: 30_000 });

    // Unknown extension origin is refused for panel endpoints too.
    const bad = await fetch(`${svc.origin}/api/extension/panel/active-repos`, { headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", authorization: `Bearer ${svc.token}` } });
    expect(bad.status).toBe(403);
  });
});
