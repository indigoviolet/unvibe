/** J14 (#188 round 2): diagrams render/fallback, Debug page, re-do a review. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import type { Locator, Page } from "@playwright/test";
import {
  canonicalizeD2Source,
  diagramHash,
  D2_MIN_VERSION,
  type DiagramBlock,
} from "@unvibe/shared";
import { createDemoReview, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J14 diagrams, debug, redo", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a diagram in the guide renders as SVG", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    // The go-deeper flow card carries the fixture diagram (pipeline fills it);
    // auto-written cards stay collapsed until opened (#217), so open it first.
    const flow = page.locator("#C-g-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow).toHaveClass(/collapsed/, { timeout: 120_000 });
    await flow.getByRole("button", { name: "Expand" }).click();
    const svg = page.locator(".dg-svg svg").first();
    const fallback = page.locator(".dg-fallback").first();
    await expect(svg.or(fallback)).toBeVisible({ timeout: 90_000 });
    if ((await svg.count()) > 0) {
      await expect(svg).toBeVisible();
    } else {
      // No d2 on this machine: the source fallback must say where to fix it.
      await expect(fallback).toContainText(/Settings/);
    }
  });

  test("debug page shows jobs and prompts for the review", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/reader|hunk|ask/i, { timeout: 30_000 });
    await page.getByRole("tab", { name: "Prompts" }).click();
    await expect(page.locator('[data-testid^="prompt-"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Jobs" }).click();
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 15_000 });
    // #207: one view per job — there is no separate Prompt button; the
    // Output view already shows each turn's prompt.
    await expect(page.getByRole("button", { name: "Prompt" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hide prompt" })).toHaveCount(0);
    // #207: the job row shows a tool count, not an unbounded list.
    // Expanding it shows one line per call; a line expands to the full
    // arguments and result.
    const toolsButton = page.getByRole("button", { name: /^Tools: \d+$/ }).first();
    await expect(toolsButton).toBeVisible({ timeout: 30_000 });
    await toolsButton.click();
    const jobTools = page.locator('[data-testid="job-tools"]').first();
    await expect(jobTools).toBeVisible({ timeout: 15_000 });
    const jobToolLines = jobTools.locator('[data-testid="job-tool"]');
    await expect(jobToolLines.first()).toContainText("Read", { timeout: 15_000 });
    await expect(jobToolLines.first()).toContainText("recording");
    await jobToolLines.first().locator("summary").click();
    await expect(jobToolLines.first()).toContainText("Arguments");
    await expect(jobToolLines.first()).toContainText("recording");
    await expect(jobToolLines.first()).toContainText("Returned the");
    // #207: a successful job's Output shows, per turn, its prompt, its
    // reply, a tool call with its result, and the raw usage payload.
    await page.getByRole("button", { name: "Output" }).first().click();
    const output = page.locator('[data-testid="job-output"]').first();
    await expect(output).toBeVisible({ timeout: 30_000 });
    await expect(output).toContainText("Reply 1");
    await expect(output).toContainText("Prompt");
    await expect(output).toContainText("Output");
    // Inside the view, tool calls are one line each in a bounded list;
    // a line expands to the full arguments and result.
    const turnTools = output.locator('[data-testid="job-turn-tools"]').first();
    await expect(turnTools).toBeVisible({ timeout: 15_000 });
    const turnToolLines = turnTools.locator('[data-testid="job-turn-tool"]');
    await expect(turnToolLines.first()).toContainText("Read");
    await expect(turnToolLines.first()).toContainText("recording");
    await turnToolLines.first().locator("summary").click();
    await expect(turnToolLines.first()).toContainText("Arguments");
    await expect(turnToolLines.first()).toContainText("Returned the");
    await expect(output).toContainText("Raw usage");
    await expect(output).toContainText("quota");
    await expect(output).toContainText("model_usage");
    // Back to the review itself.
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  });

  test("without d2 an unseeded diagram shows the source fallback with a Settings link", async ({ page }) => {
    test.setTimeout(240_000);
    const badData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-badd2-"));
    let bad: RunningService | null = null;
    try {
      // Seed the fixture review plus one diagram whose hash has no
      // pre-rendered SVG (same technique as d2-diagrams-service.spec.ts):
      // without d2 it cannot render, so the fallback is the user-visible path.
      const { readFileSync } = await import("node:fs");
      const { DatabaseSync } = await import("node:sqlite");
      const { fileURLToPath } = await import("node:url");
      const fixtureDir = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
      const snapshot = JSON.parse(readFileSync(path.join(fixtureDir, "snapshot.json"), "utf8")) as {
        rev: number; review: { id: string };
        pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
      };
      const meta = JSON.parse(readFileSync(path.join(fixtureDir, "meta.json"), "utf8")) as { keyAliases: Record<string, string> };
      let json = JSON.stringify(snapshot);
      for (const [a, r] of Object.entries(meta.keyAliases)) json = json.split(`diff:${a}:`).join(`diff:${r}:`);
      const seeded = JSON.parse(json) as typeof snapshot;
      seeded.review.id = "j14-d2-seed";
      const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-flow");
      if (!card) throw new Error("fixture has no g-flow card");
      const { canonicalizeD2Source, diagramHash, D2_MIN_VERSION } = await import("@unvibe/shared");
      const source = ['probe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}', 'probe2: "probe target"', 'probe -> probe2: "probe edge"'].join("\n");
      card.blocks.push({
        type: "diagram", id: "b-j14-extra", source,
        citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
        render: { hash: diagramHash(canonicalizeD2Source(source), D2_MIN_VERSION), status: "pending" },
      });
      const db = new DatabaseSync(path.join(badData, "unvibe.db"));
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, snapshot JSON NOT NULL, updated_at INTEGER NOT NULL);`);
        db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot")
          .run("j14-d2-seed", seeded.rev, JSON.stringify(seeded), Date.now());
      } finally { db.close(); }
      bad = await startService(badData, { agent: "replay", extraEnv: { UNVIBE_D2_BIN: "/nonexistent-d2" } });
      await page.goto(`${bad.origin}/review/j14-d2-seed?token=${bad.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
      const fallback = page.locator(".dg-fallback").first();
      await expect(fallback).toBeVisible({ timeout: 90_000 });
      await expect(fallback).toContainText(/Settings/);
    } finally {
      await bad?.stop().catch(() => {});
      rmSync(badData, { recursive: true, force: true });
    }
  });

  test("re-do from the debug page lands on a fresh review", async ({ page }) => {
    test.setTimeout(240_000);
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-repo-"));
    const redoData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-redo-"));
    let redoSvc: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      redoSvc = await startService(redoData, { agent: "none" });
      const id = await createScratchReview(redoSvc, repoDir);
      await page.goto(`${redoSvc.origin}/review/${id}/debug?token=${redoSvc.token}`);
      await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
      // #237: the caption lives on the button's tooltip, with no inline caption.
      const redo = page.getByRole("button", { name: "Re-do guide" });
      await expect(redo).toHaveAttribute("title", "Start the guide over from the same change.");
      await expect(page.getByText("Start the guide over from the same change.")).toHaveCount(0);
      await redo.click();
      await expect(page.getByText(/Anything already on GitHub stays there/)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Re-do guide" }).last().click();
      await expect.poll(() => page.url(), { timeout: 60_000 }).not.toContain(`/review/${id}`);
      await expect(page.locator("#right")).toBeVisible({ timeout: 60_000 });
    } finally {
      await redoSvc?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(redoData, { recursive: true, force: true });
    }
  });
});

// Merged from d2-diagrams-service.spec.ts (#256): the same assertions
// with `d2` available and with `UNVIBE_D2_BIN=/nonexistent` — seeded
// light + dark SVG serving, on-demand render vs 409, theme switching,
// hover previews, click-to-reveal, and the pipeline-emitted block. (The
// DISABLED(#119) keyboard-Enter test is not copied: the mock-mode
// d2-diagrams.spec.ts covers SVG-link activation.)
const D2_FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
const D2_SEED_REVIEW_ID = "d2-seed";
const D2_SEED_HASH = "f23beae236cc0685";

interface D2ApiResult {
  status: number;
  contentType: string;
  text: string;
}

/** Authenticated HTTP without subprocesses (review snapshots exceed execFile's buffer caps). */
async function d2Api(
  origin: string,
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<D2ApiResult> {
  const res = await fetch(`${origin}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
  };
}

function d2ApiJson(text: string): unknown {
  return text === "" ? null : (JSON.parse(text) as unknown);
}

/** Extra diagram block: valid cites, but a hash no pre-rendered seed has. */
const D2_EXTRA_SOURCE = [
  'd2seedprobe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}',
  'd2seedprobe2: "probe target"',
  'd2seedprobe -> d2seedprobe2: "probe edge"',
].join("\n");

const D2_EXTRA_HASH = diagramHash(canonicalizeD2Source(D2_EXTRA_SOURCE), D2_MIN_VERSION);

/** Lifted #286 features in one bundled-demo-safe sample (no icons: the
 * real service must not fetch from the network in tests): a container, a
 * markdown label, and a redeclared edge-style line. */
const D2_LIFTED_SOURCE = [
  "direction: right",
  "parser: {",
  '  msg: "HTTPMessage" {link: "diff:src-urllib3-connection.py:80-82"}',
  '  norm: |md **unfold** values | {link: "diff:src-urllib3-connection.py:91-110"}',
  '  msg -> norm: unfold {link: "diff:src-urllib3-connection.py:650-651"}',
  "}",
  'hdict: "HTTPHeaderDict"',
  'parser -> hdict: sync {link: "diff:src-urllib3-connection.py:650-651"}',
  "parser -> hdict: {style: {stroke-dash: 4}}",
].join("\n");

const D2_LIFTED_HASH = diagramHash(canonicalizeD2Source(D2_LIFTED_SOURCE), D2_MIN_VERSION);
const D2_SEEDED_HASHES = new Set([
  D2_SEED_HASH,
  "5897a4452ede567b",
  "d604f9a8e9fb637c",
]);

function seedD2Review(dataDir: string): void {
  const snapshot = JSON.parse(readFileSync(path.join(D2_FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
    pages: { id: string; cards: { id: string; blocks: DiagramBlock[] }[] }[];
  };
  const meta = JSON.parse(readFileSync(path.join(D2_FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot;
  seeded.review.id = D2_SEED_REVIEW_ID;
  const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-flow");
  if (!card) throw new Error("fixture has no root g-flow card");
  card.blocks.push({
    type: "diagram",
    id: "b-seed-extra",
    source: D2_EXTRA_SOURCE,
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: D2_EXTRA_HASH, status: "unavailable" },
  } as DiagramBlock);
  card.blocks.push({
    type: "diagram",
    id: "b-seed-lifted",
    source: D2_LIFTED_SOURCE,
    citations: [
      { target: "diff:src-urllib3-connection.py:80-82" },
      { target: "diff:src-urllib3-connection.py:91-110" },
      { target: "diff:src-urllib3-connection.py:650-651" },
    ],
    render: { hash: D2_LIFTED_HASH, status: "unavailable" },
  } as DiagramBlock);
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
    ).run(D2_SEED_REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
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
    ).run(D2_SEED_REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
  } finally {
    db.close();
  }
}

/** Hover an anchor deterministically (see interaction-journey-service.spec.ts). */
async function d2HoverFresh(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
    w.__lastScrollAt = Date.now();
    if (!w.__scrollHook) {
      w.__scrollHook = true;
      document.addEventListener(
        "scroll",
        () => {
          w.__lastScrollAt = Date.now();
        },
        true,
      );
    }
  });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400,
    { polling: 250, timeout: 10_000 },
  );
  await page.mouse.move(8, 200);
  const measure = (): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    locator.evaluate((target) => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const rs = target.getClientRects();
      for (let i = 0; i < rs.length; i++) out.push({ x: rs[i].x, y: rs[i].y, width: rs[i].width, height: rs[i].height });
      return out;
    });
  for (let i = 0; i < 4; i++) {
    const rects = await measure();
    if (rects.length === 0) throw new Error("anchor has no rects");
    const r = rects[Math.min(i, rects.length - 1)];
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    const onAnchor = await locator.evaluate(
      (target, p: { x: number; y: number }) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return !!hit && (hit === target || target.contains(hit));
      },
      { x, y },
    );
    if (onAnchor) return;
  }
  throw new Error("hover missed the anchor after 4 aims (layout still shifting?)");
}

for (const mode of [
  { name: "with d2", extraEnv: {} as Record<string, string>, expectBinary: true },
  { name: "without d2", extraEnv: { UNVIBE_D2_BIN: "/nonexistent" } as Record<string, string>, expectBinary: false },
]) {
  test.describe(`J14 D2 diagrams over the real service (${mode.name})`, () => {
    let dataDir = "";
    let svc: RunningService | null = null;
    let demoReviewId = "";

    test.beforeAll(async () => {
      test.setTimeout(240_000);
      expect(D2_SEEDED_HASHES.has(D2_EXTRA_HASH)).toBe(false);
      expect(D2_SEEDED_HASHES.has(D2_LIFTED_HASH)).toBe(false);
      dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j14-d2-data-"));
      seedD2Review(dataDir);
      svc = await startService(dataDir, {
        agent: "replay",
        extraEnv: mode.extraEnv,
        label: mode.expectBinary ? "j14-d2-with" : "j14-d2-without",
      });
      if (!svc) throw new Error("service not running");
      // The d2 readiness check proves which binary situation this suite runs in.
      const readiness = await d2Api(svc.origin, svc.token, "GET", "/api/readiness");
      expect(readiness.status).toBe(200);
      const checks = (
        d2ApiJson(readiness.text) as {
          checks: { id: string; status: string; summary: string }[];
        }
      ).checks;
      const d2 = checks.find((c) => c.id === "d2");
      expect(d2, "merged service must report a d2 readiness check").toBeTruthy();
      if (mode.expectBinary) {
        expect(d2!.status).toBe("ok");
        expect(d2!.summary).not.toContain("UNVIBE_D2_BIN");
      } else {
        expect(d2!.status).toBe("warning");
        expect(d2!.summary).toContain("UNVIBE_D2_BIN");
      }
      const created = await d2Api(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" });
      expect(created.status).toBe(201);
      demoReviewId = (d2ApiJson(created.text) as { review: { id: string } }).review.id;
      expect(demoReviewId).toMatch(/^rv_[0-9a-f]+$/);
    });

    test.afterAll(async () => {
      await svc?.stop().catch(() => {});
      svc = null;
      rmSync(dataDir, { recursive: true, force: true });
    });

    function service(): RunningService {
      if (!svc) throw new Error("service not running");
      return svc;
    }

    async function openReview(page: Page, reviewId: string): Promise<void> {
      const s = service();
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText(
        "Unfold obsolete folded response headers",
        { timeout: 30_000 },
      );
    }

    test("endpoint serves seeded light + dark SVG and 404s unknown hashes", async () => {
      test.setTimeout(60_000);
      const s = service();
      const dia = (hash: string, theme: string): Promise<D2ApiResult> =>
        d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${hash}?theme=${theme}`);
      const light = await dia(D2_SEED_HASH, "light");
      expect(light.status).toBe(200);
      expect(light.contentType).toContain("image/svg+xml");
      expect(light.text).toContain("<svg");
      // Contract anchors survive the service sanitiser.
      expect(light.text).toContain("data-refs");
      expect(light.text).toContain("data-src");
      expect(light.text).not.toContain("<script");
      const dark = await dia(D2_SEED_HASH, "dark");
      expect(dark.status).toBe(200);
      expect(dark.contentType).toContain("image/svg+xml");
      expect(dark.text).toContain("<svg");
      expect(dark.text).not.toBe(light.text);
      expect((await dia("deadbeefdeadbeef", "light")).status).toBe(404);
      const badReview = await d2Api(
        s.origin,
        s.token,
        "GET",
        `/api/reviews/rv_nonexistent/diagrams/${D2_SEED_HASH}?theme=light`,
      );
      expect(badReview.status).toBe(404);
    });

    test("fresh diagram renders on demand with d2, 409s without", async () => {
      test.setTimeout(120_000);
      const s = service();
      const urlPath = `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${D2_EXTRA_HASH}?theme=light`;
      const got = await d2Api(s.origin, s.token, "GET", urlPath);
      if (mode.expectBinary) {
        expect(got.status).toBe(200);
        expect(got.contentType).toContain("image/svg+xml");
        expect(got.text).toContain("<svg");
        expect(got.text).toContain("data-refs");
        // On-demand success heals the stored block to ok.
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}`);
        expect(snap.status).toBe(200);
        const blocks = (d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }).pages.flatMap(
          (p) => p.cards.flatMap((c) => c.blocks),
        );
        const extra = blocks.find((b) => b.type === "diagram" && b.id === "b-seed-extra");
        expect(extra?.render?.status).toBe("ok");
      } else {
        expect(got.status).toBe(409);
        expect((d2ApiJson(got.text) as { status: string }).status).toBe("unavailable");
      }
    });

    test("lifted #286 features render on demand with d2, 409 without", async () => {
      test.setTimeout(120_000);
      const s = service();
      const urlPath = `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${D2_LIFTED_HASH}?theme=light`;
      const got = await d2Api(s.origin, s.token, "GET", urlPath);
      if (mode.expectBinary) {
        expect(got.status).toBe(200);
        expect(got.contentType).toContain("image/svg+xml");
        expect(got.text).toContain("<svg");
        // Container, markdown label and edge style all survived.
        expect(got.text).toContain("data-refs");
        expect(got.text).not.toContain("foreignObject");
        // On-demand success heals the stored block to ok.
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}`);
        expect(snap.status).toBe(200);
        const blocks = (d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }).pages.flatMap(
          (p) => p.cards.flatMap((c) => c.blocks),
        );
        const lifted = blocks.find((b) => b.type === "diagram" && b.id === "b-seed-lifted");
        expect(lifted?.render?.status).toBe("ok");
      } else {
        expect(got.status).toBe(409);
        expect((d2ApiJson(got.text) as { status: string }).status).toBe("unavailable");
      }
    });

    test("seeded diagram renders in light and dark, hover previews, click reveals", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      const host = "#C-g-flow #B-b1 .dg-svg > svg";
      await expect(page.locator(host)).toBeVisible({ timeout: 30_000 });
      const lightHtml = await page.locator("#C-g-flow #B-b1 .dg-svg").innerHTML();
      expect(lightHtml).toContain("#FFFFFF");
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect
        .poll(async () => page.locator("#C-g-flow #B-b1 .dg-svg").innerHTML(), { timeout: 15_000 })
        .toContain("1E1E2E");
      await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

      const anchor = page.locator("#C-g-flow #B-b1 .dg-svg a[data-refs]").first();
      await d2HoverFresh(page, anchor);
      await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:650");
      const before = page.url();
      await anchor.click();
      expect(page.url()).toBe(before);
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
      await expect(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
        timeout: 10_000,
      });
    });

    test("fresh diagram shows SVG with d2, source fallback without", async ({ page }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      if (mode.expectBinary) {
        await expect(page.locator("#B-b-seed-extra .dg-svg > svg")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#B-b-seed-extra .dg-svg a[data-refs]")).toHaveCount(1);
      } else {
        const fallback = page.locator("#B-b-seed-extra .dg-fallback");
        await expect(fallback).toBeVisible({ timeout: 30_000 });
        await expect(fallback.locator("pre.code")).toContainText("d2seedprobe");
        await expect(fallback).toContainText("Diagrams need");
        const link = fallback.getByRole("link", { name: /Settings → Environment/ });
        await expect(link).toHaveAttribute("href", "/settings?tab=environment");
      }
    });

    test("lifted #286 diagram shows SVG with d2, source fallback without", async ({ page }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      if (mode.expectBinary) {
        await expect(page.locator("#B-b-seed-lifted .dg-svg > svg")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#B-b-seed-lifted .dg-svg a[data-refs]")).toHaveCount(4);
      } else {
        const fallback = page.locator("#B-b-seed-lifted .dg-fallback");
        await expect(fallback).toBeVisible({ timeout: 30_000 });
        await expect(fallback.locator("pre.code")).toContainText("parser");
      }
    });

    test("fresh demo review serves its pipeline-emitted diagram from seed", async () => {
      test.setTimeout(240_000);
      const s = service();
      // The reader-path block carries the parse-time seed hash, so poll for
      // the block itself (not render ok): the endpoint serves the seed.
      let hash = "";
      const deadline = Date.now() + 150_000;
      for (;;) {
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}`);
        expect(snap.status).toBe(200);
        const blocks = (
          d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }
        ).pages.flatMap((p) => p.cards.flatMap((c) => c.blocks));
        const found = blocks.find((b) => b.type === "diagram" && b.render?.hash);
        if (found?.render) {
          hash = found.render.hash;
          break;
        }
        if (Date.now() > deadline) throw new Error("demo pipeline emitted no diagram block in time");
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(hash).toBe(D2_SEED_HASH);
      const got = await d2Api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}/diagrams/${hash}?theme=light`);
      expect(got.status).toBe(200);
      expect(got.contentType).toContain("image/svg+xml");
    });

    test("fresh demo review renders its diagram in the guide", async ({ page }) => {
      test.setTimeout(240_000);
      await openReview(page, demoReviewId);
      // The diagram lives in the auto-written go-deeper card, which stays
      // collapsed until opened (#217); open it, then the SVG renders.
      const flow = page.locator("#C-g-flow");
      await flow.scrollIntoViewIfNeeded();
      await expect(flow).toHaveClass(/collapsed/, { timeout: 120_000 });
      await flow.getByRole("button", { name: "Expand" }).click();
      await expect(page.locator("#C-g-flow .dg-svg > svg")).toBeVisible({ timeout: 120_000 });
    });
  });
}
