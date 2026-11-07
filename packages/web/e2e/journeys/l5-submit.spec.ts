/**
 * L5 — Comments, Outbox, Submit and thread polish behaviour (#363 package C).
 *
 * The submit area in usage order: a comment surviving reload, Submit
 * posting exactly one review, a second submit posting nothing new, new
 * reviews hiding existing GitHub comments until the filter (#296), the
 * submit mix (accepted suggestion + own comment + reply as one review),
 * a branch comment in the Outbox by default with Markdown export, Ask
 * threads toggling into the Outbox with only the reviewer comment
 * (#339), draft edit/close/reopen/delete, gutter digits and the added
 * file dropping its empty column (#261), drafts surviving re-renders,
 * guide/description markers opening all vs preview items, the marker
 * toggle, the thread rest/focus/preview behaviour, and the shared inline
 * confirm (#346) for reviews and documents.
 *
 * Boots: ONE scratch-PR service with the counting fake `gh` (submit
 * exactly-once); ONE demo-mix service (replay probe, then the fake gh
 * for the submit); ONE branch-review service (Outbox, no PR); ONE demo
 * replay service (seeded markers + pipeline demos for the #339 toggle,
 * markers and polish behaviour); ONE scratch-PR service with the shared
 * fake `gh` (comment edges, gutter, drafts); ONE agent:none service with
 * a scratch repo (inline confirm). Fresh reviews per thread-mutating
 * test so journeys never share mutable state.
 *
 * Absorbs: `j3-comments-submit` (both), `j17-submit-mix`, `j223-outbox`,
 * `j339-outbox-toggle`, `j9-comment-edges` (all 3 describes),
 * `thread-polish-tour.spec.ts` (behaviour only: rest/focus states +
 * previews-open asserts + Summarize cycle + cited list; frames → tour),
 * `j346-inline-confirm` (both).
 *
 * Guards kept: #296 (existing GitHub comments hidden until the filter,
 * toggle shows them in diff + menu, remembered across reload); #339
 * (Outbox toggle on an Ask thread carries only the reviewer comment);
 * #346 (shared inline confirm: idle → confirming → "✓ Confirmed" flash →
 * row gone, Escape + outside-click cancel); #261 (gutter digits +
 * padding, added file drops the empty column, comment affordance);
 * #262 (marker toggle expand/collapse/mixed + tooltip); #258 (menu jump
 * links back to threads); #205 (markers open all, preview items open
 * one); #236 (Comments/Outbox tab counts); #301 (thread rest/focus,
 * Summarize icon cycle, comment thread shape); #302/#304 (glossary
 * label + compact chip); #305 (cited list); #315 (avatar-only entries);
 * #293 (question + answer entries).
 *
 * Security and submit guards — where each one landed:
 * - `gh`-write boundary (`test/gh-writes.test.ts`, unchanged): the L5
 *   fake `gh`s refuse any unexpected call (`exit 1`) and log every call
 *   to `calls.log`; the submit tests assert the log holds only the
 *   submit path (`pr view`, `api user`, comment/review reads, the single
 *   reviews POST, the description `pr edit`) and that the fake — not a
 *   real `gh` — served them (the log exists and names the fake's calls).
 * - Submit lease + crash safety (`src/submit/lease.ts` units,
 *   unchanged): journey-side, the second submit posts nothing new and
 *   the panel's own "Retry posts nothing twice" path is exercised.
 * - "Submit posts exactly one review": the POST-only counts
 *   (`pulls/<n>/reviews -X POST` == 1) — GET reads are excluded because
 *   #351 and #365 read reviews with GET too.
 * - Outbox export: the Markdown shape, counts and copy are asserted on
 *   the branch review (default-marked, removed, re-added).
 * - No-posting rule: nothing reaches GitHub except the Submit path —
 *   the fakes record every write (`review-stdin.json`, `body.md`) and
 *   the tests assert no other writes happened.
 * - Full-access opt-in (#160): the access-mode change itself is
 *   exercised in L4's multi-turn test; here Settings → Access keeps its
 *   inline confirm, and the harness strips `GITHUB_TOKEN` from every
 *   spawned service (PRD §15), so no test can post as the user.
 * - DATA_FORMAT stamp + reset-moves-aside (#311): owned by L10
 *   (package A); no L5 test resets data.
 * - `GITHUB_TOKEN` stripped in the harness (`service-harness.ts`,
 *   `delete env.GITHUB_TOKEN`); every L5 service boots through it.
 *
 * Brittleness fixed here (#363 §4): the `j3:142` 1 s post-submit sleep
 * (B2 — settle on the panel: the preview reloads into done/disabled
 * before the POST count is read); the `j2:670` 2 s Generate-loop sleep
 * lives in L4. No paired `boundingBox` reads in this file (the gutter
 * probe is one synchronous evaluate, #363 B1); popover hovers use the
 * shared `hoverFresh` helper (#363 B5).
 *
 * Frames removed (tour owns them; package D re-adds): j339's
 * outbox-toggle shot, j262's guide-open/guide-tip/desc-open shots, and
 * the whole thread-polish tour frame set (rest, toolbar, followup,
 * focused, marks-rest, glossary-preview, thread-preview, hunk-toolbar,
 * comment-thread, cited-list). No `shot()`/`screenshot` lines remain in
 * the gate.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { hoverFresh } from "../hover-fresh.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { fileKeyForPath } from "@unvibe/shared";
import {
  apiJson,
  createDemoReview,
  createScratchReview,
  createSeededDemoReview,
  makeScratchRepo,
  realGitPath,
  writeFakeGh,
  writeFakeGitOffline,
} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Fake-shell probe exactly as packages A and B use it: the service's
 * login-shell PATH probe prints the marker lines, so every `gh`/`git`
 * resolution in-test goes through the fake bin dir first. (#370: the
 * probe output must be well-formed or the service falls back to the real
 * login-shell PATH — the `calls.log` asserts below prove the fake `gh`
 * was the one called.) */
function writeFakeShell(binDir: string): string {
  const fakeShell = path.join(binDir, "fakeshell");
  writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${binDir}:$PATH"\n`, {
    mode: 0o755,
  });
  return fakeShell;
}

function postCount(logDir: string, pr: number | "any"): number {
  const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
  const re = pr === "any" ? /-X POST/g : new RegExp(`pulls/${pr}/reviews -X POST`, "g");
  return (calls.match(re) ?? []).length;
}

function loggedCalls(logDir: string): string {
  return readFileSync(path.join(logDir, "calls.log"), "utf8");
}

// ---------------------------------------------------------------------------
// j3's fake `gh`: answers pr view/user, serves two existing comments,
// records the single reviews POST and the description edit. Refuses
// anything else, so a write outside the Submit path fails loudly.
// Issue #351: the service also lists reviews (read-only GET) to offer a
// prior-review baseline; only the POST is a submit.
// Issue #296: one two-comment thread already on GitHub, on a line far
// from the reviewer's own line-2 thread below (made-up comments only).
// ---------------------------------------------------------------------------

