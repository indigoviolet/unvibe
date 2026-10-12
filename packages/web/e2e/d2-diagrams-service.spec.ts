/**
 * D2 diagrams over the real service (replay agent).
 *
 * HTTP goes through `fetch`, never `curl` subprocesses (review snapshots
 * exceed `execFile`'s default `maxBuffer`). Two suites run the same
 * assertions with `d2` available and with `UNVIBE_D2_BIN=/nonexistent`:
 * the seeded `d2-seed` review (fixture snapshot + one extra diagram block
 * whose hash has no pre-rendered seed) plus a fresh replay demo review.
 *
 * - Seeded fixture hashes serve light + dark SVG in both modes (seed hit).
 * - The extra block renders on demand with `d2` (and heals to ok) and
 *   409s `{status: "unavailable"}` without it; the UI shows the SVG or the
 *   source fallback with the Settings link accordingly.
 * - The fresh demo review proves the parse-time seed-hash placeholder
 *   end to end: its reader-path diagram block is fetchable / renders.
 *
 * The network-guard fixture asserts zero non-local requests and zero CSP
 * violations throughout — here against the real CSP header, which is what
 * validates the `style-src 'unsafe-inline'` claim end to end.
 *
 * Requires `mise run build` first (runs `packages/service/dist/index.js`
 * and serves `packages/web/dist`). The only skip in this file is the
 * missing-build guard below; every condition inside is an assertion.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Locator, Page } from "@playwright/test";
import {
  canonicalizeD2Source,
  diagramHash,
  D2_MIN_VERSION,
  type DiagramBlock,
} from "@unvibe/shared";

const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/urllib3-5020", import.meta.url));
const SEED_REVIEW_ID = "d2-seed";
const SEED_HASH = "f23beae236cc0685";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

interface ApiResult {
  status: number;
  contentType: string;
  text: string;
}

/** Authenticated HTTP without subprocesses (no buffer caps, no quoting). */
async function api(
  origin: string,
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<ApiResult> {
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

function apiJson(text: string): unknown {
  return text === "" ? null : (JSON.parse(text) as unknown);
}

/** Extra diagram block: valid cites, but a hash no fixture pre-renders. */
const EXTRA_SOURCE = [
  'd2seedprobe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}',
  'd2seedprobe2: "probe target"',
  'd2seedprobe -> d2seedprobe2: "probe edge"',
].join("\n");

const EXTRA_HASH = diagramHash(canonicalizeD2Source(EXTRA_SOURCE), D2_MIN_VERSION);
const SEEDED_HASHES = new Set([
  SEED_HASH,
  "5897a4452ede567b",
  "d604f9a8e9fb637c",
]);

/**
 * Seed the fixture snapshot as `d2-seed` plus the extra block (appended to
 * the root go-deeper flow card). Same ReviewStore-row technique as the
 * guide/second-opinion service specs.
 */
function seedD2Review(dataDir: string): void {
  const snapshot = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
    pages: { id: string; cards: { id: string; blocks: DiagramBlock[] }[] }[];
  };
  const meta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  // Canonicalize alias-form citations (see guide-service.spec.ts).
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot;
  seeded.review.id = SEED_REVIEW_ID;
  const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-flow");
  if (!card) throw new Error("fixture has no root g-flow card");
  card.blocks.push({
    type: "diagram",
    id: "b-seed-extra",
    source: EXTRA_SOURCE,
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: EXTRA_HASH, status: "unavailable" },
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
    ).run(SEED_REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
    // Jobs reference reviews(id): minimal parent rows (second-opinion spec).
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
    ).run(SEED_REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
  } finally {
    db.close();
  }
}

/**
 * Hover an anchor deterministically: scroll, wait for scroll quiet (a
 * scroll landing mid-hover dismisses the popover, PRD §4.5), move the
 * pointer in genuine steps, then aim at the anchor's own line boxes (a
 * wrapped anchor's union-box center can land on plain text) until the
 * cursor verifiably lands on it.
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
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
  test.describe(`D2 diagrams over the real service (${mode.name})`, () => {
    let dataDir = "";
    let svc: RunningService | null = null;
    let demoReviewId = "";

    test.beforeAll(async () => {
      test.setTimeout(240_000);
      // The extra block must not collide with a pre-rendered fixture seed,
      // or the unavailable/409 assertions below are meaningless.
      expect(SEEDED_HASHES.has(EXTRA_HASH)).toBe(false);
      dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-data-"));
      seedD2Review(dataDir);
      svc = await startService(dataDir, {
        agent: "replay",
        extraEnv: mode.extraEnv,
        label: mode.expectBinary ? "d2-with" : "d2-without",
      });
      // The d2 readiness check exists on the merged service; fetch it to
      // prove which binary situation this suite runs in (issue #17: a
      // missing UNVIBE_D2_BIN override warns instead of reporting ok).
      const readiness = await api(svc.origin, svc.token, "GET", "/api/readiness");
      expect(readiness.status).toBe(200);
      const checks = (
        apiJson(readiness.text) as {
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
      // Fresh replay demo review for the pipeline-emitted block path.
      const created = await api(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" });
      expect(created.status).toBe(201);
      demoReviewId = (apiJson(created.text) as { review: { id: string } }).review.id;
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
      const dia = (hash: string, theme: string): Promise<ApiResult> =>
        api(s.origin, s.token, "GET", `/api/reviews/${SEED_REVIEW_ID}/diagrams/${hash}?theme=${theme}`);
      const light = await dia(SEED_HASH, "light");
      expect(light.status).toBe(200);
      expect(light.contentType).toContain("image/svg+xml");
      expect(light.text).toContain("<svg");
      // Contract anchors survive the service sanitiser.
      expect(light.text).toContain("data-refs");
      expect(light.text).toContain("data-src");
      expect(light.text).not.toContain("<script");
      const dark = await dia(SEED_HASH, "dark");
      expect(dark.status).toBe(200);
      expect(dark.contentType).toContain("image/svg+xml");
      expect(dark.text).toContain("<svg");
      expect(dark.text).not.toBe(light.text);
      expect((await dia("deadbeefdeadbeef", "light")).status).toBe(404);
      const badReview = await api(
        s.origin,
        s.token,
        "GET",
        `/api/reviews/rv_nonexistent/diagrams/${SEED_HASH}?theme=light`,
      );
      expect(badReview.status).toBe(404);
    });

    test("fresh diagram renders on demand with d2, 409s without", async () => {
      test.setTimeout(120_000);
      const s = service();
      const urlPath = `/api/reviews/${SEED_REVIEW_ID}/diagrams/${EXTRA_HASH}?theme=light`;
      const got = await api(s.origin, s.token, "GET", urlPath);
      if (mode.expectBinary) {
        expect(got.status).toBe(200);
        expect(got.contentType).toContain("image/svg+xml");
        expect(got.text).toContain("<svg");
        expect(got.text).toContain("data-refs");
        // On-demand success heals the stored block to ok.
        const snap = await api(s.origin, s.token, "GET", `/api/reviews/${SEED_REVIEW_ID}`);
        expect(snap.status).toBe(200);
        const blocks = (apiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }).pages.flatMap(
          (p) => p.cards.flatMap((c) => c.blocks),
        );
        const extra = blocks.find((b) => b.type === "diagram" && b.id === "b-seed-extra");
        expect(extra?.render?.status).toBe("ok");
      } else {
        expect(got.status).toBe(409);
        expect((apiJson(got.text) as { status: string }).status).toBe("unavailable");
      }
    });

    test("seeded diagram renders in light and dark, hover previews, click reveals", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, SEED_REVIEW_ID);
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
      await hoverFresh(page, anchor);
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

    test("keyboard Enter on a cited shape reveals without changing the URL", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, SEED_REVIEW_ID);
      await expect(page.locator("#C-g-flow #B-b1 .dg-svg > svg")).toBeVisible({ timeout: 30_000 });
      const before = page.url();
      const anchor = page.locator("#C-g-flow #B-b1 .dg-svg a[data-refs]").first();
      await anchor.focus();
      await expect(anchor).toBeFocused();
      await page.keyboard.press("Enter");
      expect(page.url()).toBe(before);
      await expect(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
        timeout: 10_000,
      });
    });

    test("fresh diagram shows SVG with d2, source fallback without", async ({ page }) => {
      test.setTimeout(120_000);
      await openReview(page, SEED_REVIEW_ID);
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

    test("fresh demo review serves its pipeline-emitted diagram from seed", async () => {
      test.setTimeout(240_000);
      const s = service();
      // The reader-path block carries the parse-time seed hash, so poll for
      // the block itself (not render ok): the endpoint serves the seed.
      let hash = "";
      const deadline = Date.now() + 150_000;
      for (;;) {
        const snap = await api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}`);
        expect(snap.status).toBe(200);
        const blocks = (
          apiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }
        ).pages.flatMap((p) => p.cards.flatMap((c) => c.blocks));
        const found = blocks.find((b) => b.type === "diagram" && b.render?.hash);
        if (found?.render) {
          hash = found.render.hash;
          break;
        }
        if (Date.now() > deadline) throw new Error("demo pipeline emitted no diagram block in time");
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(hash).toBe(SEED_HASH);
      const got = await api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}/diagrams/${hash}?theme=light`);
      expect(got.status).toBe(200);
      expect(got.contentType).toContain("image/svg+xml");
    });

    test("fresh demo review renders its diagram in the guide", async ({ page }) => {
      test.setTimeout(240_000);
      await openReview(page, demoReviewId);
      await expect(page.locator("#C-g-flow .dg-svg > svg")).toBeVisible({ timeout: 120_000 });
    });
  });
}
