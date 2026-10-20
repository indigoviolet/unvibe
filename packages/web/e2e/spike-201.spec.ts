/** Spike #201: settings tabs + start page (seeded PR list) in each theme, light/dark. Output: spikes/201/<SPIKE_SET>/ (before|after). Demo-style fixture data only, stubbed gh. */
import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { startService, type RunningService } from "./service-harness.js";
const exec = promisify(execFile);
const SET = process.env.SPIKE_SET ?? "after";
const OUT = path.resolve(`spikes/201/${SET}`);
const TABS = ["appearance", "repositories", "models", "access", "environment", "prompts", "limits", "version", "data"];
let svc: RunningService | null = null;
async function git(dir: string, ...args: string[]): Promise<void> { await exec("git", ["-C", dir, ...args]); }
test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const repoDir = mkdtempSync(path.join(tmpdir(), "spike201-repo-"));
  await git(repoDir, "init", "-q");
  await git(repoDir, "config", "user.email", "demo@example.com");
  await git(repoDir, "config", "user.name", "Demo");
  await git(repoDir, "remote", "add", "origin", "https://github.com/acme/demo-app.git");
  writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 1\n");
  await git(repoDir, "add", ".");
  await git(repoDir, "commit", "-qm", "fixture");
  const bin = mkdtempSync(path.join(tmpdir(), "spike201-bin-"));
  const prs = JSON.stringify([
    { number: 42, title: "Add retry with backoff to the client", author: { login: "demo-user" }, updatedAt: new Date(Date.now() - 3600000).toISOString(), headRefName: "retry-backoff", additions: 120, deletions: 30, changedFiles: 4, url: "https://github.com/acme/demo-app/pull/42", reviewRequests: [] },
    { number: 41, title: "Document the configuration options", author: { login: "demo-user" }, updatedAt: new Date(Date.now() - 86400000).toISOString(), headRefName: "docs-config", additions: 200, deletions: 10, changedFiles: 2, url: "https://github.com/acme/demo-app/pull/41", reviewRequests: [] },
    { number: 40, title: "Fix flaky timeout in the test suite", author: { login: "demo-user" }, updatedAt: new Date(Date.now() - 172800000).toISOString(), headRefName: "fix-flaky", additions: 15, deletions: 8, changedFiles: 1, url: "https://github.com/acme/demo-app/pull/40", reviewRequests: [] },
  ]);
  writeFileSync(path.join(bin, "gh"), `#!/bin/sh\ncase "$*" in\n  *"pr list"*"--author"*) cat <<'JSON'\n${prs}\nJSON\n    exit 0 ;;\n  *"pr list"*) echo '[]'; exit 0 ;;\n  *"api user"*"--jq"*) echo 'demo-user'; exit 0 ;;
  *"api user"*) echo '{"login":"demo-user"}'; exit 0 ;;\n  *auth*) exit 0 ;;\n  *--version*) echo 'gh version 2.0.0'; exit 0 ;;\nesac\necho '{}'\nexit 0\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "d2"), "#!/bin/sh\necho 'v0.9.0'\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "fakeshell"), `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${bin}:$PATH"\n`, { mode: 0o755 });
  svc = await startService(mkdtempSync(path.join(tmpdir(), "spike201-")), { agent: "none", extraEnv: { SHELL: path.join(bin, "fakeshell"), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` } });
  const res = await fetch(`${svc.origin}/api/repos?token=${svc.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: repoDir }) });
  if (!res.ok) throw new Error(`seed repo failed: ${res.status} ${await res.text()}`);
});
test.afterAll(async () => { await svc?.stop(); svc = null; });
for (const theme of ["default", "studio", "console"] as const) {
  for (const dark of [false, true]) {
    test(`spike201 ${theme} ${dark ? "dark" : "light"}`, async ({ page }) => {
      if (!svc) throw new Error("no service");
      test.setTimeout(120000);
      await page.setViewportSize({ width: 1280, height: 900 });
      if (dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.request.fetch(`${svc.origin}/api/settings?token=${svc.token}`, { method: "PUT", data: { uiTheme: theme } });
      await page.goto(`${svc.origin}/?token=${svc.token}`);
      await expect(page.getByText("Add retry with backoff to the client").first()).toBeVisible({ timeout: 20000 });
      await page.screenshot({ path: path.join(OUT, `${theme}-${dark ? "dark" : "light"}-start.png`), fullPage: true });
      for (const tab of TABS) {
        await page.goto(`${svc.origin}/settings?tab=${tab}&token=${svc.token}`);
        if (tab === "environment") {
          await expect(page.locator('[data-testid^="env-"]').first()).toBeVisible({ timeout: 20000 });
        } else if (tab === "models") {
          await expect(page.getByText("Provider").first()).toBeVisible({ timeout: 20000 });
        } else {
          await page.waitForTimeout(600);
        }
        await page.screenshot({ path: path.join(OUT, `${theme}-${dark ? "dark" : "light"}-settings-${tab}.png`), fullPage: true });
      }
    });
  }
}
