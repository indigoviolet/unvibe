/** J2 (#188): Explain, Ask, follow-up, nested card, second opinion — replay. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import type { Locator } from "@playwright/test";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J2 explain ask follow-up nested", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("explain, ask with follow-up, nested explain, depth, second opinion", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Explain selected guide text; exactly one working indicator while it streams.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator("#C-central [data-expansion]").first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
    await expect(exp.locator(".working")).toHaveCount(0, { timeout: 30_000 });

    // Nested: select text inside the answer and Explain again.
    const word = await page.evaluate(() => {
      const text = document.querySelector("#C-central [data-expansion] .exp-b")?.textContent ?? "";
      return text.match(/[A-Za-z]{4,}/)?.[0] ?? "";
    });
    expect(word).not.toBe("");
    await selectText(page, "#C-central [data-expansion] .exp-b", word);
    await page.locator('#selbar [data-act="explain"]').click();
    const nested = exp.locator("[data-expansion]").first();
    await expect(nested).toBeVisible({ timeout: 15_000 });
    await expect(nested.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // Depth change rewrites the parent answer (visible change, not empty).
    const beforeDepth = await exp.locator(".exp-b").first().innerText();
    await exp.getByRole("button", { name: "Deeper" }).first().click();
    await expect.poll(async () => exp.locator(".exp-b").first().innerText(), { timeout: 60_000 }).not.toBe(beforeDepth);

    // Ask on guide text, then a follow-up in the same card.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    await expect(card.locator(".lk[data-refs]").first()).toBeVisible({ timeout: 30_000 });

    // Follow-up: use the card's reply box if present; otherwise its suggestion.
    const replyBox = card.locator("textarea").first();
    if ((await replyBox.count()) > 0) {
      await replyBox.fill("Does the fast path still catch a fold that uses a bare LF?");
      const send = card.getByRole("button", { name: /ask|send|reply/i }).first();
      await send.click();
      await expect(card.locator(".exp-b").last()).not.toBeEmpty({ timeout: 60_000 });
    }

    // #204: the Ask card opened pinned inline — no floating class, no
    // pin/unpin control — and its persisted state says pinned.
    await expect(card).not.toHaveClass(/floating/);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    const cardId = await card.getAttribute("data-expansion");
    expect(cardId).toBeTruthy();
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const anns = (snapRes.json as { annotations?: { id: string; pinned?: boolean }[] }).annotations ?? [];
    expect(anns.find((a) => a.id === cardId)?.pinned).toBe(true);

    // Close collapses the card back to its mark; hovering the mark shows
    // the floating peek, and clicking the peek pins the card back.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await mark.hover();
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop")).toContainText(/fold/i);
    await page.locator(`#pop [data-open-expansion="${cardId}"]`).click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toHaveClass(/floating/);

    // Delete removes both the card and its mark, across a reload.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`)).toHaveCount(0);

    // Second opinion on the bare-LF finding (its replay recording is keyed to it).
    await page.goto(`${svc.origin}/review/${reviewId}/page/f-lf?token=${svc.token}`);
    await expect(page.locator("#page")).toBeVisible({ timeout: 30_000 });
    const soBtn = page.locator('button[aria-label^="Second opinion ("]').first();
    if ((await soBtn.count()) > 0 && (await soBtn.isEnabled())) {
      await soBtn.click();
      await expect(page.locator("[data-so]").first()).toBeVisible({ timeout: 60_000 });
    } else {
      // No distinct second-opinion model is configured in replay settings:
      // the control must say so visibly, never silently do nothing.
      await expect(page.locator('[data-so-ctl] .so-warn, button[aria-label="Second opinion needs a different model"]').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("diff pane: explain opens pinned; close, mark, reopen, delete (#204)", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

    await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator(".dhunk .ui-card.child[data-expansion]").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    // Pinned inline in the diff too: no floating overlay, no pin control.
    await expect(card).not.toHaveClass(/floating/);
    await expect(page.locator(".dhunk .exp-float")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    const cardId = await card.getAttribute("data-expansion");
    expect(cardId).toBeTruthy();

    // Close collapses to the mark in the diff row; clicking the mark
    // reopens the card pinned.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    const mark = page.locator(`#right mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await mark.click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toHaveClass(/floating/);

    // Delete removes the card and its mark.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
  });

  // Merged from ask-service.spec.ts (#256): the Ask answer arrives as
  // blocks with citation markers through the streamed patch path (never
  // the old 60 s waiting fallback, never raw thread HTML), and streamed
  // agent text never renders (issue #46: fixed label only).
  test("ask answers with citations through the streamed patch path, no streamed text", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen = {
        working: false,
        stream: false,
      };
      const root = document.querySelector("#C-central");
      if (!root) return;
      new MutationObserver(() => {
        const seen = (window as unknown as { __m4seen: { working: boolean; stream: boolean } }).__m4seen;
        if (root.querySelector(".ui-card.child .working")) seen.working = true;
        if (root.querySelector(".ui-card.child .stream")) seen.stream = true;
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Does the fast path still catch a fold that uses a bare LF?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-central .ui-card.child[data-expansion]", {
      hasText: "Does the fast path still catch a fold",
    });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".ans-q").first()).toContainText("Does the fast path still catch a fold", {
      timeout: 30_000,
    });
    const marker = card.locator(".lk[data-refs]");
    await expect(marker.first()).toBeVisible({ timeout: 30_000 });
    await expect(marker.first()).toHaveAttribute("data-refs", /diff:/);
    await expect(card.locator(".working")).toHaveCount(0);
    const seen = await page.evaluate(
      () => (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen,
    );
    expect(seen?.working).toBe(true);
    expect(seen?.stream).toBe(false);
  });

  // Merged from depth-principle-service.spec.ts (#256, PRD §4.4): on a
  // page card and on a conversation card, stepping to the deepest level
  // then pressing + adds exactly one "Underlying principle" block;
  // pressing + again adds nothing and tells the user; undo removes it.
  // The deep fixture recordings carry the principle; the service adds it
  // only on + at the deepest level, never on the normal standard→deep step.
  function principleLocator(scope: Locator) {
    return scope.locator(".blk.gen-aside", { hasText: "Underlying principle" });
  }

  async function stepToDeep(card: Locator): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const principles = await principleLocator(card).count();
      if (principles > 0) break;
      const pips = card.locator(".pips i.on");
      const pipsBefore = await pips.count();
      await card.getByRole("button", { name: "Deeper" }).click();
      await expect
        .poll(
          async () => ((await principleLocator(card).count()) > 0 ? -1 : await pips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(pipsBefore);
      if ((await principleLocator(card).count()) > 0) {
        await card.getByRole("button", { name: "Undo" }).click();
        await expect(principleLocator(card)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
      if (i >= 1) break;
    }
  }

  test("page card: + at deepest adds one principle; + again tells; undo removes", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    // Fresh review: earlier tests in this file leave cards on the shared
    // review whose own Deeper buttons would capture the unscoped clicks.
    const freshId = await createDemoReview(svc);
    await page.goto(`${svc.origin}/review/${freshId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const card = page.locator("#C-central");

    await stepToDeep(card);
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });

    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 60_000 });
    await expect(principleLocator(card).first()).toContainText("Underlying principle");

    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    await card.getByRole("button", { name: "Undo" }).click();
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });
  });

  test("conversation card: same principle flow", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    // Fresh review: the page-card test above leaves its own state behind.
    const freshId = await createDemoReview(svc);
    await page.goto(`${svc.origin}/review/${freshId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const snap = await apiJson(svc, "GET", `/api/reviews/${freshId}`);
    const central = ((snap.json as { pages: { id: string; cards: { id: string; blocks: { id: string; type: string; text?: { standard: string } }[] }[] }[] }).pages ?? [])
      .find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const paras = (central?.blocks ?? []).filter((b) => b.type === "paragraph" && b.text?.standard);
    const host = paras.find((b) => b.text!.standard.includes("fast path")) ?? paras[0];
    if (!host?.text) throw new Error("central has no paragraph blocks");
    const quote = host.text.standard.includes("fast path") ? "fast path" : host.text.standard.slice(0, 12);
    const created = await apiJson(svc, "POST", `/api/reviews/${freshId}/actions`, {
      kind: "explain",
      quote,
      anchor: { where: "block", blockId: host.id },
    });
    const annId = (created.json as { annotationId: string; jobId?: string }).annotationId;
    if ((created.json as { jobId?: string }).jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = await apiJson(svc, "GET", `/api/reviews/${freshId}`);
        const ann = ((cur.json as { annotations: { id: string; turns?: { blocks: unknown[] }[] }[] }).annotations ?? []).find(
          (a) => a.id === annId,
        );
        if ((ann?.turns?.[0]?.blocks.length ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error("conversation did not fill in time");
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const exp = page.locator(`#C-central [data-expansion="${annId}"]`).first();
    await expect(exp).toBeVisible({ timeout: 30_000 });

    for (let i = 0; i < 2; i++) {
      const expPips = exp.locator(".pips i.on");
      const expPipsBefore = await expPips.count();
      await exp.getByRole("button", { name: "Deeper" }).click();
      await expect
        .poll(
          async () => ((await principleLocator(exp).count()) > 0 ? -1 : await expPips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(expPipsBefore);
      if ((await principleLocator(exp).count()) > 0) {
        await exp.getByRole("button", { name: "Undo" }).click();
        await expect(principleLocator(exp)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
    }
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });

    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 60_000 });

    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    await exp.getByRole("button", { name: "Undo" }).click();
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });
  });

  // Merged from interaction-none-service.spec.ts (#256): with
  // UNVIBE_AGENT unset (no agent), every agent control shows the
  // no-agent state while non-agent controls keep working.
  test("no-agent state: agent controls fail visibly, plain controls work", async ({ page }) => {
    test.setTimeout(300_000);
    const noneData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-none-"));
    let noneSvc: RunningService | null = null;
    try {
      noneSvc = await startService(noneData);
      const created = await apiJson(noneSvc, "POST", "/api/reviews", { repoId: "demo" });
      const noneId = (created.json as { review: { id: string } }).review.id;
      await page.goto(`${noneSvc.origin}/review/${noneId}?token=${noneSvc.token}`);
      await expect(page.locator("#right")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 30_000 });

      const hasGuide = (await page.locator("#C-central").count()) > 0;
      if (hasGuide) {
        await selectText(page, "#C-central", "the");
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#C-central [data-expansion]").first();
        await expect(exp).toBeVisible({ timeout: 15_000 });
        await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      } else {
        const cell = page.locator("#right table.diff td.c").first();
        await expect(cell).toBeVisible({ timeout: 30_000 });
        const text = (await cell.innerText()).slice(0, 12) || "test";
        await selectText(page, "#right table.diff", text.slice(0, 6));
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#right [data-expansion]").first();
        await expect(exp).toBeVisible({ timeout: 15_000 });
        await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      }

      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect(page.locator("#right .desc, #right .dbar").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("#toast")).toBeHidden({ timeout: 3000 }).catch(() => {});
    } finally {
      await noneSvc?.stop().catch(() => {});
      rmSync(noneData, { recursive: true, force: true });
    }
  });
});

// Merged from second-opinion-service.spec.ts (#256): a blind second
// opinion on the bare-LF finding completes, cites code, and its prompt
// snapshot contains no guide text; the UI renders the verdict chip.
const SO_FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
const SO_REVIEW_ID = "so-seed";

async function seedSecondOpinion(dataDir: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(path.join(SO_FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
  };
  const meta = JSON.parse(readFileSync(path.join(SO_FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot;
  seeded.review.id = SO_REVIEW_ID;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    );
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(SO_REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
    db.exec(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER, current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );`,
    );
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run("seed-repo", "seed", "repo", "/tmp", Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run(SO_REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
  } finally {
    db.close();
  }
}

test.describe("J2 blind second opinion on a finding (seeded)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-so-data-"));
    await seedSecondOpinion(dataDir);
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("blind second opinion completes, cites code, prompt has no guide text, chip renders", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("service not running");

    const acted = await apiJson(svc, "POST", `/api/reviews/${SO_REVIEW_ID}/actions`, {
      kind: "second_opinion",
      cardId: "flf-ev",
      mode: "blind",
    });
    expect(acted.status).toBe(200);
    const jobId = (acted.json as { jobId?: string }).jobId;
    expect(jobId).toBeTruthy();

    let state: string | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${SO_REVIEW_ID}`);
      expect(res.status).toBe(200);
      const jobs = (res.json as { jobs: { id: string; state: string; error?: string }[] }).jobs;
      const job = jobs.find((j) => j.id === jobId) ?? null;
      if (job && (job.state === "done" || job.state === "error" || job.state === "cancelled")) {
        state = job.state;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(state).toBe("done");

    // #207: the old /api/jobs/:id/prompt endpoint is gone; GET
    // /api/jobs/:id keeps the full job, prompt snapshot included.
    const promptRes = await apiJson(svc, "GET", `/api/jobs/${jobId}`);
    expect(promptRes.status).toBe(200);
    const prompt = (promptRes.json as { job: { promptSnapshot: string } }).job.promptSnapshot;
    expect(prompt).toContain("Second opinion");
    expect(prompt).not.toContain("are not unfolded");
    expect(prompt).not.toContain("The central change");

    const snapRes = await apiJson(svc, "GET", `/api/reviews/${SO_REVIEW_ID}`);
    expect(snapRes.status).toBe(200);
    const snap = snapRes.json as {
      pages: { id: string; cards: { id: string; secondOpinions?: { verdict: string; blocks: unknown[]; missed?: string }[] }[] }[];
    };
    const finding = snap.pages.find((p) => p.id === "f-lf");
    expect(finding).toBeDefined();
    const opinions = finding!.cards.flatMap((c) => c.secondOpinions ?? []);
    expect(opinions).toHaveLength(1);
    expect(opinions[0].verdict).toBe("partly");
    expect(opinions[0].blocks.length).toBeGreaterThan(0);
    expect(opinions[0].missed).toBeTruthy();

    await page.goto(`${svc.origin}/review/${SO_REVIEW_ID}/page/f-lf?token=${svc.token}`);
    await expect(page.locator("#page .eyebrow")).toContainText("Agent finding", { timeout: 30_000 });
    await expect(page.locator('[data-so][data-verdict="partly"]')).toBeVisible({ timeout: 30_000 });
  });
});

// Merged from expansion-nesting-service.spec.ts and
// interaction-journey-service.spec.ts (#256). Both flows select guide
// text, so each runs on its own fresh replay review: earlier cards on a
// shared review would capture the text selection and the toolbar.
test.describe("J2 nested and full reader journey (fresh reviews)", () => {
  test("nested explanation survives reload with its highlight", async ({ page }) => {
    test.setTimeout(300_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-nesting-data-"));
    let svc: RunningService | null = null;
    try {
      svc = await startService(dataDir, { agent: "replay" });
      const reviewId = await createDemoReview(svc);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30_000,
      });
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

      // Parent explanation on card text.
      await selectText(page, "#C-central", "fast path");
      await page.locator('#selbar [data-act="explain"]').click();
      const parent = page.locator("#C-central [data-expansion]").first();
      await expect(parent).toBeVisible({ timeout: 15_000 });
      await expect(parent.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

      // The toolbar appears for text selected inside the parent…
      const word = await page.evaluate(() => {
        const text = document.querySelector("#C-central [data-expansion] .exp-b")?.textContent ?? "";
        return text.match(/[A-Za-z]{4,}/)?.[0] ?? "";
      });
      expect(word).not.toBe("");
      await selectText(page, "#C-central [data-expansion] .exp-b", word);
      // …and Explain nests a card under the parent block.
      await page.locator('#selbar [data-act="explain"]').click();
      const nested = parent.locator("[data-expansion]").first();
      await expect(nested).toBeVisible({ timeout: 15_000 });
      await expect(nested.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

      // Reload: both cards survive and the nested highlight returns.
      await page.reload();
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const parentAfter = page.locator("#C-central [data-expansion]").first();
      await expect(parentAfter).toBeVisible({ timeout: 15_000 });
      const nestedAfter = parentAfter.locator("[data-expansion]").first();
      await expect(nestedAfter).toBeVisible({ timeout: 15_000 });
      await expect(nestedAfter.locator(".exp-b")).not.toBeEmpty({ timeout: 30_000 });
      await expect(parentAfter.locator("mark.anc.ex").first()).toBeVisible({ timeout: 10_000 });

      expect(errors).toEqual([]);
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("reader journey: depth, examples, undo, open as page, ask, go-deeper, contents", async ({ page }) => {
    test.setTimeout(300_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-journey-data-"));
    let svc: RunningService | null = null;
    try {
      svc = await startService(dataDir, { agent: "replay" });
      const reviewId = await createDemoReview(svc);
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30_000,
      });
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

      // Explain selected guide text; the expansion fills with streamed text.
      await selectText(page, "#C-central", "fast path");
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator("#C-central [data-expansion]").first();
      await expect(exp).toBeVisible({ timeout: 15_000 });
      await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });

      // Depth + on the fresh expansion generates via the agent, then −
      // (instant): the body text is rewritten each step.
      const expBody = exp.locator(".exp-b");
      const explained = await expBody.innerText();
      await exp.getByRole("button", { name: "Deeper" }).click();
      await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(explained);
      await expect(exp.locator(".working")).toHaveCount(0, { timeout: 60_000 });
      await expect(expBody).not.toBeEmpty({ timeout: 10_000 });
      const deepened = await expBody.innerText();
      await exp.getByRole("button", { name: "Simpler" }).click();
      await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(deepened);
      await expect(expBody).not.toBeEmpty();

      // Use examples, then Undo.
      // The explain fill already carries an Example aside, so examples is
      // saturated here (reused, no job): the count must not grow.
      const asides = exp.locator(".gen-aside");
      await expect(asides.first()).toBeVisible({ timeout: 30_000 });
      const asidesBefore = await asides.count();
      await exp.getByRole("button", { name: "Use examples" }).click();
      await expect(asides).toHaveCount(asidesBefore, { timeout: 10_000 });
      // Undo reverts the Simpler step: the deeper text returns.
      await exp.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => expBody.innerText(), { timeout: 30_000 }).toBe(deepened);

      // Close → dotted link → hover preview → click re-expands.
      await exp.getByRole("button", { name: "Close" }).click();
      await expect(page.locator("#C-central [data-expansion]").first()).toHaveCount(0, { timeout: 10_000 });
      const mark = page.locator("#C-central mark.anc.exl").first();
      await expect(mark).toBeVisible({ timeout: 10_000 });
      await mark.hover();
      await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await mark.click();
      await expect(page.locator("#C-central [data-expansion]").first()).toBeVisible({ timeout: 10_000 });

      // Open as page, then back.
      await page.locator("#C-central [data-expansion]").first().getByRole("button", { name: "Open as page" }).click();
      await expect(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
      await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
      await page.goBack();
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });

      // Ask on another block; the answer arrives as blocks with citations;
      // clicking one reveals the diff with a highlight.
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" });
      await expect(card.first()).toBeVisible({ timeout: 30_000 });
      await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const marker = card.locator(".lk[data-refs]");
      await expect(marker.first()).toBeVisible({ timeout: 30_000 });
      await marker.first().click();
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 10_000 });
      // The Ask card floats above the content below it — close it before
      // reaching under it, as a reader would.
      await card.first().getByRole("button", { name: "Close" }).click();

      // Go deeper: generate when a placeholder is still pending, else the
      // filled card. The follow-up chips live in the auto-written go-deeper
      // cards, which stay collapsed until opened (#217): open the flow card,
      // then use a follow-up suggestion.
      const pendings = page.locator("#page .ui-card.pend");
      if ((await pendings.count()) > 0) {
        await pendings.first().getByRole("button", { name: "Generate" }).click();
        await expect(pendings.first().locator(".working").first()).toBeVisible({ timeout: 15_000 });
        await expect(pendings.first()).toHaveCount(0, { timeout: 90_000 });
      }
      const flow = page.locator("#C-g-flow");
      await flow.scrollIntoViewIfNeeded();
      await expect(flow).toHaveClass(/collapsed/, { timeout: 120_000 });
      await flow.getByRole("button", { name: "Expand" }).click();
      const follow = page.locator("#C-g-flow .follow button").first();
      await expect(follow).toBeVisible({ timeout: 15_000 });
      const label = await follow.innerText();
      await follow.click();
      await expect(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 30_000 });

      // Collapse the card; Contents still lists it.
      await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
      await expect(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
      await expect(page.locator('nav.toc li [data-tocard="central"]')).toBeVisible();
      const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
      await expect(item).toBeVisible({ timeout: 10_000 });
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
