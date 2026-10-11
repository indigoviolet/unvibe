/**
 * Performance measurements for issue #23. Writes spikes/shiki/out/perf.json.
 *
 * - Mock web (VITE_MOCK=1): demo diff — TTFP before/after, time to
 *   highlighted, scroll long-tasks, memory, WS-patch cache behaviour.
 * - Real service (agent=none): multi-language review + generated 300-file
 *   review — per-language presence, header mount, scroll, PATCH path.
 *
 * Every server is started by this script (PID recorded) and killed by PID.
 */
import { chromium } from "@playwright/test";
import {
  OUT,
  apiJson,
  createBranchReview,
  killPid,
  makeLargeRepo,
  makeMultiLangRepo,
  rmdir,
  startMockWeb,
  startService,
  tmpdir,
} from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const results = {};
const note = (k, v) => {
  results[k] = v;
  console.log(`### ${k}:`, JSON.stringify(v).slice(0, 600));
};
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function newPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  return { ctx, page };
}

async function startLongTasks(page) {
  await page.evaluate(() => {
    window.__lt = [];
    const o = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lt.push(Math.round(e.duration));
    });
    o.observe({ entryTypes: ["longtask"] });
    window.__lto = o;
  });
}

async function stopLongTasks(page) {
  return page.evaluate(() => {
    window.__lto?.disconnect();
    const out = window.__lt ?? [];
    window.__lt = [];
    return { count: out.length, max: out.length ? Math.max(...out) : 0, total: out.reduce((s, x) => s + x, 0) };
  });
}

