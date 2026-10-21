/** J3 (#188): comments and Submit with stubbed gh — real service, no agent. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

function writeFakeGh(binDir: string, logDir: string, headSha: string): void {
  const body = ["First paragraph of the PR body.", "", "Second paragraph with details."].join("\n");
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"J3 test PR","body":${JSON.stringify(body)},"author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
case "$*" in *pulls/1/reviews*) cat > "$LOG/review-stdin.json"; echo '{"html_url":"https://example.invalid/pr/1"}'; exit 0 ;; esac
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  prev=""
  for arg in "$@"; do if [ "$prev" = "--body-file" ]; then cp "$arg" "$LOG/body.md"; fi; prev="$arg"; done
  echo '{}'; exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J3 comments and submit", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    const repoBase = mkdtempSync(path.join(os.tmpdir(), "unvibe-j3-repo-"));
    repoDir = repoBase;
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j3-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j3-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j3-bin-"));
    writeFakeGh(fakeBin, logDir, repo.headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, { extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` } });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("comment survives reload, submit posts exactly one review, second submit posts nothing new", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });

    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible();
    await slot.locator("textarea").fill("Why 2 and not 3?");
    await slot.getByRole("button", { name: "Save" }).click();
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Why 2 and not 3?" });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    await expect(thread.getByRole("button", { name: "In the Outbox" })).toBeVisible();

    await page.reload();
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Why 2 and not 3?" })).toBeVisible({ timeout: 10_000 });

    // Edit description, then submit: preview shows only the marked thread + description.
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right #d-p1")).toBeVisible();
    await page.locator("#right [data-descedit]").click();
    await page.locator("#right #descEdit").fill("First paragraph of the PR body. Edited by the reviewer.");
    await page.locator("#right [data-descsave]").click();
    await expect(page.locator("#right")).toContainText("Edited · goes to GitHub");

    await page.locator("#submitSlot [data-submit]").click();
    const panel = page.locator("#submitSlot .submit");
    await expect(panel).toContainText("Why 2 and not 3?", { timeout: 10_000 });
    await panel.locator("[data-submitgo]").click();
    await expect(panel).toContainText("Review posted", { timeout: 30_000 });

    const posted = JSON.parse(readFileSync(path.join(logDir, "review-stdin.json"), "utf8")) as { comments: { body: string }[] };
    expect(posted.comments).toHaveLength(1);
    expect(posted.comments[0].body).toContain("Why 2 and not 3?");
    expect(readFileSync(path.join(logDir, "body.md"), "utf8")).toContain("Edited by the reviewer.");
    const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
    expect(calls.match(/pulls\/1\/reviews/g) ?? []).toHaveLength(1);

    // Immediate second submit posts nothing new.
    await page.locator("#submitSlot [data-submit]").click().catch(() => {});
    const panel2 = page.locator("#submitSlot .submit");
    if (await panel2.locator("[data-submitgo]").count()) {
      await panel2.locator("[data-submitgo]").click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    const calls2 = readFileSync(path.join(logDir, "calls.log"), "utf8");
    expect(calls2.match(/pulls\/1\/reviews/g) ?? []).toHaveLength(1);
  });
});