function writeFakeGhSubmit(binDir: string, logDir: string, headSha: string): void {
  const body = ["First paragraph of the PR body.", "", "Second paragraph with details."].join("\n");
  const existing = JSON.stringify([
    {
      id: 9001,
      path: "src/app.py",
      line: 5,
      side: "RIGHT",
      body: "Teammate note: does helper need to handle zero?",
      user: { login: "teammate" },
      created_at: "2026-10-01T00:00:00Z",
      html_url: "https://example.invalid/repo/pull/1#discussion_r9001",
    },
    {
      id: 9002,
      path: "src/app.py",
      line: 5,
      side: "RIGHT",
      body: "Author reply: good catch, will follow up.",
      user: { login: "author" },
      in_reply_to_id: 9001,
      created_at: "2026-10-02T00:00:00Z",
      html_url: "https://example.invalid/repo/pull/1#discussion_r9002",
    },
  ]);
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
case "$*" in *pulls/1/comments*) printf '%s\n' '${existing}' > "$LOG/comments.json"; cat "$LOG/comments.json"; exit 0 ;; esac
case "$*" in *"pulls/1/reviews -X POST"*) cat > "$LOG/review-stdin.json"; echo '{"html_url":"https://example.invalid/pr/1"}'; exit 0 ;; esac
case "$*" in *pulls/1/reviews*) echo '[]'; exit 0 ;; esac
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  prev=""
  for arg in "$@"; do if [ "$prev" = "--body-file" ]; then cp "$arg" "$LOG/body.md"; fi; prev="$arg"; done
  echo '{}'; exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// j17's fake `gh`: accepts any PR number (demo review), records the
// single reviews POST. Refuses anything else.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scratch-PR service: comment + submit exactly-once + existing comments.
// ---------------------------------------------------------------------------