async function scrollPane(page) {
  await page.evaluate(async () => {
    const pane = document.querySelector("#right");
    if (!pane) return;
    for (let y = 0; y <= pane.scrollHeight; y += 1200) {
      pane.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    pane.scrollTo(0, 0);
  });
}

const heapMB = (page) =>
  page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---- A. demo diff on mock web -----------------------------------------
  {
    const { url, pid } = await startMockWeb(5931);
    try {
      // TTFP: file headers visible (plain first paint in both modes).
      for (const [label, q] of [["before", "?nohl=1"], ["after", ""]]) {
        const ts = [];
        for (let i = 0; i < 3; i++) {
          const { ctx, page } = await newPage(browser, url);
          const t0 = Date.now();
          await page.goto(`${url}/review/demo${q}`);
          await page.locator('[id^="F-"]').first().waitFor({ timeout: 30000 });
          ts.push(Date.now() - t0);
          await ctx.close();
        }
        note(`demo.ttfp.${label}.ms`, { runs: ts, median: median(ts) });
      }
      // Time to highlighted (visible/eager region).
      {
        const ts = [];
        for (let i = 0; i < 3; i++) {
          const { ctx, page } = await newPage(browser, url);
          const t0 = Date.now();
          await page.goto(`${url}/review/demo`);
          await page.locator('td.c .shk-kw').first().waitFor({ timeout: 30000 });
          ts.push(Date.now() - t0);
          await ctx.close();
        }
        note("demo.timeToHighlighted.ms", { runs: ts, median: median(ts) });
      }
      // Eager-region span census + cache stats.
      {
        const { ctx, page } = await newPage(browser, url);
        await page.goto(`${url}/review/demo`);
        await page.locator('td.c .shk-kw').first().waitFor({ timeout: 30000 });
        // Wait for the count to settle (lazy chunks streaming in).
        let last = -1;
        let stable = 0;
        let spans = 0;
        const t0 = Date.now();
        while (stable < 4 && Date.now() - t0 < 30000) {
          spans = await page.locator('td.c [class*="shk-"]').count();
          if (spans === last) stable++;
          else {
            stable = 0;
            last = spans;
          }
          await page.waitForTimeout(250);
        }
        const stats = await page.evaluate(() => window.__hlStats?.());
        note("demo.highlighted", { spans, msToSettle: Date.now() - t0, cache: stats });
        // Re-render via Hide toggle: spans + cache must not change.
        const before = await page.locator('td.c [class*="shk-"]').count();
        const t1 = Date.now();
        await page.getByRole("button", { name: "Hide uninteresting" }).click();
        await page.getByRole("button", { name: "Hide uninteresting" }).click();
        await page.waitForTimeout(500);
        const afterRe = await page.locator('td.c [class*="shk-"]').count();
        const stats2 = await page.evaluate(() => window.__hlStats?.());
        note("demo.rerender", { ms: Date.now() - t1, spansBefore: before, spansAfter: afterRe, cache: stats2 });
        await ctx.close();
      }
      // Scroll long-tasks + memory, before vs after.
      for (const [label, q] of [["before", "?nohl=1"], ["after", ""]]) {
        const { ctx, page } = await newPage(browser, url);
        await page.goto(`${url}/review/demo${q}`);
        await page.locator('[id^="F-"]').first().waitFor({ timeout: 30000 });
        if (q === "") await page.locator('td.c .shk-kw').first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1000);
        await startLongTasks(page);
        await scrollPane(page);
        const lt = await stopLongTasks(page);
        const mem = await heapMB(page);
        note(`demo.scroll.${label}`, { longtasks: lt, heapMB: Math.round(mem * 10) / 10 });
        await ctx.close();
      }
    } finally {
      await killPid(pid, "mock-web");
    }
  }

  // ---- B+C. real service: multi-language + large -------------------------
  {
    const dataDir = tmpdir("unvibe-shiki-perf-data-");
    const { origin, token, pid } = await startService(dataDir);
    let mlDir = "";
    let bigDir = "";
    try {
      // Multi-language review.
      mlDir = await makeMultiLangRepo();
      const t0 = Date.now();
      const mlId = await createBranchReview(origin, token, mlDir, "feature");
      note("multilang.ingest.ms", Date.now() - t0);
      const snap = await apiJson(origin, token, "GET", `/api/reviews/${mlId}`);
      const files = snap.files.map((f) => ({ path: f.path, fileKey: f.fileKey, hunks: f.hunks.length }));
      note("multilang.files", files);
      {
        const { ctx, page } = await newPage(browser, origin);
        const t1 = Date.now();
        await page.goto(`${origin}/review/${mlId}?token=${token}`);
        await page.locator('[id^="F-"]').first().waitFor({ timeout: 60000 });
        note("multilang.ttfp.ms", Date.now() - t1);
        // Turn Hide off so docs/config hunks (README) render too.
        const hide = page.getByRole("button", { name: "Hide uninteresting" });
        if ((await hide.getAttribute("aria-pressed")) === "true") await hide.click();
        const presence = {};
        for (const f of snap.files) {
          const sel = `[id="F-${f.fileKey}"]`;
          await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel).catch(() => {});
          await page.waitForTimeout(800);
          presence[f.path] = await page.locator(`${sel} td.c [class*="shk-"]`).count();
        }
        note("multilang.spansPerFile", presence);
        await ctx.close();
      }
      // Large review: 300 files / ~5k hunks.
      bigDir = await makeLargeRepo(300, 17);
      const t2 = Date.now();
      const bigId = await createBranchReview(origin, token, bigDir, "feature");
      note("large.ingest.ms", Date.now() - t2);
      const bigSnap = await apiJson(origin, token, "GET", `/api/reviews/${bigId}`);
      const hunks = bigSnap.files.reduce((s, f) => s + f.hunks.length, 0);
      note("large.shape", { files: bigSnap.files.length, hunks });
      {
        const { ctx, page } = await newPage(browser, origin);
        const t3 = Date.now();
        await page.goto(`${origin}/review/${bigId}?token=${token}`);
        await page.locator(".dfile").first().waitFor({ timeout: 120000 });
        await page.waitForFunction(() => document.querySelectorAll(".dfile").length >= 300, null, { timeout: 120000 });
        note("large.headerMount.ms", Date.now() - t3);
        // Only eager files render tables (lazy gate intact with highlight).
        const tables = await page.locator("table.diff").count();
        note("large.tablesMounted", tables);
        // Visible-region highlight time.
        const t4 = Date.now();
        await page.locator('td.c .shk-kw').first().waitFor({ timeout: 60000 }).catch(() => null);
        note("large.timeToHighlighted.ms", Date.now() - t4);
        const memBefore = await heapMB(page);
        // Full scroll with highlight (renders + tokenises every file).
        await startLongTasks(page);
        await scrollPane(page);
        const ltAfter = await stopLongTasks(page);
        const memAfter = await heapMB(page);
        note("large.scroll.after", { longtasks: ltAfter, heapMB: { before: r1(memBefore), after: r1(memAfter) } });
        const spansFull = await page.locator('td.c [class*="shk-"]').count();
        note("large.spansFull", spansFull);
        await ctx.close();
      }
      {
        // Same scroll with highlighting disabled: isolates highlight cost
        // from plain 5k-hunk DOM cost.
        const { ctx, page } = await newPage(browser, origin);
        await page.goto(`${origin}/review/${bigId}?token=${token}&nohl=1`);
        await page.waitForFunction(() => document.querySelectorAll(".dfile").length >= 300, null, { timeout: 120000 });
        await page.waitForTimeout(1000);
        const memBefore = await heapMB(page);
        await startLongTasks(page);
        await scrollPane(page);
        const ltBefore = await stopLongTasks(page);
        const memAfter = await heapMB(page);
        note("large.scroll.before", { longtasks: ltBefore, heapMB: { before: r1(memBefore), after: r1(memAfter) } });
        await ctx.close();
      }
      {
        const { ctx, page } = await newPage(browser, origin);
        await page.goto(`${origin}/review/${bigId}?token=${token}`);
        await page.locator('td.c .shk-kw').first().waitFor({ timeout: 60000 }).catch(() => null);
        // PATCH path with tokens cached: mark one hunk reviewed.
        const target = bigSnap.files[0].hunks[0].contentHash;
        const t5 = Date.now();
        await apiJson(origin, token, "PATCH", `/api/reviews/${bigId}/hunks/${target}`, { reviewed: true });
        await page.waitForTimeout(1500);
        const spansAfterPatch = await page.locator('td.c [class*="shk-"]').count();
        note("large.patch", { ms: Date.now() - t5, spansAfterPatch });
        await ctx.close();
      }
    } finally {
      await killPid(pid, "service");
      if (mlDir) rmdir(mlDir);
      if (bigDir) rmdir(bigDir);
      rmdir(dataDir);
    }
  }

  await browser.close();
  writeFileSync(path.join(OUT, "perf.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log("[harness] wrote out/perf.json");
  process.exit(0);
}

const r1 = (n) => Math.round(n * 10) / 10;

main().catch((e) => {
  console.error("[harness] FATAL", e);
  process.exit(1);
});
