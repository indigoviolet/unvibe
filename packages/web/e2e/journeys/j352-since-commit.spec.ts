/**
 * J352 (#351 step 2): the no-review-yet path on a real PR. The reviewer
 * already reviewed on GitHub up to a commit B; the service offers
 * "focus on changes since then", one guide run writes the normal guide
 * plus the Since-B section, and the stored hunk set drives the Since
 * filter. Markers and the section's answers are covered precisely by the
 * scripted-agent service spec (replay replays the demo guide, whose
 * plotlines can't match a custom fixture); the journey proves the real
 * service path end to end with a stubbed `gh`.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";
import type { ReviewSnapshot } from "@unvibe/shared";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");
const V2 = V1.replace("    return 1", "    return 11");
const V3 = V2.replace("    return 2", "    return 22").replace("CONST_B = 20", "CONST_B = 20\n\n\ndef gamma():\n    return 3");

test.describe("J352 no-review-yet offer", () => {
  test.describe.configure({ mode: "serial" });
  let repoDir = "", bareDir = "", binDir = "", logDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let c1 = "", c2 = "";
  let c1short = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-repo-"));
    bareDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-remote-"));
    binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-bin-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-log-"));
    await git(bareDir, "init", "--bare", "-b", "main");
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V2);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "rework alpha");
    c1 = await git(repoDir, "rev-parse", "HEAD");
    c1short = c1.slice(0, 8);
    writeFileSync(path.join(repoDir, "src-app.py"), V3);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "rework beta and add gamma");
    c2 = await git(repoDir, "rev-parse", "HEAD");
    // Offline-safe origin: GitHub-shaped for owner parsing, rewritten to
    // the local bare repo so every fetch stays local (never real GitHub).
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/app.git");
    await git(repoDir, "config", `url.${bareDir}.insteadOf`, "https://github.com/acme/app.git");
    await git(repoDir, "push", "origin", "main", "feature");
    await git(repoDir, "fetch", "origin");

    const reviews = JSON.stringify([
      { id: 11, user: { login: "teammate" }, commit_id: c2, state: "APPROVED", submitted_at: "2026-11-03T10:00:00Z" },
      { id: 12, user: { login: "you" }, commit_id: c1, state: "CHANGES_REQUESTED", submitted_at: "2026-11-01T10:00:00Z" },
      { id: 13, user: { login: "you" }, commit_id: c1, state: "COMMENTED", submitted_at: "2026-11-02T10:00:00Z" },
      { id: 14, user: { login: "you" }, state: "COMMENTED", submitted_at: "2026-11-04T10:00:00Z" },
    ]);
    const prView = JSON.stringify({
      title: "Journey test PR", body: "", author: { login: "you" }, state: "OPEN", isDraft: false,
      baseRefName: "main", headRefName: "feature", headRefOid: c2,
    });
    writeFileSync(
      path.join(binDir, "gh"),
      `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'you'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '${prView}'; exit 0; fi
case "$*" in *pulls/77/comments*) echo '[]'; exit 0 ;; esac
case "$*" in *pulls/77/reviews*) echo '${reviews}'; exit 0 ;; esac
case "$*" in *issues/77/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`,
      { mode: 0o755 },
    );
    writeFakeGitOffline(binDir, realGitPath());
    const fakeShell = path.join(binDir, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${binDir}:$PATH"\n`, { mode: 0o755 });

    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-data-"));
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { SHELL: fakeShell, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
      label: "j352",
    });
    const repos = (await apiJson(svc, "POST", "/api/repos", { path: repoDir })).json as {
      repos: { id: string; localPath: string }[];
    };
    const registered = repos.repos.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error("scratch repo not registered");
    const created = (await apiJson(svc, "POST", "/api/reviews", { repoId: registered.id, pr: 77 })).json as ReviewSnapshot;
    reviewId = created.review.id;

    // The offer: the user's own latest review (c1) wins over the
    // teammate's later review and the entry without a commit_id.
    const prior = await apiJson(svc, "GET", `/api/reviews/${reviewId}/prior-github-review`);
    expect(prior.status).toBe(200);
    expect(prior.json as unknown).toEqual({ review: { sha: c1, author: "you", submittedAt: "2026-11-02T10:00:00Z" } });

    // Accept at once (deterministic: the single guide run picks it up
    // whether the ingest is still running or done).
    const accepted = await apiJson(svc, "POST", `/api/reviews/${reviewId}/since-baseline`, { sha: c1 });
    expect(accepted.status).toBe(200);
    expect((accepted.json as { baseline: unknown }).baseline).toEqual({ kind: "commit", sha: c1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of [repoDir, bareDir, binDir, logDir, dataDir]) {
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  async function snap(): Promise<ReviewSnapshot> {
    return (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as ReviewSnapshot;
  }

  test("one guide run stores the commit baseline and the delta hunk set", async () => {
    test.setTimeout(180_000);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const s = await snap();
      const root = s.pages.find((p) => p.id === "root");
      if (root && root.cards.length > 0) break;
      if (Date.now() > deadline) throw new Error("guide cards did not appear on the PR review");
      await new Promise((r) => setTimeout(r, 500));
    }
    const s = await snap();
    expect(s.sinceBaseline).toEqual({ kind: "commit", sha: c1 });
    const hunks = [...(s.sinceHunks?.added ?? []), ...(s.sinceHunks?.changed ?? [])];
    expect(hunks.length).toBeGreaterThan(0);
    // Exactly one guide run: a single reader job, no update pass.
    const readers = (s.jobs ?? []).filter((j) => j.kind === "reader");
    expect(readers).toHaveLength(1);
    expect(readers[0].state).toBe("done");
    expect((s.jobs ?? []).some((j) => j.kind === "update-pass")).toBe(false);
  });

  test("the Since filter reads the commit baseline label", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    const chip = page.locator('[data-filterchip="since"]');
    await expect(chip).toContainText(`Since ${c1short}`, { timeout: 30_000 });
    await expect(chip).toHaveAttribute("aria-label", `Show only hunks changed since ${c1short}`);
    await chip.click();
    await expect(chip).toContainText("hidden", { timeout: 30_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  test("the offer is gone once the guide lands", async ({ page }) => {
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("prior-review-offer")).toHaveCount(0);
  });

  test("a gone commit fails loudly through the API", async () => {
    const gone = "f".repeat(40);
    const res = await apiJson(svc!, "POST", `/api/reviews/${reviewId}/since-baseline`, { sha: gone });
    expect(res.status).toBe(502);
    expect((res.json as { error: string }).error).toContain(gone.slice(0, 8));
    // The stored baseline is untouched by the failed pick.
    expect((await snap()).sinceBaseline).toEqual({ kind: "commit", sha: c1 });
  });
});
