/**
 * D2 diagrams (docs/d2-diagrams.md).
 *
 * Unit (fake binary via FakeCommandRunner / UNVIBE_D2_BIN override — always
 * run, never needs `d2`): discovery/version gate, pre-check denylist,
 * finalize branches (cite invalid → repair; compile error → repair;
 * unavailable), cache (put/get/seed), endpoint (auth, 404/409, theme),
 * sanitiser hostile cases, parser round-trip (shared suite covers the rest).
 *
 * Real binary (skipped with a visible notice when absent; run in CI where
 * the workflow installs d2): reference diagrams compile + render
 * deterministically, anchors rewritten, no network/file access, caps.
 *
 * Replay end to end: demo diagram comes back `ok` from the seeded cache
 * without `d2` installed (UNVIBE_D2_BIN pointed nowhere).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalizeD2Source,
  diagramHash,
  extractD2Links,
  D2_MIN_VERSION,
} from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  D2_MIN,
  d2InstallHint,
  meetsD2MinVersion,
  parseD2Version,
  resolveD2Bin,
} from "../src/diagrams/bins.js";
import { precheckD2Source } from "../src/diagrams/precheck.js";
import { DiagramCache } from "../src/diagrams/cache.js";
import {
  postProcessSvg,
  rewriteCitationAnchors,
  sanitizeSvg,
  stripTokenTitles,
  type CitationMap,
} from "../src/diagrams/sanitize.js";
import { finalizeDiagramBlock } from "../src/diagrams/pipeline.js";
import { createSnapshotLookup } from "../src/validate/index.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";
import type { ReviewSnapshot } from "@unvibe/shared";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const authed = { authorization: "Bearer tok" };

// --- discovery / version gate -------------------------------------------

describe("d2 discovery", () => {
  it("resolves UNVIBE_D2_BIN override and login-shell PATH", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-dir-"));
    const fakeBin = path.join(dir, "d2");
    fs.writeFileSync(fakeBin, "#!/bin/sh\necho v0.9.0\n");
    fs.chmodSync(fakeBin, 0o755);
    try {
      expect(resolveD2Bin({ env: { UNVIBE_D2_BIN: fakeBin }, pathValue: "" })?.path).toBe(fakeBin);
      expect(resolveD2Bin({ env: { UNVIBE_D2_BIN: "/nonexistent/d2" }, pathValue: "" })?.source).toMatch(/missing/);
      expect(resolveD2Bin({ env: {}, pathValue: "" })).toBeNull();
      expect(resolveD2Bin({ env: {}, pathValue: dir })?.path).toBe(fakeBin);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gates the minimum version (0.9.0)", () => {
    expect(D2_MIN).toBe("0.9.0");
    expect(D2_MIN_VERSION).toBe("0.9.0");
    expect(parseD2Version("d2 v0.9.0")).toBe("0.9.0");
    expect(parseD2Version("v0.9.0")).toBe("0.9.0");
    expect(meetsD2MinVersion("0.9.0")).toBe(true);
    expect(meetsD2MinVersion("0.10.0")).toBe(true);
    expect(meetsD2MinVersion("0.8.9")).toBe(false);
    expect(d2InstallHint()).toMatch(/brew install d2/);
  });
});

// --- shared pure helpers --------------------------------------------------

describe("d2 shared helpers", () => {
  it("extracts link: cites (quoted, bare, bracket-wrapped)", () => {
    expect(extractD2Links('a: {link: "diff:conn:80-88"}')).toEqual(["diff:conn:80-88"]);
    expect(extractD2Links("a -> b: x {link: diff:conn:1-2}")).toEqual(["diff:conn:1-2"]);
    expect(extractD2Links('a: {link: "[[diff:conn:91-110]]"}')).toEqual(["diff:conn:91-110"]);
    expect(extractD2Links('a: {link: "code:src/x.py:10-20"}')).toEqual(["code:src/x.py:10-20"]);
    expect(extractD2Links("no links here")).toEqual([]);
  });

  it("canonicalises and hashes deterministically", () => {
    expect(canonicalizeD2Source("a -> b  \r\n\r\n")).toBe("a -> b");
    const h1 = diagramHash("a -> b", "0.9.0");
    expect(diagramHash("a -> b\r\n", "0.9.0")).toBe(h1);
    expect(diagramHash("a -> b", "0.10.0")).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });
});

// --- pre-check denylist (§9 table) -----------------------------------------

describe("d2 precheck", () => {
  const ok = (s: string): boolean => precheckD2Source(s).ok;
  it("accepts the reference shapes", () => {
    expect(ok('direction: right\na -> b: go {link: "diff:conn:1-2"}')).toBe(true);
  });
  it("rejects every denied construct", () => {
    expect(ok('a: {icon: https://example.com/x.svg}\na -> b')).toBe(false);
    expect(ok("a: {shape: image}\na -> b")).toBe(false);
    expect(ok("...@file.d2\na -> b")).toBe(false);
    expect(ok("x: @file.d2\na -> b")).toBe(false);
    expect(ok("a: |md hello |\na -> b")).toBe(false);
    expect(ok("a: |tex hello |\na -> b")).toBe(false);
    expect(ok("a: |latex hello |\na -> b")).toBe(false);
    expect(ok("vars: {x: 1}\na -> b")).toBe(false);
    expect(ok("d2-config: {}\na -> b")).toBe(false);
    expect(ok("classes: {x: {}}\na -> b")).toBe(false);
    expect(ok('a: {tooltip: hi}\na -> b')).toBe(false);
    expect(ok("layers: {x: {}}\na -> b")).toBe(false);
    expect(ok("scenarios: {x: {}}\na -> b")).toBe(false);
    expect(ok("a -> b: https://example.com")).toBe(false);
    expect(precheckD2Source("").ok).toBe(false);
  });
  it("enforces the 12-shape / 16-connection caps", () => {
    const manyShapes = Array.from({ length: 13 }, (_, i) => `n${i}: "N${i}"`).join("\n");
    expect(ok(manyShapes)).toBe(false);
    const manyEdges = Array.from({ length: 17 }, (_, i) => `a${i} -> b${i}`).join("\n");
    expect(ok(manyEdges)).toBe(false);
  });
});

// --- sanitiser hostile cases -----------------------------------------------

describe("svg sanitiser", () => {
  it("rewrites citation anchors and strips every other href", () => {
    const cmap: CitationMap = new Map([
      ["diff:conn:1-2", { canonical: "diff:conn:1-2" }],
      ["diff:conn:9", { canonical: "diff:conn:9", unverified: true }],
    ]);
    const svg =
      `<svg><a href="diff:conn:1-2" xlink:href="diff:conn:1-2"><text>hi</text></a>` +
      `<a href="diff:conn:9"><text>unv</text></a>` +
      `<a href="https://evil.example/x"><text>evil</text></a>` +
      `<a href="javascript:alert(1)"><text>js</text></a></svg>`;
    const out = postProcessSvg(svg, cmap, "abc123");
    expect(out).toContain('data-refs="diff:conn:1-2"');
    expect(out).toContain('data-src="diff:conn:1-2"');
    expect(out).toContain('data-unverified="true"');
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("xlink:href");
    // Only "#" hrefs survive.
    for (const m of out.matchAll(/href="([^"]*)"/g)) {
      expect(m[1]).toBe("#");
    }
  });

  it("drops token titles, scripts, foreignObject, event handlers, external urls", () => {
    const nasty =
      `<svg><title>see diff:conn:1-2</title><title>plain</title>` +
      `<script>alert(1)</script><foreignObject><div>html</div></foreignObject>` +
      `<rect onclick="evil()" fill="red" style="background: url(https://evil.example/x.png)"/>` +
      `<style>@import "https://evil.example/a.css"; .x { fill: url(https://evil.example/b.svg); }</style></svg>`;
    const out = sanitizeSvg(stripTokenTitles(nasty));
    expect(out).not.toContain("<script");
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("diff:conn:1-2");
    expect(out).toContain("plain");
  });

  it("rewriteCitationAnchors unwraps non-citation links", () => {
    const out = rewriteCitationAnchors('<svg><a href="https://x.example"><text>t</text></a></svg>', new Map());
    expect(out).not.toContain("<a");
    expect(out).toContain("t");
  });

  it("keeps multi-line tspan positioning and edge-label masks (#16)", () => {
    // Realistic raw d2 output: multi-line shape labels position lines via
    // tspan x/dy, and edge labels clear the line behind them via a mask.
    const raw =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 140">` +
      `<defs><mask id="m1" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="140">` +
      `<rect x="0" y="0" width="300" height="140" fill="white"/>` +
      `<rect x="100" y="60" width="80" height="20" fill="black"/></mask></defs>` +
      `<text x="60" y="40"><tspan x="60" dy="0">first line</tspan><tspan x="60" dy="18.5">second line</tspan></text>` +
      `<path d="M 0 70 H 300" mask="url(#m1)" stroke="#000"/></svg>`;
    const out = postProcessSvg(raw, new Map(), "abc123");
    // Line offsets survive: without dy every line lands on one baseline.
    expect(out).toContain('dy="0"');
    expect(out).toContain('dy="18.5"');
    // Mask geometry survives: without maskUnits the cutout misplaces and
    // the edge line strikes through its label.
    expect(out).toContain('maskUnits="userSpaceOnUse"');
    expect(out).toContain('id="d2-abc123-m1"');
    expect(out).toContain('mask="url(#d2-abc123-m1)"');
  });
});

// --- finalize branches (fake binary) ----------------------------------------

function lookupForCite(targets: Record<string, { start: number; end: number }>): ReturnType<typeof createSnapshotLookup> {
  const snapshot = {
    files: [
      {
        fileKey: "conn",
        path: "src/urllib3/connection.py",
        category: "source" as const,
        hunks: [{ contentHash: "h1", header: "@@", newStart: 1, newEnd: 200, oldStart: 1, oldEnd: 200, added: 1, removed: 1, lines: [] }],
      },
    ],
    pages: [],
    annotations: [],
    version: { idMapping: {} },
  } as unknown as ReviewSnapshot;
  void targets;
  return createSnapshotLookup(snapshot, {});
}

describe("finalize branches (fake binary)", () => {
  it("marks unavailable when the binary is missing (cites still validated)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const lookup = lookupForCite({});
      const r = await finalizeDiagramBlock('direction: right\na -> b: go {link: "diff:conn:1-2"}', undefined, {
        runner: new FakeCommandRunner(),
        dataDir: tmp,
        lookup,
        d2bin: null,
        d2version: null,
      });
      expect(r.block.render?.status).toBe("unavailable");
      expect(r.block.render?.hash).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requests repair when cites are invalid", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const lookup = lookupForCite({});
      const r = await finalizeDiagramBlock("direction: right\na -> b: go", undefined, {
        runner: new FakeCommandRunner(),
        dataDir: tmp,
        lookup,
        d2bin: null,
        d2version: null,
      });
      // No cites at all: no repair needed (cites are optional per diagram).
      expect(r.needsRepair).toBe(false);
      const bad = await finalizeDiagramBlock('direction: right\na -> b: go {link: "diff:nope:9999-9999"}', undefined, {
        runner: new FakeCommandRunner(),
        dataDir: tmp,
        lookup,
        d2bin: null,
        d2version: null,
      });
      expect(bad.needsRepair).toBe(true);
      expect(bad.messages.join("\n")).toMatch(/nope|unknown file/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requests repair on compile error (fake binary fails validate)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const fake = new FakeCommandRunner();
      const lookup = lookupForCite({});
      // validate fails.
      fake.enqueue({ cmd: "/fake/d2", stdout: "", stderr: "err: 1:1: bad syntax", code: 1 });
      const r = await finalizeDiagramBlock("direction: right\na -> b", undefined, {
        runner: fake,
        dataDir: tmp,
        lookup,
        d2bin: { path: "/fake/d2", source: "test" },
        d2version: "0.9.0",
      });
      expect(r.needsRepair).toBe(true);
      expect(r.block.render?.status).toBe("error");
      expect(r.messages.join("\n")).toMatch(/compile error/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("renders ok with a fake binary (href check passes)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const fake = new FakeCommandRunner();
      const lookup = lookupForCite({});
      const svg = `<svg><a href="diff:conn:1-2"><text>go</text></a></svg>`;
      // validate ok, then light + dark renders.
      fake.enqueue({ cmd: "/fake/d2", stdout: "Success!", stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svg, stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svg, stderr: "", code: 0 });
      const r = await finalizeDiagramBlock('direction: right\na -> b: go {link: "diff:conn:1-2"}', "Cap", {
        runner: fake,
        dataDir: tmp,
        lookup,
        d2bin: { path: "/fake/d2", source: "test" },
        d2version: "0.9.0",
      });
      expect(r.needsRepair).toBe(false);
      expect(r.block.render?.status).toBe("ok");
      expect(r.block.caption).toBe("Cap");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requests repair on silent cite drop (SVG missing the href)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const fake = new FakeCommandRunner();
      const lookup = lookupForCite({});
      const svgNoHref = `<svg><text>go</text></svg>`;
      fake.enqueue({ cmd: "/fake/d2", stdout: "Success!", stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svgNoHref, stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svgNoHref, stderr: "", code: 0 });
      const r = await finalizeDiagramBlock('direction: right\na -> b: go {link: "diff:conn:1-2"}', undefined, {
        runner: fake,
        dataDir: tmp,
        lookup,
        d2bin: { path: "/fake/d2", source: "test" },
        d2version: "0.9.0",
      });
      expect(r.needsRepair).toBe(true);
      expect(r.messages.join("\n")).toMatch(/silently dropped|inline/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- cache (disk + fixture seed) --------------------------------------------

describe("diagram cache", () => {
  it("puts, gets, and seeds from fixtures without d2", () => {    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const cache = new DiagramCache({ dataDir: tmp, fixturesDir });
      cache.put("h1", "light", "<svg>one</svg>");
      expect(cache.get("h1", "light")).toBe("<svg>one</svg>");
      expect(cache.get("h1", "dark")).toBeNull();
      // Seeded fixture hashes (pre-rendered by mise run fixture-snapshot).
      const seeded = fs.readdirSync(path.join(fixturesDir, "diagrams")).filter((f) => f.endsWith(".light.svg"));
      expect(seeded.length).toBeGreaterThan(0);
      const hash = seeded[0].split(".")[0];
      const svg = cache.get(hash, "light");
      expect(svg).toContain("<svg");
      expect(svg).toContain("data-refs=");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("versions disk filenames and sweeps legacy unversioned renders (#16)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const dir = path.join(tmp, "diagrams");
      fs.mkdirSync(dir, { recursive: true });
      // A render cached by an older post-processor (pre-version layout).
      fs.writeFileSync(path.join(dir, "deadbeefdeadbeef.light.svg"), "<svg>stale</svg>");
      const cache = new DiagramCache({ dataDir: tmp });
      // Legacy bytes are gone, never served…
      expect(fs.existsSync(path.join(dir, "deadbeefdeadbeef.light.svg"))).toBe(false);
      expect(cache.get("deadbeefdeadbeef", "light")).toBeNull();
      // …and fresh puts land under the versioned name.
      cache.put("deadbeefdeadbeef", "light", "<svg>fresh</svg>");
      expect(cache.get("deadbeefdeadbeef", "light")).toBe("<svg>fresh</svg>");
      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^deadbeefdeadbeef\.v\d+\.light\.svg$/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- endpoint (replay app) ----------------------------------------------------

function replayRunner(): ReplayAgentRunner {
  return new ReplayAgentRunner({ fixturesDir, chunkChars: 256, delayMs: 0 });
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("diagrams endpoint", () => {
  it("401 without token, 404 unknown review/hash, 400 bad theme", async () => {
    const { app } = await createApp("tok", { agents: replayRunner() });
    try {
      const noAuth = await app.inject({ method: "GET", url: "/api/reviews/x/diagrams/h" } as never);
      expect(noAuth.statusCode).toBe(401);
      const unknownReview = await app.inject({
        method: "GET",
        url: "/api/reviews/nope/diagrams/h",
        headers: authed,
      } as never);
      expect(unknownReview.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("serves the seeded demo diagram without d2 (unavailable → ok from seed)", { timeout: 90000 }, async () => {
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const { app, ctx } = await createApp("tok", { agents: replayRunner() });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => {
          const s = ctx.reviews.getSnapshot(id);
          return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
        });
        // Trigger a diagram via replay (fold recording, D2 source).
        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "diagram", cardId: "central" },
        } as never);
        expect(acted.statusCode).toBe(200);
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        // The diagram mutate lands just after the job settles (async
        // finalize); wait for the block, not just the job.
        await waitFor(() => {
          const s = ctx.reviews.getSnapshot(id);
          const c = s?.pages.find((p) => p.id === "root")?.cards.find((x) => x.id === "central");
          return !!c?.blocks.some((b) => b.type === "diagram");
        }, 60000);
        const snap = ctx.reviews.getSnapshot(id)!;
        const card = snap.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
        const dg = card.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.source).toContain("->");
        const hash = dg.render!.hash;
        // Seeded cache serves without d2 (block may say unavailable).
        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(200);
        expect(got.headers["content-type"]).toMatch(/image\/svg\+xml/);
        expect(String(got.body ?? got.payload ?? "")).toContain("data-refs=");
        // Unknown hash → 404; bad theme → 400.
        const missing = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/deadbeefdeadbeef?theme=light`,
          headers: authed,
        } as never);
        expect(missing.statusCode).toBe(404);
        const badTheme = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${hash}?theme=neon`,
          headers: authed,
        } as never);
        expect(badTheme.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });
});

// --- real binary (skipped without d2) ----------------------------------------

function realD2Available(): boolean {
  // Synchronous gate only (async probe happens inside the test, which
  // skips on failure). A shim without an installed version resolves but
  // fails to run — the test then skips with a notice.
  const bin = resolveD2Bin({});
  if (!bin) return false;
  try {
    fs.accessSync(bin.path, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe("real d2 binary", () => {
  async function realBin(): Promise<{ runner: InstanceType<typeof import("../src/exec/runner.js").RealCommandRunner>; path: string } | null> {
    if (!realD2Available()) {
      console.warn("SKIP real-d2: d2 not on PATH (run `mise install d2` or `brew install d2` to run)");
      return null;
    }
    const { RealCommandRunner } = await import("../src/exec/runner.js");
    const { probeD2Version } = await import("../src/diagrams/render.js");
    const runner = new RealCommandRunner();
    const bin = resolveD2Bin({})!;
    const version = await probeD2Version(runner, bin.path).catch(() => null);
    if (!version || !meetsD2MinVersion(version)) {
      console.warn(`SKIP real-d2: d2 at ${bin.path} unusable (version ${version ?? "unknown"}; need ≥ 0.9.0)`);
      return null;
    }
    return { runner, path: bin.path };
  }

  it("renders the three reference diagrams deterministically", async () => {
    const real = await realBin();
    if (!real) return;
    const { renderD2Theme, checkD2Source, D2_THEME_LIGHT, D2_THEME_DARK } = await import("../src/diagrams/render.js");
    const { runner } = real;
    const bin = { path: real.path };
    const sources = ["diagram-fold.md", "diagram-path.md"].map((f) =>
      fs.readFileSync(path.join(fixturesDir, "recordings", f), "utf8"),
    );
    const { parseReply } = await import("@unvibe/shared");
    for (const text of sources) {
      const dg = parseReply(text).blocks.find((b) => b.type === "diagram") as unknown as { source: string };
      expect(dg).toBeDefined();
      expect((await checkD2Source(dg.source, { runner, binPath: bin.path })).ok).toBe(true);
      const h = diagramHash(dg.source, "0.9.0");
      const a = await renderD2Theme(dg.source, { runner, binPath: bin.path, salt: h, theme: D2_THEME_LIGHT });
      const b = await renderD2Theme(dg.source, { runner, binPath: bin.path, salt: h, theme: D2_THEME_LIGHT });
      expect(a.ok && a.svg).toBeTruthy();
      expect(a.svg).toBe(b.svg);
      const dark = await renderD2Theme(dg.source, { runner, binPath: bin.path, salt: h, theme: D2_THEME_DARK });
      expect(dark.ok && dark.svg).toBeTruthy();
      expect(dark.svg).not.toBe(a.svg);
    }
  });

  it("icon: sources never reach the network (precheck blocks; probe sees zero)", async () => {
    const real = await realBin();
    if (!real) {
      console.warn("SKIP real-d2 network: d2 not on PATH");
      return;
    }
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const { renderD2Theme, D2_THEME_LIGHT } = await import("../src/diagrams/render.js");
      const { runner } = real;
      const bin = { path: real.path };
      const src = `a: {icon: http://127.0.0.1:${port}/icon.svg}\na -> b`;
      const r = await renderD2Theme(src, { runner, binPath: bin.path, salt: "probe", theme: D2_THEME_LIGHT });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/icon|URLs/);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("imports cannot read files (precheck blocks; empty cwd fails direct runs)", async () => {
    const real = await realBin();
    if (!real) {
      console.warn("SKIP real-d2 fs: d2 not on PATH");
      return;
    }
    const { renderD2Theme, D2_THEME_LIGHT } = await import("../src/diagrams/render.js");
    const { runner } = real;
    const bin = { path: real.path };
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-secret-"));
    const secretFile = path.join(secretDir, "secret.txt");
    fs.writeFileSync(secretFile, "TOP-SECRET-CONTENT");
    try {
      // Production path: precheck rejects before the binary runs.
      const r = await renderD2Theme(`...@${secretFile}\na -> b`, {
        runner,
        binPath: bin.path,
        salt: "probe",
        theme: D2_THEME_LIGHT,
      });
      expect(r.ok).toBe(false);
      // Direct binary with a cwd-relative import in an empty temp dir fails
      // (missing file → compile error, secret never lands in SVG).
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-empty-"));
      try {
        const direct = await runner.run(bin.path, {
          args: ["--bundle=false", "-", "-"],
          cwd: empty,
          env: { PATH: "/usr/bin:/bin" },
          stdin: "...@secret.txt\na -> b",
          timeoutMs: 15000,
        });
        expect(direct.code).not.toBe(0);
        expect(direct.stdout).not.toContain("TOP-SECRET-CONTENT");
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(secretDir, { recursive: true, force: true });
    }
  });
});
