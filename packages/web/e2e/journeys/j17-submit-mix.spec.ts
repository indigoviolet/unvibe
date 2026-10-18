/** J17 (#188): Submit with a mix — accepted suggestion, own comment, reply. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const CONN = "src-urllib3-connection.py";

function writeFakeGhAnyPr(binDir: string, logDir: string, headSha: string): void {
  const body = ["First paragraph of the PR body.", "", "Second paragraph with details."].join("\n");
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Journey PR","body":${JSON.stringify(body)},"author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"fix-obs-fold","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
case "$*" in *"/comments"*) echo '[]'; exit 0 ;; esac
case "$*" in *"/reviews"*) cat > "$LOG/review-stdin.json"; echo '{"html_url":"https://example.invalid/pr/5020"}'; exit 0 ;; esac
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then echo '{}'; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J17 submit a mix", () => {
  let dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let headSha = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j17-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j17-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j17-bin-"));
    // First boot (no fake gh yet): create the demo and learn its head sha.
    const probe = await startService(dataDir, { agent: "replay", label: "j17-probe" });
    reviewId = await createDemoReview(probe);
    const snapRes = await apiJson(probe, "GET", `/api/reviews/${reviewId}`);
    headSha = (snapRes.json as { version?: { headSha?: string } }).version?.headSha ?? "";
    // Let the whole pipeline settle before stopping: a render killed
    // mid-flight would leave its d2 temp dir behind (tripping #24).
    const deadline = Date.now() + 120_000;
    for (;;) {
      const jobsRes = await apiJson(probe, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (jobsRes.json as { jobs?: { state: string }[] }).jobs ?? [];
      if (jobs.length > 0 && jobs.every((j) => ["done", "error", "cancelled"].includes(j.state))) break;
      if (Date.now() > deadline) throw new Error("demo pipeline did not settle");
      await new Promise((r) => setTimeout(r, 500));
    }
    await probe.stop();
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("accepted suggestion + own comment + reply post as one review", async ({ page }) => {
    test.setTimeout(300_000);
    // Restart with fake gh first on PATH (login-shell stub, as in J3/J9).
    writeFakeGhAnyPr(fakeBin, logDir, headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });

    // Wait for a suggested comment, then accept it (mark for the PR).
    const deadline = Date.now() + 90_000;
    for (;;) {
      const s = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const anns = (s.json as { annotations?: { messages: { suggested?: boolean }[] }[] }).annotations ?? [];
      if (anns.some((a) => a.messages.some((m) => m.suggested))) break;
      if (Date.now() > deadline) throw new Error("no suggested comment landed");
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const sugMsg = page.locator("[data-ai-comment]").first();
    await expect(sugMsg).toBeVisible({ timeout: 60_000 });
    const sugText = (await sugMsg.innerText()).trim().slice(0, 40);
    expect(sugText).not.toBe("");
    const sugThread = page.locator(".ithread[data-thread]", { has: sugMsg }).first();
    await sugThread.getByRole("button", { name: "Mark for the PR" }).click();
    await expect(sugThread.getByRole("button", { name: /Marked for the PR/ })).toBeVisible({ timeout: 10_000 });

    // Own comment on the connection file, with a reply.
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile).toBeVisible({ timeout: 30_000 });
    await connFile.locator("td.n.new").first().click();
    const slot = connFile.locator(".ithread[data-pending-thread]");
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.locator("textarea").fill("My own note on this hunk.");
    await slot.getByRole("button", { name: "Save" }).click();
    const own = connFile.locator(".ithread[data-thread]", { hasText: "My own note on this hunk." });
    await expect(own).toBeVisible({ timeout: 15_000 });
    await own.getByPlaceholder("Reply…").fill("And a reply to it.");
    await own.getByRole("button", { name: "Reply" }).click();
    await expect(own).toContainText("And a reply to it.", { timeout: 15_000 });

    // Submit: the preview lists the mix; exactly one review is posted.
    await page.locator("#submitSlot [data-submit]").click();
    const panel = page.locator("#submitSlot .submit");
    await expect(panel).toContainText("My own note on this hunk.", { timeout: 15_000 });
    await expect(panel).toContainText(sugText.slice(0, 20), { timeout: 15_000 });
    await panel.locator("[data-submitgo]").click();
    await expect(panel).toContainText("Review posted", { timeout: 60_000 });
    const posted = JSON.parse(readFileSync(path.join(logDir, "review-stdin.json"), "utf8")) as {
      comments: { body: string }[];
    };
    const bodies = posted.comments.map((c) => c.body).join("\n");
    expect(bodies).toContain("My own note on this hunk.");
    expect(posted.comments.length).toBeGreaterThanOrEqual(2);
    const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
    expect(calls.match(/\/reviews/g) ?? []).toHaveLength(1);

  });
});
