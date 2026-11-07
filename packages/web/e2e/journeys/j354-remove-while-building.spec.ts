/**
 * J354 (#354): removing a review while its guide is building must not
 * crash the service. `DELETE /api/reviews/:id` returns 200; seconds later
 * a running job settles, `JobQueue.settle` calls `JobStore.save`, which
 * threw `FOREIGN KEY constraint failed` — the throw escaped through the
 * fire-and-forget `execute` as an unhandled rejection and the process
 * exited.
 *
 * Against the real built service: agent `replay` with a stretched chunk
 * delay so the guide really runs (building phase) long enough to Remove;
 * a fake `gh` (the flows here use a branch source, so `gh` only keeps the
 * start page quiet); real `git` (no remote: nothing can reach the
 * network). No real agents, no spend.
 *
 * The journey Removes the building review from the start page (the real
 * UI path), then proves the service stays up: the detached jobs settle
 * quietly (the service log carries the quiet-drop debug line and no
 * FOREIGN KEY error), the start page still loads, and another review can
 * be opened — over API and in the browser.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Fake `gh`: nothing here uses a PR source; keep repo/PR surfaces quiet. */
function writeFakeGh354(binDir: string): void {
  const script = `#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J354 remove while building", () => {
  let repoDir = "";
  let dataDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j354-repo-"));
    await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j354-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j354-bin-"));
    writeFakeGh354(fakeBin);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: {
        SHELL: fakeShell,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        // Stretch the replay so the guide is still building when Remove
        // is clicked; the detached jobs then settle after the delete.
        UNVIBE_REPLAY_DELAY_MS: "500",
      },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  async function guideStatus(id: string): Promise<string> {
    const list = await apiJson(svc!, "GET", "/api/reviews");
    const found = (list.json as { reviews: { id: string; guideStatus: string }[] }).reviews.find((r) => r.id === id);
    if (!found) throw new Error(`review ${id} missing from /api/reviews`);
    return found.guideStatus;
  }

  async function waitForGuide(id: string, want: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await guideStatus(id)) === want) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for review ${id} guide=${want}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function waitForLog(text: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const log = readFileSync(svc!.logFile, "utf8");
      if (log.includes(text)) return log;
      if (Date.now() > deadline) throw new Error(`timed out waiting for service log to contain: ${text}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  test("remove mid-build keeps the service up; another review opens", async ({ page }) => {
    test.setTimeout(600_000);
    if (!svc) throw new Error("no service");

    // Start a branch review; wait until the guide is really building.
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
    expect(created.status).toBe(202);
    const doomedId = (created.json as { review: { id: string } }).review.id;
    await waitForGuide(doomedId, "running", 120_000);

    // Remove it from the start page (the real UI path): hover reveals
    // the action, the inline confirm asks, confirming drops the row.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const row = page.locator(`[data-testid="session-${doomedId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.hover();
    await row.getByRole("button", { name: "Remove this review" }).click();
    const pill = row.locator(".uic-pill");
    await expect(pill).toContainText("Confirm remove review");
    await pill.getByRole("button", { name: "Confirm remove review" }).click();
    await expect(row.getByText("Confirmed")).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveCount(0);
    const afterDelete = await apiJson(svc, "GET", "/api/reviews");
    expect(
      ((afterDelete.json as { reviews: { id: string }[] }).reviews ?? []).some((r) => r.id === doomedId),
    ).toBe(false);

    // The detached jobs settle after the delete — quietly. Pre-fix this
    // is where the FOREIGN KEY throw escaped and killed the process;
    // post-fix the queue logs one debug line per dropped settle.
    const log = await waitForLog("after its review was deleted; dropping", 300_000);
    expect(log).not.toContain("FOREIGN KEY constraint failed");
    expect(log).not.toContain("failed outside its state machine");

    // The service is still up: the start page loads and another review
    // can be opened — over the API and in the browser.
    const list = await apiJson(svc, "GET", "/api/reviews");
    expect(list.status).toBe(200);
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const reopened = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
    expect([200, 202]).toContain(reopened.status);
    const nextId = (reopened.json as { review: { id: string } }).review.id;
    expect(nextId).not.toBe(doomedId);
    const nextRow = page.locator(`[data-testid="session-${nextId}"]`);
    await page.reload();
    await expect(nextRow).toBeVisible({ timeout: 30_000 });
    const fetched = await apiJson(svc, "GET", `/api/reviews/${nextId}`);
    expect(fetched.status).toBe(200);
    await page.goto(`${svc.origin}/review/${nextId}?token=${svc.token}`);
    await expect(page.getByText("Building the guide").first()).toBeVisible({ timeout: 120_000 });
  });
});