test.describe("L5 comments and submit on a scratch PR", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    const repoBase = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5-repo-"));
    repoDir = repoBase;
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5-bin-"));
    writeFakeGhSubmit(fakeBin, logDir, repo.headSha);
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      label: "l5submit",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });
  }

  test("comment survives reload, submit posts exactly one review, second submit posts nothing new", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);

    await test.step("a line comment starts no job and lands in the Outbox", async () => {
      await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
      const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
      await expect.soft(slot).toBeVisible();
      await slot.locator("textarea").fill("Why 2 and not 3?");
      await slot.getByRole("button", { name: "Save" }).click();
      const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Why 2 and not 3?" });
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
      // Comments start no agent job and are for the PR by default.
      await expect.soft(thread.locator(".working")).toHaveCount(0);
      await expect.soft(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible();
    });

    await test.step("the comment survives a reload", async () => {
      await page.reload();
      await expect.soft(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Why 2 and not 3?" })).toBeVisible({ timeout: 10_000 });
    });

    await test.step("edit the description, submit: the preview shows only the marked thread", async () => {
      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect.soft(page.locator("#right #d-p1")).toBeVisible();
      await page.locator("#right [data-descedit]").click();
      await page.locator("#right #descEdit").fill("First paragraph of the PR body. Edited by the reviewer.");
      await page.locator("#right [data-descsave]").click();
      await expect.soft(page.locator("#right")).toContainText("Edited · goes to GitHub");
      await page.locator("#submitSlot [data-submit]").click();
      const panel = page.locator("#submitSlot .submit");
      await expect.soft(panel).toContainText("Why 2 and not 3?", { timeout: 10_000 });
      await panel.locator("[data-submitgo]").click();
      await expect.soft(panel).toContainText("Review posted", { timeout: 30_000 });
    });

    await test.step("exactly one POST reached GitHub; reads don't count", async () => {
      const posted = JSON.parse(readFileSync(path.join(logDir, "review-stdin.json"), "utf8")) as {
        event: string;
        commit_id: string;
        comments: { path: string; body: string }[];
      };
      expect.soft(posted.event).toBe("COMMENT");
      expect.soft(posted.comments).toHaveLength(1);
      expect.soft(posted.comments[0]!.path).toBe("src/app.py");
      expect.soft(posted.comments[0]!.body).toContain("Why 2 and not 3?");
      expect.soft(readFileSync(path.join(logDir, "body.md"), "utf8")).toContain("Edited by the reviewer.");
      // The fake `gh` served the submit: pr view + the single POST.
      // GET reads (#351/#365) never count as submits — the `-X POST`
      // match is the whole assertion.
      expect.soft(loggedCalls(logDir)).toContain("pr view");
      expect.soft(postCount(logDir, 1)).toBe(1);
    });

    await test.step("an immediate second submit posts nothing new", async () => {
      await page.locator("#submitSlot [data-submit]").click().catch(() => {});
      const panel2 = page.locator("#submitSlot .submit");
      // Settle on the panel, not a sleep (#363 B2): the preview reloads
      // and lands with nothing left to post — either the go button is
      // gone/disabled or the done banner shows.
      const go2 = panel2.locator("[data-submitgo]");
      await expect
        .soft.poll(async () => {
          if ((await panel2.getByText("Review posted").count()) > 0) return "done";
          if ((await go2.count()) === 0) return "gone";
          return (await go2.isDisabled()) ? "disabled" : "ready";
        }, { timeout: 15_000 })
        .not.toBe("ready");
      if ((await go2.count()) > 0 && !(await go2.isDisabled())) {
        await go2.click().catch(() => {});
      }
      // Still exactly one POST: the retry posts nothing twice.
      expect.soft(postCount(logDir, 1)).toBe(1);
    });
  });

  test("new reviews start with existing GitHub comments hidden; the filter toggle shows them (#296)", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    // The stubbed gh served one two-comment thread: wait for ingest to store it.
    await expect
      .poll(async () => {
        const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        return ((snap.json as { existingComments?: unknown[] }).existingComments ?? []).length;
      }, { timeout: 60_000 })
      .toBe(2);

    await openReview(page);

    await test.step("hidden by default: no thread in the diff, the menu section folds", async () => {
      await expect.soft(page.locator("#gh-thread-9001")).toHaveCount(0);
      await page.locator('#reviewbar [data-cm=""]').click();
      const menu = page.locator(".cmenu");
      await expect.soft(menu.locator("[data-ghhead]")).toContainText("hidden");
      await expect.soft(menu.locator('[data-ghjump="9001"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
    });

    await test.step("the filter reveals them in the diff and the menu jumps back", async () => {
      await page.getByRole("button", { name: "Review filters" }).click();
      await page.getByRole("menuitemcheckbox", { name: /GitHub comments/ }).click();
      const thread = page.locator("#gh-thread-9001");
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
      await expect.soft(thread).toContainText("teammate · 2 comments");
      await thread.getByRole("button", { name: "Expand comments from teammate" }).click();
      await expect.soft(thread).toContainText("does helper need to handle zero?");
      // ...and in the comments menu, where the item jumps back to the thread.
      await page.locator('#reviewbar [data-cm=""]').click();
      const menu = page.locator(".cmenu");
      await expect.soft(menu.locator('[data-ghjump="9001"]')).toBeVisible();
      await menu.locator('[data-ghjump="9001"]').click();
      await expect.soft(menu).toHaveCount(0);
      await expect.soft(thread).toContainText("does helper need to handle zero?");
    });

    await test.step("existing comments read only under their own menu heading", async () => {
      await page.locator('#reviewbar [data-cm=""]').click();
      const menu = page.locator(".cmenu");
      await expect.soft(menu).toContainText("On GitHub");
      await expect.soft(menu).toContainText("teammate · 2 comments");
      await expect.soft(menu).toContainText("does helper need to handle zero?");
      await page.keyboard.press("Escape");
    });

    await test.step("the section heading restores hidden threads without the filter menu", async () => {
      await page.getByRole("button", { name: "Review filters" }).click();
      await page.getByRole("menuitemcheckbox", { name: /GitHub comments/ }).click();
      await expect.soft(page.locator("#gh-thread-9001")).toHaveCount(0);
      await page.locator('#reviewbar [data-cm=""]').click();
      const menu = page.locator(".cmenu");
      await expect.soft(menu.locator("[data-ghhead]")).toContainText("hidden");
      await menu.locator("[data-ghhead]").click();
      await expect.soft(menu.locator('[data-ghjump="9001"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(page.locator("#gh-thread-9001")).toBeVisible({ timeout: 10_000 });
    });

    await test.step("remembered with the review: still shown after reload", async () => {
      await page.reload();
      await expect.soft(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator("#gh-thread-9001")).toBeVisible({ timeout: 10_000 });
    });
  });
});

// ---------------------------------------------------------------------------
// Demo-mix service: accepted suggestion + own comment + reply, one review.
// ---------------------------------------------------------------------------

test.describe("L5 submit mix on the demo", () => {
  let dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let headSha = "";
  const CONN = "src-urllib3-connection.py";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5mix-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5mix-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5mix-bin-"));
    // First boot (no fake gh yet): create the demo and learn its head sha.
    const probe = await startService(dataDir, { agent: "replay", label: "l5mix-probe" });
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
    // Restart with fake gh first on PATH (login-shell stub, as in j3).
    writeFakeGhAnyPr(fakeBin, logDir, headSha);
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "replay",
      label: "l5mix",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    if (!svc) throw new Error("no service");
    const s: RunningService = svc;

    await test.step("a suggested comment lands; accept it into the Outbox", async () => {
      let sugId = "";
      let sugText = "";
      let sugLine = 0;
      // Issue #341: the first suggestion is no longer on the connection
      // file (re-recorded seeds lead with the socket-level test), so track
      // the suggestion's own file instead of assuming CONN.
      let sugFile = CONN;
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        const anns = (snap.json as { annotations?: { id: string; anchor?: { host?: { kind: string; fileKey?: string; line?: number } }; replies?: { suggested?: boolean; blocks?: { type: string; text?: { standard?: string } }[] }[] }[] }).annotations ?? [];
        const hit = anns
          .filter((a) => a.anchor?.host?.kind === "diff-line")
          .flatMap((a) => (a.replies ?? []).map((r) => ({ a, r })))
          .find(({ r }) => r.suggested);
        if (hit) {
          sugId = hit.a.id;
          if (hit.a.anchor?.host?.kind === "diff-line" && hit.a.anchor.host.line) sugLine = hit.a.anchor.host.line;
          if (hit.a.anchor?.host?.kind === "diff-line" && hit.a.anchor.host.fileKey) sugFile = hit.a.anchor.host.fileKey;
          sugText = (hit.r.blocks ?? [])
            .map((b) => (b.type === "paragraph" ? (b.text?.standard ?? "") : ""))
            .join(" ")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 40);
          break;
        }
        if (Date.now() > deadline) throw new Error("no suggested comment landed");
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(sugText).not.toBe("");
      expect(sugLine).toBeGreaterThan(0);
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      // Suggested threads start closed: open through the line's mark. The
      // re-recorded seeds anchor one suggestion mid-hunk (hidden rows), so
      // unfold everything first (issue #341).
      await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 10_000 }).catch(() => {});
      await page.locator(`[id="L-${sugFile}-${sugLine}"] td.n`).first().click();
      const sugThread = page.locator(`.ithread[data-thread="${sugId}"]`).first();
      await expect.soft(sugThread).toBeVisible({ timeout: 60_000 });
      await sugThread.getByRole("button", { name: "Add to Outbox" }).click();
      await expect.soft(sugThread.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible({ timeout: 10_000 });
    });

    await test.step("own comment plus a further comment thread on the same hunk", async () => {
      const connFile = page.locator(`[id="F-${CONN}"]`);
      await expect.soft(connFile).toBeVisible({ timeout: 30_000 });
      await connFile.locator("td.n.new").first().click();
      const slot = connFile.locator(".ithread[data-pending-thread]");
      await expect.soft(slot).toBeVisible({ timeout: 15_000 });
      await slot.locator("textarea").fill("My own note on this hunk.");
      await slot.getByRole("button", { name: "Save" }).click();
      const own = connFile.locator(".ithread[data-thread]", { hasText: "My own note on this hunk." });
      await expect.soft(own).toBeVisible({ timeout: 15_000 });
      // The thread ends in the single agent Reply box — no comment box.
      // A further comment goes through the selection toolbar's Comment
      // path and lands as its own thread on the same hunk.
      await expect.soft(own.locator("textarea")).toHaveCount(1);
      await selectText(page, `[id="F-${CONN}"] .ithread[data-thread]`, "My own note");
      await page.locator('#selbar [data-act="note"]').click();
      const slot2 = connFile.locator(".ithread[data-pending-thread]");
      await expect.soft(slot2).toBeVisible({ timeout: 15_000 });
      await slot2.locator("textarea").fill("And a reply to it.");
      await slot2.getByRole("button", { name: "Save" }).click();
      const reply = connFile.locator(".ithread[data-thread]", { hasText: "And a reply to it." });
      await expect.soft(reply).toBeVisible({ timeout: 15_000 });
    });

    await test.step("submit posts the mix as exactly one review through the fake", async () => {
      await page.locator("#submitSlot [data-submit]").click();
      const panel = page.locator("#submitSlot .submit");
      await expect.soft(panel).toContainText("My own note on this hunk.", { timeout: 15_000 });
      await panel.locator("[data-submitgo]").click();
      await expect.soft(panel).toContainText("Review posted", { timeout: 60_000 });
      const posted = JSON.parse(readFileSync(path.join(logDir, "review-stdin.json"), "utf8")) as {
        comments: { body: string }[];
      };
      const bodies = posted.comments.map((c) => c.body).join("\n");
      expect.soft(bodies).toContain("My own note on this hunk.");
      expect.soft(posted.comments.length).toBeGreaterThanOrEqual(2);
      // POST-only: the fake `gh` was the one called, exactly once.
      expect.soft(loggedCalls(logDir)).toContain("pr view");
      expect.soft(postCount(logDir, "any")).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Branch-review service: Outbox marking + Markdown export (no PR).
// ---------------------------------------------------------------------------

test.describe("L5 outbox export on a branch review", () => {
  let repoDir = "", dataDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5branch-repo-"));
    await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5branch-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5branch-bin-"));
    // Hermetic bin: the shared fake `gh` (never triggered on a branch
    // review) + offline `git`, behind the shared fake-shell probe — so a
    // stray network call fails loudly instead of reaching GitHub (#370).
    writeFakeGh(fakeBin, logDirShim(fakeBin), "deadbeef");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      label: "l5branch",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("branch comment is in the Outbox by default and exports as Markdown", async ({ page, context }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });

    await test.step("a branch comment lands marked for the Outbox", async () => {
      await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
      const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
      await expect.soft(slot).toBeVisible();
      await slot.locator("textarea").fill("Branch-only thought");
      await slot.getByRole("button", { name: "Save" }).click();
      const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Branch-only thought" });
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
      // Marking works with no PR: new comments are in the Outbox by default.
      await expect.soft(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible();
    });

    await test.step("the Outbox API exports it as Markdown", async () => {
      const exported = await apiJson(svc!, "GET", `/api/reviews/${reviewId}/outbox`);
      expect.soft(exported.status).toBe(200);
      const body = exported.json as unknown as { markdown: string; count: number };
      expect.soft(body.count).toBe(1);
      expect.soft(body.markdown).toContain("# Comments on ");
      expect.soft(body.markdown).toContain("## src/app.py:2");
      expect.soft(body.markdown).toContain("Branch-only thought");
    });

    await test.step("the menu tabs count Comments vs Outbox; the jump returns to the thread", async () => {
      // The menu has two counted tabs (#236): the Comments tab holds This
      // review and On GitHub, the Outbox tab the marked comment with its
      // draft and the export box.
      await page.locator('#reviewbar [data-cm=""]').click();
      const menu = page.locator(".cmenu");
      await expect.soft(menu.locator('[data-cmtab="comments"]')).toContainText("Comments 0");
      await expect.soft(menu.locator('[data-cmtab="outbox"]')).toContainText("Outbox 1");
      await expect.soft(menu.locator('[data-cmsec="review"]')).toHaveAttribute("aria-label", "This review, 0 comments");
      await expect.soft(menu.locator('[data-cmsec="review"]')).toContainText("Everything is marked in the Outbox tab.");
      await expect.soft(menu.locator('[data-cmsec="outbox"]')).toHaveCount(0);
      await expect.soft(menu.locator('[data-cmsec="github"]')).toHaveAttribute("aria-label", "On GitHub, 0 threads");
      await expect.soft(menu.locator('[data-cmsec="github"]')).toContainText("No review comments on GitHub yet.");
      await menu.locator('[data-cmtab="outbox"]').click();
      await expect.soft(menu.locator('[data-cmsec="outbox"]')).toHaveAttribute("aria-label", "Outbox, 1 comments");
      await expect.soft(menu.locator('[data-cmsec="outbox"]')).toContainText("Branch-only thought");
      // Entries under a file group show only their line, not the file again
      // (the export box below keeps the full anchor by design, #223).
      await expect.soft(menu.locator('[data-cmsec="outbox"] .cmgroup')).toHaveText("src/app.py");
      await expect.soft(menu.locator('[data-cmsec="outbox"] [data-cjump]')).toContainText(":2");
      await expect.soft(menu.locator('[data-cmsec="outbox"] [data-cjump]')).not.toContainText("src/app.py:2");
      const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Branch-only thought" });
      await menu.locator("[data-cjump]").first().click();
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
    });

    await test.step("the export box copies; removing returns the thread to This review", async () => {
      await page.locator('#reviewbar [data-cm=""]').click();
      await page.locator('.cmenu [data-cmtab="outbox"]').click();
      const menu = page.locator(".cmenu");
      const box = menu.locator("[data-outbox-md]");
      await expect.soft(box).toBeVisible({ timeout: 10_000 });
      await expect.soft(box).toContainText("Branch-only thought");
      await menu.locator("[data-copy-outbox]").click();
      await expect.soft(page.locator("body")).toContainText("Copied the Outbox Markdown", { timeout: 5_000 }).catch(() => {});
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
      if (clip) expect.soft(clip).toContain("Branch-only thought");
      // Removing from the Outbox returns the thread to This review and hides
      // the export box; the tab counts still add up to the one thread.
      await page.locator(".cmenu [data-cmclose]").click();
      const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Branch-only thought" });
      await thread.getByRole("button", { name: "Remove from the Outbox" }).click();
      await expect.soft(thread.getByRole("button", { name: "Add to Outbox" })).toBeVisible({ timeout: 10_000 });
      await page.locator('#reviewbar [data-cm=""]').click();
      await expect.soft(page.locator('.cmenu [data-cmtab="comments"]')).toContainText("Comments 1");
      await expect.soft(page.locator('.cmenu [data-cmtab="outbox"]')).toContainText("Outbox 0");
      await expect.soft(page.locator('.cmenu [data-cmsec="review"]')).toHaveAttribute("aria-label", "This review, 1 comments");
      await expect.soft(page.locator('.cmenu [data-cmsec="review"]')).toContainText("Branch-only thought");
      await page.locator('.cmenu [data-cmtab="outbox"]').click();
      await expect.soft(page.locator(".cmenu [data-outbox-md]")).toHaveCount(0);
      await expect.soft(page.locator('.cmenu [data-cmsec="outbox"]')).toContainText("Nothing in the Outbox yet.");
      const empty = await apiJson(svc!, "GET", `/api/reviews/${reviewId}/outbox`);
      expect.soft((empty.json as unknown as { count: number }).count).toBe(0);
    });
  });
});

/** The shared `writeFakeGh` needs a log dir; the branch review never
 * triggers `gh`, so point it at the bin dir itself (no extra temp dir,
 * no extra boot). */
function logDirShim(binDir: string): string {
  return binDir;
}

// ---------------------------------------------------------------------------
// Demo replay service: #339 toggle, guide/description markers, polish.
// ---------------------------------------------------------------------------

test.describe("L5 ask-thread outbox, markers and polish (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5demo-data-"));
    createSeededDemoReview(dataDir, "l5-markers");
    svc = await startService(dataDir, { agent: "replay", label: "l5demo" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("Ask thread + reviewer comment toggles into the Outbox with only the comment (#339)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    let threadId = "";
    await test.step("Ask on guide text; agent-only threads carry no Outbox toggle", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator("#C-problem section.ithread[data-thread]").first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
      threadId = (await thread.getAttribute("data-thread")) ?? "";
      expect(threadId).toBeTruthy();
      // Agent-only so far: no Outbox toggle (questions never reach the Outbox).
      await expect.soft(thread.getByRole("button", { name: "Add to Outbox" })).toHaveCount(0);
      await expect.soft(thread.getByRole("button", { name: "Remove from the Outbox" })).toHaveCount(0);
    });

    await test.step("a reviewer comment reply lands on the same thread and toggles cleanly", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const replied = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments/${threadId}/replies`, {
        text: "Reviewer note on the answer",
      });
      expect.soft(replied.status).toBe(200);
      // The toggle appears and works: no error toast, flips to marked.
      const toggle = thread.getByRole("button", { name: "Add to Outbox" });
      await expect.soft(toggle).toBeVisible({ timeout: 15_000 });
      await toggle.click();
      await expect.soft(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#toast")).not.toContainText("Couldn't update the Outbox");
    });

    await test.step("the Outbox and submit preview carry only the comment", async () => {
      const outbox = await apiJson(s, "GET", `/api/reviews/${reviewId}/outbox`);
      expect.soft(outbox.status).toBe(200);
      expect.soft((outbox.json as { count: number }).count).toBe(1);
      expect.soft((outbox.json as { markdown: string }).markdown).toContain("Reviewer note on the answer");
      const preview = await apiJson(s, "GET", `/api/reviews/${reviewId}/submit/preview`);
      expect.soft(preview.status).toBe(200);
      const comments = (preview.json as { preview: { comments: { threadId: string; text: string }[] } }).preview.comments;
      const entry = comments.find((c) => c.threadId === threadId);
      expect.soft(entry).toBeDefined();
      expect.soft(entry?.text).toContain("Reviewer note on the answer");
    });
  });

  test("guide and description markers open all; a preview item opens just its own", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    const reviewId = "l5-markers";
    const snapRes = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] };
      description?: { html?: string };
    };
    const central = (snap.pages as { id: string; cards: { id: string; blocks: { id: string }[] }[] }[] | undefined)?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    // Qualified `card#block`: bare block ids repeat across cards.
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    await test.step("seed three guide comments and three (closed) description comments", async () => {
      for (let i = 1; i <= 3; i++) {
        const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
          anchor: { where: "block", blockId },
          quote: "",
          text: `Guide note ${i}`,
        });
        expect(made.status).toBe(201);
      }
      for (let i = 1; i <= 3; i++) {
        const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
          anchor: { where: "description", paragraphId: paraId },
          quote: "",
          text: `Desc note ${i}`,
        });
        expect(made.status).toBe(201);
        const id = (made.json as { id: string }).id;
        // Description comments start open; close them so the marker shows.
        await apiJson(s, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
      }
    });

    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("a guide preview item opens only its own comment", async () => {
      const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
      await expect.soft(gMarker).toBeVisible({ timeout: 15_000 });
      await expect.soft(gMarker).toContainText("3");
      await hoverFresh(page, gMarker);
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
      await expect.soft(page.locator("#pop [data-open-thread]")).toHaveCount(3);
      await page.locator("#pop [data-open-thread]").nth(1).click();
      const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 2" });
      await expect.soft(gThread2).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 1" })).toHaveCount(0);
      await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 3" })).toHaveCount(0);
      // Close it, then the marker opens all three, stacked.
      await gThread2.getByRole("button", { name: "Close" }).click();
      await expect.soft(gThread2).toHaveCount(0, { timeout: 10_000 });
      await gMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: `Guide note ${i}` })).toBeVisible({ timeout: 15_000 });
      }
    });

    await test.step("description markers behave the same next to a paragraph", async () => {
      await page.locator('#right [role="tab"]').getByText(/description/i).click();
      const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
      await expect.soft(dMarker).toBeVisible({ timeout: 15_000 });
      await expect.soft(dMarker).toContainText("3");
      await hoverFresh(page, dMarker);
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
      await expect.soft(page.locator("#pop [data-open-thread]")).toHaveCount(3);
      await page.locator("#pop [data-open-thread]").nth(0).click();
      const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Desc note 1" });
      await expect.soft(dThread1).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: "Desc note 2" })).toHaveCount(0);
      await dThread1.getByRole("button", { name: "Close" }).click();
      await expect.soft(dThread1).toHaveCount(0, { timeout: 10_000 });
      await dMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: `Desc note ${i}` })).toBeVisible({ timeout: 15_000 });
      }
    });
  });

  test("comment marker is a toggle: expand, collapse, mixed, tooltip (#262)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    const snapRes = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      description?: { html?: string };
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    await test.step("seed three guide and three description toggle notes", async () => {
      for (let i = 1; i <= 3; i++) {
        const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
          anchor: { where: "block", blockId },
          quote: "",
          text: `Toggle note ${i}`,
        });
        expect(made.status).toBe(201);
      }
      for (let i = 1; i <= 3; i++) {
        const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
          anchor: { where: "description", paragraphId: paraId },
          quote: "",
          text: `Toggle desc ${i}`,
        });
        expect(made.status).toBe(201);
        const id = (made.json as { id: string }).id;
        await apiJson(s, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
      }
    });

    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("the guide marker expands all three and flips its tooltip", async () => {
      const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
      await expect.soft(gMarker).toBeVisible({ timeout: 15_000 });
      await expect.soft(gMarker).toContainText("3");
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Show comments");
      await gMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
      }
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Hide comments");
      // The tooltip states the collapse action.
      await hoverFresh(page, gMarker);
      await expect.soft(page.locator("#tip")).toContainText("Hide comments", { timeout: 10_000 });
      await page.keyboard.press("Escape");
    });

    await test.step("one click collapses all three; the marker state follows per-thread Close", async () => {
      const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
      await gMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toHaveCount(0, { timeout: 15_000 });
      }
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Show comments");
      // Mixed case: one open via its preview item, the marker opens all.
      await hoverFresh(page, gMarker);
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
      await page.locator("#pop [data-open-thread]").nth(1).click();
      const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 2" });
      await expect.soft(gThread2).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" })).toHaveCount(0);
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Show comments");
      await gMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
      }
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Hide comments");
      // Per-thread Close still works, and the marker's state follows it.
      const gThread1 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" });
      await gThread1.getByRole("button", { name: "Close" }).click();
      await expect.soft(gThread1).toHaveCount(0, { timeout: 10_000 });
      await expect.soft(gMarker).toHaveAttribute("data-tip", "Show comments");
    });

    await test.step("the description marker toggles the same way", async () => {
      await page.locator('#right [role="tab"]').getByText(/description/i).click();
      const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
      await expect.soft(dMarker).toBeVisible({ timeout: 15_000 });
      await expect.soft(dMarker).toContainText("3");
      await expect.soft(dMarker).toHaveAttribute("data-tip", "Show comments");
      await dMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
      }
      await expect.soft(dMarker).toHaveAttribute("data-tip", "Hide comments");
      await dMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toHaveCount(0, { timeout: 15_000 });
      }
      await expect.soft(dMarker).toHaveAttribute("data-tip", "Show comments");
      // Description mixed case: one open, the marker opens all.
      await hoverFresh(page, dMarker);
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
      await page.locator("#pop [data-open-thread]").nth(0).click();
      const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 1" });
      await expect.soft(dThread1).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 2" })).toHaveCount(0);
      await expect.soft(dMarker).toHaveAttribute("data-tip", "Show comments");
      await dMarker.click();
      for (let i = 1; i <= 3; i++) {
        await expect.soft(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
      }
      await expect.soft(dMarker).toHaveAttribute("data-tip", "Hide comments");
    });
  });

  test("thread rest, focus, previews, hunk Summarize cycle, comment thread, cited list", async ({ page }) => {
    test.setTimeout(420_000);
    const s = service();
    const created = await apiJson(s, "POST", "/api/reviews", { repoId: "demo" });
    const reviewId = (created.json as { review: { id: string } }).review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const pages = (snap.json as { pages?: { id: string; cards: { id: string; blocks: unknown[] }[] }[] }).pages ?? [];
      const root = pages.find((p) => p.id === "root");
      if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0)) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    let threadId = "";
    await test.step("Explain lands a thread at rest with an inline avatar", async () => {
      // Pick a guide paragraph holding a glossary term (and code when there
      // is one), and select the thread quote inside it: across the code
      // boundary when the paragraph has inline code, else plain words.
      const para = await page.evaluate(() => {
        const cands = [...document.querySelectorAll("#page p.sel")].filter((p) =>
          p.querySelector("a.gx[data-glossary]"),
        );
        const pick = (cands.length > 0 ? cands : [...document.querySelectorAll("#page p.sel")])[0];
        if (!pick) return null;
        pick.scrollIntoView({ block: "center" });
        pick.setAttribute("data-polish-para", "1");
        return 'p.sel[data-polish-para="1"]';
      });
      if (!para) throw new Error("no guide paragraph to thread");
      await page.evaluate((sel: string) => {
        const p = document.querySelector(sel);
        if (!p) throw new Error("paragraph lost");
        const code = p.querySelector("code");
        const sel2 = window.getSelection();
        if (!sel2) throw new Error("no selection");
        sel2.removeAllRanges();
        const range = document.createRange();
        if (code) {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          const texts: Text[] = [];
          for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
          const startIdx = texts.findIndex((t) => code.contains(t));
          const after = (startIdx >= 0 ? texts.slice(startIdx + 1) : []).filter(
            (t) => !code.contains(t) && t.data.trim() !== "",
          );
          const endText = after[Math.min(after.length - 1, 2)];
          const startNode = startIdx >= 0 ? texts[startIdx] : undefined;
          if (endText && startNode) {
            range.setStart(startNode, 0);
            range.setEnd(endText, Math.min(14, endText.data.length));
            sel2.addRange(range);
            (endText.parentElement ?? document).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return;
          }
        }
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if ((n as Text).parentElement?.closest?.("a, code")) continue;
          const hit = ((n as Text).data.match(/[A-Za-z]{5,}/) ?? [])[0];
          if (hit) {
            range.selectNodeContents(n as Text);
            const at = (n as Text).data.indexOf(hit);
            range.setStart(n as Text, at);
            range.setEnd(n as Text, at + hit.length);
            break;
          }
        }
        sel2.addRange(range);
        ((range.endContainer as Text).parentElement ?? document).dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true }),
        );
      }, para);
      await expect.soft(page.locator("#selbar")).toBeVisible({ timeout: 15_000 });
      // Explain fires immediately (no composer; Ask opens one): the thread
      // lands with a placeholder, then the replay agent fills the answer.
      await page.locator('#selbar [data-act="explain"]').click();
      const thread = page.locator("#page section.ithread[data-thread]").first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      threadId = (await thread.getAttribute("data-thread")) ?? "";
      expect(threadId).toBeTruthy();
      await expect.soft(thread.locator('[data-reply][data-kind="explain"] .exp-b').first()).not.toBeEmpty({
        timeout: 90_000,
      });
      // Issue #331: inline avatar, neutral surface, thread at rest.
      await thread.scrollIntoViewIfNeeded();
      await expect.soft(thread.locator(".spike-reply > .av.ai").first()).toBeVisible();
    });

    await test.step("hover reveals the reply toolbar; the single Reply box asks a follow-up", async () => {
      const thread = page.locator(`#page section.ithread[data-thread="${threadId}"]`);
      await thread.locator('[data-reply][data-kind="explain"] .exp-b').first().hover();
      await expect.soft(thread.locator(".spike-reply > .ctl").first()).toBeVisible({ timeout: 10_000 });
      // The single Reply box asks a follow-up (#293 shape: comment + answer).
      await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
      await thread.getByRole("button", { name: "Reply", exact: true }).click();
      await expect.soft(thread.locator("[data-ask-answer] .exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
      // Focused state: hovering the thread outlines it in accent (#301).
      await thread.hover();
      await expect
        .soft.poll(async () => thread.evaluate((el) => el.classList.contains("on")), { timeout: 10_000 })
        .toBe(true);
    });

    await test.step("close keeps a thread-link mark beside the glossary term; both previews open", async () => {
      const thread = page.locator(`#page section.ithread[data-thread="${threadId}"]`);
      await thread.getByRole("button", { name: "Close" }).click();
      await expect.soft(page.locator(`#page section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
        timeout: 15_000,
      });
      const mark = page.locator(`mark.anc.exl[data-jump="${threadId}"]:not(.fnote)`).first();
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      await mark.scrollIntoViewIfNeeded();
      // Glossary preview open (label + compact chip, #302/#304). Hover a
      // term outside the thread mark: on the #341 recording the quote starts
      // at the paragraph's first term, and a mark's own preview wins there.
      await page.evaluate(() => {
        const terms = [...document.querySelectorAll('p.sel[data-polish-para="1"] a.gx[data-glossary]')];
        const free = terms.find((a) => !a.closest("mark.anc") && !a.querySelector("mark.anc")) ?? terms[0];
        free?.setAttribute("data-polish-gx", "1");
      });
      const gx = page.locator('p.sel[data-polish-para="1"] a.gx[data-polish-gx="1"]');
      await hoverFresh(page, gx);
      await expect.soft(page.locator("#pop .pv-label", { hasText: "Glossary" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator("#pop button.lk[data-src]")).toHaveCount(1);
      // Thread-link preview open (pinned style, #302).
      await hoverFresh(page, mark);
      await expect.soft(page.locator("#pop .pv-thr")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("the hunk toolbar Summarize cycle opens, deletes and returns", async () => {
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      const idle = page.locator('#right p[data-hunksum]').first();
      await expect.soft(idle).toBeVisible({ timeout: 120_000 });
      const fileId = await idle.evaluate((el) => el.closest('[id^="F-"]')?.id ?? "");
      expect(fileId).toBeTruthy();
      const file = page.locator(`[id="${fileId}"]`);
      const knownThreads = await file
        .locator(".dhunk [data-thread]")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute("data-thread") ?? ""));
      await idle.scrollIntoViewIfNeeded();
      await idle.click();
      let hunkThreadId: string | null = null;
      await expect
        .soft.poll(
          async () => {
            const ids = await file
              .locator(".dhunk [data-thread]")
              .evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute("data-thread") ?? ""));
            hunkThreadId = ids.find((id) => id !== "" && !knownThreads.includes(id)) ?? null;
            return hunkThreadId;
          },
          { timeout: 15_000 },
        )
        .toBeTruthy();
      const hcard = file.locator(`.dhunk [data-thread="${hunkThreadId}"]`);
      await expect.soft(hcard).toBeVisible({ timeout: 15_000 });
      await hcard.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(hcard).toHaveCount(0, { timeout: 15_000 });
      // Delete takes the summary with it; the on-demand Summarize button
      // is back on the hunk.
      const summarize = file.getByRole("button", { name: "Summarize" }).first();
      await expect.soft(summarize).toBeVisible({ timeout: 15_000 });
    });

    await test.step("a comment thread on a diff line; a cited list keeps chips in items", async () => {
      const line = page.locator('#right td.n.new:visible').first();
      await expect.soft(line).toBeVisible({ timeout: 15_000 });
      await line.click();
      const slot = page.locator('#right .ithread[data-pending-thread]').first();
      await expect.soft(slot).toBeVisible({ timeout: 15_000 });
      await slot.locator("textarea").fill("Tour comment probe.");
      await slot.getByRole("button", { name: "Save" }).click();
      // #301: reviewer comment + Reply box.
      const comment = page.locator('#right section.ithread[data-thread]', { hasText: "Tour comment probe." }).first();
      await expect.soft(comment).toBeVisible({ timeout: 30_000 });
      // A card with a cited list: chips inside items, no row below (#305).
      // The guide stays mounted beside the diff pane; scroll the list chip
      // into view there.
      const chip = page.locator('#page .blk ul.lst li button.lk, #page .blk ol.lst li button.lk').first();
      await expect.soft(chip).toBeVisible({ timeout: 30_000 });
    });
  });
});

// ---------------------------------------------------------------------------
// Scratch service: comment edges, gutter, drafts.
// ---------------------------------------------------------------------------

test.describe("L5 comment edges, gutter and drafts on a scratch PR", () => {
  let repoDir = "", dataDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5edges-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5edges-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5edges-bin-"));
    // Shared fakes (not hand-rolled): the journey-helpers `gh` answers
    // pr view/user and records review posts; offline `git` never leaves
    // the box. The fake-shell probe puts the bin first (#370).
    writeFakeGh(fakeBin, fakeBin, repo.headSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      label: "l5edges",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });
  }

  test("comment again via toolbar, edit draft, close and reopen, then delete", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);

    await test.step("a second comment on the same line goes through the toolbar as its own thread", async () => {
      await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
      const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
      await expect.soft(slot).toBeVisible();
      await slot.locator("textarea").fill("First version of this note.");
      await slot.getByRole("button", { name: "Save" }).click();
      const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
      await expect.soft(thread.locator("textarea")).toHaveCount(1);
      await expect.soft(thread.locator('textarea[aria-label="Reply"]')).toBeVisible();
      await selectText(page, `[id="F-${appKey}"] .ithread[data-thread]`, "First version");
      await page.locator('#selbar [data-act="note"]').click();
      const slot2 = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
      await expect.soft(slot2).toBeVisible({ timeout: 10_000 });
      await slot2.locator("textarea").fill("A second thought on this line.");
      await slot2.getByRole("button", { name: "Save" }).click();
      const thread2 = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "A second thought on this line." });
      await expect.soft(thread2).toBeVisible({ timeout: 10_000 });
      await expect.soft(thread).toContainText("First version of this note.");
    });

    await test.step("edit the Outbox draft on the menu; it persists across reopen", async () => {
      await page.locator('#reviewbar [data-cm=""]').click();
      await page.locator('.cmenu [data-cmtab="outbox"]').click();
      const draft = page.locator(".cmenu .cm-entry", { hasText: "First version of this note." }).locator("textarea").first();
      await expect.soft(draft).toBeVisible({ timeout: 10_000 });
      await draft.fill("Edited version of this note.");
      await page.waitForResponse(
        (r) => r.url().includes("/comments/") && r.request().method() === "PATCH" && r.ok(),
        { timeout: 10_000 },
      );
      await page.keyboard.press("Escape");
      await page.locator('#reviewbar [data-cm=""]').click();
      await page.locator('.cmenu [data-cmtab="outbox"]').click();
      await expect.soft(page.locator(".cmenu .cm-entry", { hasText: "Edited version of this note." }).locator("textarea").first()).toHaveValue("Edited version of this note.");
      await page.keyboard.press("Escape");
    });

    await test.step("close leaves the comment icon; clicking the line reopens; delete clears both", async () => {
      const openThread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
      await expect.soft(openThread).toBeVisible({ timeout: 10_000 });
      await openThread.getByRole("button", { name: "Close" }).click();
      await expect.soft(openThread).toHaveCount(0, { timeout: 10_000 });
      // Closing leaves the comment icon permanently in place of the line
      // number (#285 E2); clicking the line reopens the thread.
      const numCell = page.locator(`[id="L-${appKey}-2"] td.n.new`);
      await expect.soft(numCell).toHaveClass(/e-commented/, { timeout: 10_000 });
      await expect.soft(numCell.locator(".nic")).toBeVisible({ timeout: 10_000 });
      await numCell.click();
      await expect.soft(openThread).toBeVisible({ timeout: 10_000 });
      // Delete removes them for good (both threads, leaving a clean slate).
      await openThread.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(openThread).toHaveCount(0, { timeout: 10_000 });
      const second = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "A second thought on this line." });
      await second.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(second).toHaveCount(0, { timeout: 10_000 });
      await page.reload();
      await expect.soft(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." })).toHaveCount(0);
    });
  });

  test("gutter is digits + padding; added file drops the empty column (#261)", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);
    const utilKey = fileKeyForPath("src/util.py");
    await test.step("modified file: two number columns, each digits + 8px padding, zero affordance", async () => {
      // Modified file: two number columns, each at most digits + 8px
      // padding with zero affordance room (issue #285); the new numbers
      // keep the comment affordance (click still opens the composer).
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const mod = await page.evaluate((key) => {
        const file = document.getElementById(`F-${key}`)!;
        const digits = Number.parseInt(file.style.getPropertyValue("--lnw"), 10) || 0;
        const sample = (file.querySelector("table.diff tbody > tr:not(.xsep) td.n") ?? file.querySelector("table.diff td.n"))!;
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
        const fcs = getComputedStyle(sample);
        probe.style.fontFamily = fcs.fontFamily;
        probe.style.fontSize = fcs.fontSize;
        probe.style.fontStyle = fcs.fontStyle;
        probe.style.fontWeight = fcs.fontWeight;
        probe.style.letterSpacing = fcs.letterSpacing;
        probe.textContent = "0123456789";
        document.body.appendChild(probe);
        const digitW = probe.getBoundingClientRect().width / 10;
        probe.remove();
        const cs = getComputedStyle(sample);
        const pad = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
        let oldMax = 0;
        let nwMax = 0;
        for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
          if (tr.classList.contains("xsep")) continue;
          const cells = [...tr.querySelectorAll(":scope > td.n")];
          if (cells.length === 2) {
            oldMax = Math.max(oldMax, cells[0].getBoundingClientRect().width);
            nwMax = Math.max(nwMax, cells[1].getBoundingClientRect().width);
          }
        }
        return { digits, digitW, pad, oldMax, nwMax };
      }, appKey);
      expect.soft(mod.oldMax).toBeGreaterThan(0);
      expect.soft(mod.oldMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 3);
      expect.soft(mod.nwMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 3);
      await expect.soft(page.locator(`[id="L-${appKey}-2"] td.n.new`)).toHaveAttribute("data-tip", /Comment on line 2/);
    });
    await test.step("added file: single number column", async () => {
      const added = await page.evaluate((key) => {
        const file = document.getElementById(`F-${key}`);
        if (!file) return null;
        const tables = [...file.querySelectorAll("table.diff:not(.split)")];
        const hideOld = tables.length > 0 && tables.every((t) => t.classList.contains("hide-old"));
        const counts: number[] = [];
        for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
          if (tr.classList.contains("xsep")) continue;
          counts.push(tr.querySelectorAll(":scope > td.n").length);
        }
        return { hideOld, counts: [...new Set(counts)] };
      }, utilKey);
      expect(added).not.toBeNull();
      expect.soft(added!.hideOld).toBe(true);
      expect.soft(added!.counts).toEqual([1]);
    });
  });

  test("draft survives re-renders; Discard clears without posting", async ({ page }) => {
    test.setTimeout(180_000);
    await openReview(page);
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect.soft(slot).toBeVisible();
    await slot.locator("textarea").fill("keep me");
    await test.step("an unrelated re-render keeps the draft", async () => {
      // An unrelated change elsewhere re-renders the panes (Hide
      // uninteresting toggles prefs without folding the open hunk).
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="uninteresting"]').click();
      await expect.soft(slot.locator("textarea")).toHaveValue("keep me");
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="uninteresting"]').click();
      await expect.soft(slot.locator("textarea")).toHaveValue("keep me");
    });
    await test.step("Discard on a new thread removes it without posting", async () => {
      await slot.getByRole("button", { name: "Discard" }).click();
      await expect.soft(slot).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Agent:none service: the shared inline confirm (#346).
// ---------------------------------------------------------------------------

test.describe("L5 inline confirm removes reviews and documents", () => {
  let dataDir = "";
  let repoDir = "";
  let repoId = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5confirm-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5confirm-repo-"));
    await makeScratchRepo(repoDir);
    const binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l5confirm-bin-"));
    writeFakeGitOffline(binDir, realGitPath());
    const fakeShell = writeFakeShell(binDir);
    svc = await startService(dataDir, {
      agent: "none",
      label: "l5confirm",
      extraEnv: { SHELL: fakeShell, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
    repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
      (r) => r.localPath === repoDir,
    )!.id;
    (svc as RunningService & { binDir?: string }).binDir = binDir;
  });

  test.afterAll(async () => {
    const binDir = (svc as (RunningService & { binDir?: string }) | null)?.binDir;
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
    if (binDir) rmSync(binDir, { recursive: true, force: true });
  });

  async function reviewIds(): Promise<string[]> {
    const list = await apiJson(svc!, "GET", "/api/reviews");
    expect(list.status).toBe(200);
    return (list.json as { reviews: { id: string }[] }).reviews.map((r) => r.id);
  }

  test("remove a review through the inline confirm", async ({ page }) => {
    const id = await createScratchReview(svc!, repoDir);
    await page.goto(`${svc!.origin}/?token=${svc!.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const row = page.locator(`[data-testid="session-${id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Escape cancels without touching the row; focus was on confirm.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect.soft(row.getByText("Confirm remove review")).toBeVisible();
    await expect.soft(row.getByRole("button", { name: "Confirm remove review" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect.soft(row.getByText("Confirm remove review")).toHaveCount(0);
    await expect.soft(row).toBeVisible();
    // An outside click cancels too.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect.soft(row.getByText("Confirm remove review")).toBeVisible();
    await page.getByRole("heading", { name: "Reviews" }).click();
    await expect.soft(row.getByText("Confirm remove review")).toHaveCount(0);
    await expect.soft(row).toBeVisible();
    // Confirm: the flash shows, then the row goes and the API forgets it.
    await row.getByRole("button", { name: "Remove this review" }).click();
    await row.getByRole("button", { name: "Confirm remove review" }).click();
    await expect.soft(row.getByText("Confirmed")).toBeVisible();
    await expect.soft(row).toHaveCount(0);
    expect.soft(await reviewIds()).not.toContain(id);
  });

  test("remove a document through the inline confirm", async ({ page }) => {
    await page.goto(`${svc!.origin}/documents?token=${svc!.token}`);
    await expect(page.getByRole("button", { name: "New document review" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill("# Remove me\n\nDelete this document review.\n");
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 60_000 });
    const docId = page.url().split("/review/")[1]!.split(/[/?#]/)[0]!;
    await page.goto(`${svc!.origin}/documents?token=${svc!.token}`);
    const row = page.locator(`[data-testid="session-${docId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect.soft(row).toContainText("Remove me");
    await row.getByRole("button", { name: "Remove this review" }).click();
    await expect.soft(row.getByText("Confirm remove review")).toBeVisible();
    await row.getByRole("button", { name: "Confirm remove review" }).click();
    await expect.soft(row.getByText("Confirmed")).toBeVisible();
    await expect.soft(row).toHaveCount(0);
    await expect.soft(page.getByTestId("documents-empty")).toBeVisible();
    expect.soft(await reviewIds()).not.toContain(docId);
  });
});
