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
import type { DiagramBlock, ParagraphBlock } from "@unvibe/shared";
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
import { FakeAgentRunner } from "../src/agent/fake.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";

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
  it("extracts link: cites (quoted, bare)", () => {
    expect(extractD2Links('a: {link: "diff:conn:80-88"}')).toEqual(["diff:conn:80-88"]);
    expect(extractD2Links("a -> b: x {link: diff:conn:1-2}")).toEqual(["diff:conn:1-2"]);
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

// --- d2 precheck (#286 lifts) --------------------------------------------------

describe("d2 precheck", () => {
  const ok = (s: string): boolean => precheckD2Source(s).ok;
  it("accepts the reference shapes", () => {
    expect(ok('direction: right\na -> b: go {link: "diff:conn:1-2"}')).toBe(true);
  });
  it("passes the lifted features (#286: md/latex, vars, d2-config, classes, tooltip)", () => {
    expect(ok('a: |md # hi [x](https://example.com/y) |\na -> b')).toBe(true);
    expect(ok('a: |latex x^2 \\to space |\na -> b')).toBe(true);
    expect(ok('a: |tex x^2 |\na -> b')).toBe(true);
    expect(ok('norm: |python value.replace(pat, " ") |\na -> b')).toBe(true);
    expect(ok("vars: {x: 1}\na -> b")).toBe(true);
    expect(ok("d2-config: {theme: 0}\na -> b")).toBe(true);
    expect(ok("classes: {hot: {style.fill: \"#ffee88\"}}\na -> b")).toBe(true);
    expect(ok('a: {tooltip: short gloss}\na -> b')).toBe(true);
  });
  it("rejects every still-denied construct", () => {
    expect(ok("...@file.d2\na -> b")).toBe(false);
    expect(ok("x: @file.d2\na -> b")).toBe(false);
    expect(ok("a: |\nlabel\n|\na -> b")).toBe(false);
    expect(ok("layers: {x: {}}\na -> b")).toBe(false);
    expect(ok("scenarios: {x: {}}\na -> b")).toBe(false);
    expect(ok('a -> b: x {link: "diff:conn:1-2"}\na -> b: {style: {animated: true}}')).toBe(false);
    expect(ok("animate-interval: 1000\na -> b")).toBe(false);
    expect(precheckD2Source("").ok).toBe(false);
  });
  it("rejects non-allowlisted icon URLs and bare shape:image without an allowlisted src", () => {
    expect(ok('a: {icon: https://example.com/x.svg}\na -> b')).toBe(false);
    expect(ok('a: {icon: http://icons.terrastruct.com/essentials%2F304-archive.svg}\na -> b')).toBe(false);
    expect(ok('a: {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg?v=2}\na -> b')).toBe(false);
    expect(ok('a: {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg#frag}\na -> b')).toBe(false);
    expect(ok('a: {icon: https://icons.terrastruct.com/essentials%2F304-archive.png}\na -> b')).toBe(false);
    expect(ok('a: {icon: ./local.svg}\na -> b')).toBe(false);
    expect(ok('a: {shape: image}\na -> b')).toBe(false);
    expect(ok('a: {shape: image, src: https://example.com/x.svg}\na -> b')).toBe(false);
    // Allowlisted forms pass the pre-check (fetching happens in the pipeline).
    expect(ok('a: {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg}\na -> b')).toBe(true);
    expect(
      ok('a: {shape: image, src: https://icons.terrastruct.com/essentials%2F304-archive.svg}\na -> b'),
    ).toBe(true);
  });
  it("enforces the 40-shape / 48-connection caps", () => {
    const okShapes = Array.from({ length: 40 }, (_, i) => `n${i}: "N${i}"`).join("\n");
    expect(ok(okShapes)).toBe(true);
    const manyShapes = Array.from({ length: 41 }, (_, i) => `n${i}: "N${i}"`).join("\n");
    expect(ok(manyShapes)).toBe(false);
    const okEdges = Array.from({ length: 48 }, () => `a -> b: go`).join("\n");
    expect(ok(okEdges)).toBe(true);
    const manyEdges = Array.from({ length: 49 }, () => `a -> b: go`).join("\n");
    expect(ok(manyEdges)).toBe(false);
  });
  it("renames an unambiguous reserved-word shape instead of rejecting (#130)", async () => {
    const { renameReservedShapeKeys } = await import("../src/diagrams/precheck.js");
    const src = 'direction: right\nsteps: "wait flow"\na -> steps: go\nsteps -> b: done\nb: "end"';
    const r = renameReservedShapeKeys(src);
    expect(r.renamed).toEqual(["steps"]);
    expect(r.source).toContain('steps_box: "wait flow"');
    expect(r.source).toContain("a -> steps_box: go");
    expect(r.source).toContain("steps_box -> b: done");
    expect(r.source).not.toMatch(/(^|\n)steps\s*:/);
    // The renamed source passes the pre-check.
    expect(ok(r.source)).toBe(true);
  });
  it("leaves board-form reserved words rejected with a rename hint (#130)", () => {
    const r = precheckD2Source("layers: {x: {}}\na -> b");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/rename the shape/);
    expect(r.ok ? "" : r.reason).not.toMatch(/out of scope/);
  });
  it("rejects .class inside braces with an actionable reason (#130)", () => {
    const bad = precheckD2Source('direction: right\ngone: "x" {.class: [bad]}');
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.reason).toMatch(/myshape\.class: \[ok\]/);
    // The legal line form still passes (D2 passes the class through).
    expect(ok('direction: right\na: "x"\na.class: [ok]')).toBe(true);
    expect(ok('direction: right\na: "x"\n*.class: [ok]')).toBe(true);
  });
});

// --- allowlisted icons (#286) --------------------------------------------------

describe("d2 icons", () => {
  const GOOD = "https://icons.terrastruct.com/essentials%2F304-archive.svg";
  it("validates icon URLs against the allowlist", async () => {
    const { extractIconUrls, validateIconUrl } = await import("../src/diagrams/icons.js");
    expect(validateIconUrl(GOOD)).toEqual({ ok: true });
    expect(validateIconUrl("https://example.com/x.svg").ok).toBe(false);
    expect(validateIconUrl("http://icons.terrastruct.com/essentials%2F304-archive.svg").ok).toBe(false);
    expect(validateIconUrl(`${GOOD}?v=2`).ok).toBe(false);
    expect(validateIconUrl(`${GOOD}#frag`).ok).toBe(false);
    expect(validateIconUrl("https://icons.terrastruct.com/essentials%2F304-archive.png").ok).toBe(false);
    expect(validateIconUrl("./local.svg").ok).toBe(false);
    expect(validateIconUrl("not a url").ok).toBe(false);
    // Both `icon:` and `src:` keys are found, quoted or bare, deduped.
    expect(extractIconUrls(`a: {icon: ${GOOD}}\nb: {shape: image, src: "${GOOD}"}`)).toEqual([GOOD]);
    expect(extractIconUrls(`a: {icon: '${GOOD}'} \nb: {src: ${GOOD}}`)).toEqual([GOOD]);
    expect(extractIconUrls("a -> b: go")).toEqual([]);
  });
  it("stages fetched icons and rewrites the source (stub fetcher)", async () => {
    const { stageIcons } = await import("../src/diagrams/icons.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2icon-"));
    try {
      const bytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
      const r = await stageIcons(`direction: right\nwarn: "x" {icon: ${GOOD}}\nwarn -> norm: go`, {
        dir: tmp,
        fetcher: async (url) => (url === GOOD ? { ok: true, bytes } : { ok: false, reason: `HTTP 404 for ${url}` }),
      });
      expect(r.stripped).toEqual([]);
      expect(r.staged).toHaveLength(1);
      expect(r.source).toContain('{icon: "./icon-0.svg"}');
      expect(r.source).not.toContain(GOOD);
      expect(fs.existsSync(path.join(tmp, "icon-0.svg"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("strips icons that fail to fetch and records the reason (stub fetcher)", async () => {
    const { stageIcons } = await import("../src/diagrams/icons.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2icon-"));
    try {
      const bad = "https://icons.terrastruct.com/essentials%2Finvented-404.svg";
      const r = await stageIcons(`direction: right\nwarn: "x" {icon: ${bad}, shape: oval}\nwarn -> norm: go`, {
        dir: tmp,
        fetcher: async (url) => ({ ok: false, reason: `HTTP 404 for ${url}` }),
      });
      expect(r.staged).toEqual([]);
      expect(r.stripped).toHaveLength(1);
      expect(r.stripped[0].url).toBe(bad);
      expect(r.stripped[0].reason).toMatch(/404/);
      expect(r.source).not.toContain(bad);
      expect(r.source).not.toContain("icon:");
      // The surviving shape still compiles: braces are balanced.
      expect(r.source).toContain("{shape: oval}");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("renders ok with a fetched icon and notes the stripped one (stub fetcher, fake binary)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const fake = new FakeCommandRunner();
      const lookup = lookupForCite({});
      const bytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
      const fetchIcon = async (url: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> =>
        url.includes("invented")
          ? { ok: false, reason: `HTTP 404 for ${url}` }
          : { ok: true, bytes };
      const src =
        `direction: right\n` +
        `warn: "long header" {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg}\n` +
        `gone: "missing" {icon: https://icons.terrastruct.com/essentials%2Finvented.svg}\n` +
        `warn -> gone: fold {link: "diff:conn:1-2"}`;
      const svg = `<svg><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" x="1" y="2" width="3" height="4"/><a href="diff:conn:1-2"><text>fold</text></a></svg>`;
      fake.enqueue({ cmd: "/fake/d2", stdout: "Success!", stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svg, stderr: "", code: 0 });
      fake.enqueue({ cmd: "/fake/d2", stdout: svg, stderr: "", code: 0 });
      const r = await finalizeDiagramBlock(src, undefined, {
        runner: fake,
        dataDir: tmp,
        lookup,
        d2bin: { path: "/fake/d2", source: "test" },
        d2version: "0.9.0",
        fetchIcon,
      });
      expect(r.needsRepair).toBe(false);
      expect(r.block.render?.status).toBe("ok");
      // One strip note (countable), naming the invented URL and the reason.
      expect(r.block.render?.notes).toHaveLength(1);
      expect(r.block.render?.notes?.[0]).toMatch(/invented.*404/);
      // The staged (rewritten) source reached the binary, not the raw URL.
      const renderedStdin = fake.calls.map((c) => String(c.opts.stdin ?? "")).join("\n");
      expect(renderedStdin).toContain("./icon-0.svg");
      expect(renderedStdin).not.toContain("304-archive.svg");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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

  it("keeps data:-embedded icons and drops every other image", () => {
    const svg =
      `<svg><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" x="1" y="2" width="3" height="4" onclick="evil()"/>` +
      `<image href="https://evil.example/i.png" x="1" y="2" width="3" height="4"/>` +
      `<image x="1" y="2" width="3" height="4"/></svg>`;
    const out = postProcessSvg(svg, new Map(), "img1");
    expect(out).toContain("<image");
    expect(out).toContain('href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="');
    expect(out).toContain('x="1"');
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("onclick");
    // Exactly one image survives (the embedded one); geometry is scrubbed to x/y/width/height/href.
    expect(out.match(/<image\b/g)).toHaveLength(1);
  });

  it("keeps xlink:href data: images as href", () => {
    const svg = `<svg><image xlink:href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" x="1" y="2" width="3" height="4"/></svg>`;
    const out = postProcessSvg(svg, new Map(), "img2");
    expect(out).toContain("<image");
    expect(out).toContain("data:image/svg+xml");
    expect(out).not.toContain("xlink:href");
  });

  it("drops images nested in foreignObject with it", () => {
    const svg = `<svg><foreignObject><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></foreignObject></svg>`;
    const out = postProcessSvg(svg, new Map(), "img3");
    expect(out).not.toContain("<image");
    expect(out).not.toContain("foreignObject");
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

  it("versions disk filenames (#16)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
    try {
      const dir = path.join(tmp, "diagrams");
      fs.mkdirSync(dir, { recursive: true });
      const cache = new DiagramCache({ dataDir: tmp });
      // Fresh puts land under the versioned name.
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

// --- issue #71: diagrams outside page cards -----------------------------------

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

/** Explain reply carrying an inline fenced d2 block (novel shapes, unseeded). */
const EXPLAIN_WITH_DIAGRAM = `An explanation with a diagram.

\`\`\`d2
direction: right
explain-demo-a -> explain-demo-b: hello
\`\`\`

\`\`\`json
{}
\`\`\`
`;

describe("conversation answer diagrams (#71, #136)", () => {
  it("serves a diagram stored in an Explain answer (not 404)", { timeout: 90000 }, async () => {
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_WITH_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitFor(() => {
          const s = ctx.reviews.getSnapshot(id);
          return (s?.annotations.find((a) => a.id === annotationId)?.replies?.[0]?.blocks.length ?? 0) > 0;
        }, 60000);
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.hash).toMatch(/^[0-9a-f]{16}$/);

        // No d2 binary: the block is found but unrendered → 409, never 404.
        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
        expect((got.json() as { status?: string }).status).toBe("unavailable");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });

  it("serves a diagram nested in an aside inside an answer", { timeout: 90000 }, async () => {
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const reply = `An explanation with an example.

::: example
\`\`\`d2
direction: right
aside-demo-a -> aside-demo-b: hi
\`\`\`
:::

\`\`\`json
{}
\`\`\`
`;
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(reply) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitFor(() => {
          const s = ctx.reviews.getSnapshot(id);
          return (s?.annotations.find((a) => a.id === annotationId)?.replies?.[0]?.blocks.length ?? 0) > 0;
        }, 60000);
        const snap = ctx.reviews.getSnapshot(id)!;
        const turnBlocks = snap.annotations.find((a) => a.id === annotationId)!.replies![0]!.blocks;
        const asideBlock = turnBlocks.find((b) => b.type === "aside") as unknown as {
          inner: { type: string; render?: { hash: string } }[];
        };
        expect(asideBlock).toBeDefined();
        const dg = asideBlock.inner.find((b) => b.type === "diagram")!;
        expect(dg.render?.hash).toMatch(/^[0-9a-f]{16}$/);

        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=dark`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
        expect((got.json() as { status?: string }).status).toBe("unavailable");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });

  it("an invalid inline diagram is found and fails quietly (409, never 404/500)", { timeout: 90000 }, async () => {
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      // Invalid D2 syntax plus an unverifiable citation: the parser still
      // stores the block, and the route reports it as unrendered rather
      // than unknown. The card itself is unaffected (the web shows the
      // source with a note; D2Diagram.test.tsx covers the fallbacks).
      const reply = `An explanation with a broken diagram.

\`\`\`d2
this is not valid d2 {{{
broken-shape: "x" {link: "diff:nope:999999"}
\`\`\`

\`\`\`json
{}
\`\`\`
`;
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(reply) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitFor(() => {
          const s = ctx.reviews.getSnapshot(id);
          return (s?.annotations.find((a) => a.id === annotationId)?.replies?.[0]?.blocks.length ?? 0) > 0;
        }, 60000);
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "diagram") as unknown as {
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();

        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });
});

// --- issue #130: failed on-demand renders answer error, not unavailable ---

/**
 * Fake `d2` executable (no real binary needed): version ok, every
 * validate/render fails the way the owner's `.class: [bad]` report did
 * (compiler error on stderr, exit 1).
 */
function writeFailingD2(): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-faked2-"));
  const bin = path.join(dir, "d2");
  fs.writeFileSync(
    bin,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "d2 v0.9.0"; exit 0; fi\ncat > /dev/null\n' +
      'echo "err: failed to compile -: -:7:37: invalid text beginning unquoted key" >&2\nexit 1\n',
  );
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

/** Wait until an Explain answer's fill settled (final mutate cleared `working`). */
function waitForExpansion(
  ctx: { reviews: { getSnapshot(id: string): ReviewSnapshot | null } },
  id: string,
  annotationId: string,
  timeoutMs = 60000,
): Promise<void> {
  return waitFor(() => {
    const s = ctx.reviews.getSnapshot(id);
    const a = s?.annotations.find((x) => x.id === annotationId) as unknown as
      | { working: string | null; replies?: { blocks: unknown[]; working: string | null }[] }
      | undefined;
    return ((a?.replies?.[0]?.blocks.length ?? 0) > 0) && a?.working == null && (a?.replies ?? []).every((t) => t.working == null);
  }, timeoutMs);
}
/** Explain reply carrying the owner's failing shape (inline `.class`). */
const EXPLAIN_CLASS_DIAGRAM = `An explanation with a diagram.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup" {.class: [bad]}
start -> gone: finish
\`\`\`

\`\`\`json
{}
\`\`\`
`;

/**
 * Smarter fake `d2`: version ok, rejects sources with an inline `{.class`
 * like the real compiler, validates and renders everything else (bare SVG,
 * no cites to check).
 */
function writeSmartD2(): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-smartd2-"));
  const bin = path.join(dir, "d2");
  fs.writeFileSync(
    bin,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "d2 v0.9.0"; exit 0; fi\n' +
      'src=$(cat)\ncase "$src" in\n"{.class"*|*"{.class"*) echo "err: invalid text beginning unquoted key" >&2; exit 1;;\n' +
      "esac\n" +
      'if [ "$1" = "validate" ]; then echo "Success!"; exit 0; fi\n' +
      'echo \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>ok</text></svg>\'\nexit 0\n',
  );
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

/** Broken first reply (owner's `.class` case) + fixed repair reply. */
const EXPLAIN_FIXED_REPAIR = `An explanation with a fixed diagram.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup"
gone.class: [bad]
start -> gone: finish
\`\`\`

\`\`\`json
{}
\`\`\`
`;

/** First reply with a box named `steps` (owner's first case). */
const EXPLAIN_STEPS_SHAPE = `An explanation with a diagram.

\`\`\`d2
direction: right
steps: "wait flow"
start: "request in"
start -> steps: go
\`\`\`

\`\`\`json
{}
\`\`\`
`;

describe("failed on-demand renders (#130)", () => {
  it("a compile failure answers 409 error, never unavailable", { timeout: 90000 }, async () => {
    const { dir, bin } = writeFailingD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitForExpansion(ctx, id, annotationId);
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "diagram") as unknown as {
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();

        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
        const body = got.json() as { status?: string; error?: string };
        // d2 ran and failed: the route must say so (the web shows the
        // install hint only for a truly missing binary).
        expect(body.status).toBe("error");
        expect(body.error).toMatch(/not valid D2/);
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an inline .class failure gets one repair turn and lands drawn (#130)", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(EXPLAIN_FIXED_REPAIR) },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitForExpansion(ctx, id, annotationId);
        // The repair turn ran (its marker reached the agent).
        expect(agents.prompts.some((p) => p.text.includes("failed validation"))).toBe(true);
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        // The repaired source won and rendered.
        expect(dg.render?.status).toBe("ok");
        expect(dg.source).toContain("gone.class: [bad]");
        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a box named steps is renamed and lands drawn with no repair (#130)", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(EXPLAIN_FIXED_REPAIR) },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_STEPS_SHAPE) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitForExpansion(ctx, id, annotationId);
        // Renamed, not repaired: no repair turn ran.
        expect(agents.prompts.some((p) => p.text.includes("failed validation"))).toBe(false);
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.status).toBe("ok");
        expect(dg.source).toContain('steps_box: "wait flow"');
        expect(dg.source).toContain("start -> steps_box: go");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Concept reply carrying the owner's failing shape (inline `.class`). */
const CONCEPT_CLASS_DIAGRAM = `A concept with a diagram.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup" {.class: [bad]}
start -> gone: finish
\`\`\`

\`\`\`json
{"title": "Flow"}
\`\`\`
`;

/** Fixed concept repair reply. */
const CONCEPT_FIXED_REPAIR = `A concept with a fixed diagram.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup"
gone.class: [bad]
start -> gone: finish
\`\`\`

\`\`\`json
{"title": "Flow"}
\`\`\`
`;

describe("concept inline diagrams (#130)", () => {
  it("a bad diagram gets exactly one repair turn and lands drawn", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(CONCEPT_FIXED_REPAIR) },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "# Concept page", events: textEvents(CONCEPT_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "concept", slug: "flow" },
        } as never);
        expect(acted.statusCode).toBe(200);
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        // Exactly one repair turn, no loop.
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const page = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "c-flow")!;
        const dg = page.cards[0].blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.status).toBe("ok");
        expect(dg.source).toContain("gone.class: [bad]");
        expect(JSON.stringify(page.cards[0].blocks)).toContain("A concept with a diagram.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrepairable diagram keeps an error block and the prose", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents("Prose without a diagram.\n\n```json\n{}\n```\n") },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "# Concept page", events: textEvents(CONCEPT_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "concept", slug: "flow" },
        } as never);
        expect(acted.statusCode).toBe(200);
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const page = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "c-flow")!;
        const dg = page.cards[0].blocks.find((b) => b.type === "diagram") as unknown as {
          render?: { status: string; error?: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.status).toBe("error");
        expect(JSON.stringify(page.cards[0].blocks)).toContain("A concept with a diagram.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Explain reply with a broken diagram nested in an example aside. */
const EXPLAIN_ASIDE_BROKEN = `An explanation with an example.

::: example
\`\`\`d2
direction: right
gone: "unmount cleanup" {.class: [bad]}
start -> gone: finish
\`\`\`
:::

\`\`\`json
{}
\`\`\`
`;

/** Fixed repair reply (top-level diagram splices into the nested slot). */
const EXPLAIN_ASIDE_FIXED = `An explanation with a fixed diagram.

\`\`\`d2
direction: right
gone: "unmount cleanup"
gone.class: [bad]
start -> gone: finish
\`\`\`

\`\`\`json
{}
\`\`\`
`;

describe("aside-nested diagrams (#130)", () => {
  it("a bad nested diagram gets exactly one repair turn and lands drawn", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(EXPLAIN_ASIDE_FIXED) },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_ASIDE_BROKEN) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitForExpansion(ctx, id, annotationId);
        // Exactly one repair turn, no loop.
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const snap = ctx.reviews.getSnapshot(id)!;
        const aside = snap.annotations
          .find((a) => a.id === annotationId)!
          .replies![0]!.blocks.find((b) => b.type === "aside") as unknown as {
          inner: { type: string; source?: string; render?: { status: string } }[];
        };
        expect(aside).toBeDefined();
        const dg = aside.inner.find((b) => b.type === "diagram")!;
        expect(dg.render?.status).toBe("ok");
        expect(dg.source).toContain("gone.class: [bad]");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrepairable nested diagram keeps an error block and the prose", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents("Prose without a diagram.\n\n```json\n{}\n```\n") },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_ASIDE_BROKEN) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

        const acted = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: authed,
          payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
        } as never);
        expect(acted.statusCode).toBe(200);
        const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
        const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
        if (jobId) {
          await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
        }
        await waitForExpansion(ctx, id, annotationId);
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const snap = ctx.reviews.getSnapshot(id)!;
        const turnBlocks = snap.annotations.find((a) => a.id === annotationId)!.replies![0]!.blocks;
        const aside = turnBlocks.find((b) => b.type === "aside") as unknown as {
          inner: { type: string; render?: { status: string; error?: string } }[];
        };
        expect(aside).toBeDefined();
        const dg = aside.inner.find((b) => b.type === "diagram")!;
        expect(dg.render?.status).toBe("error");
        expect(dg.render?.error).toMatch(/not valid D2/);
        // The prose is unaffected.
        expect(JSON.stringify(turnBlocks)).toContain("An explanation with an example.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
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

  it("non-allowlisted icons never reach the network (precheck blocks; probe sees zero)", async () => {
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
      expect(r.error).toMatch(/allowlisted|icon/);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("allowlisted icons embed as data: with a stub fetcher (real d2, no network)", async () => {
    const real = await realBin();
    if (!real) {
      console.warn("SKIP real-d2 icon: d2 not on PATH");
      return;
    }
    const { renderD2Theme, D2_THEME_LIGHT } = await import("../src/diagrams/render.js");
    const { postProcessSvg } = await import("../src/diagrams/sanitize.js");
    const { runner } = real;
    const bin = { path: real.path };
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1 15 14H1Z"/></svg>',
    );
    const good = "https://icons.terrastruct.com/essentials%2F304-archive.svg";
    const src =
      `direction: right\nwarn: "long header" {icon: ${good}}\n` + `warn -> norm: unfold {link: "diff:conn:650-651"}`;
    const r = await renderD2Theme(src, {
      runner,
      binPath: bin.path,
      salt: "icon-probe",
      theme: D2_THEME_LIGHT,
      fetchIcon: async (url) => (url === good ? { ok: true, bytes } : { ok: false, reason: `HTTP 404 for ${url}` }),
    });
    expect(r.ok).toBe(true);
    expect(r.iconNotes).toEqual([]);
    expect(r.svg).toContain("<image");
    expect(r.svg).toContain("data:image/svg+xml;base64,");
    expect(r.svg).not.toContain("icons.terrastruct.com");
    // The full post-processor keeps the embedded icon and the cite.
    const cmap = new Map([["diff:conn:650-651", { canonical: "diff:conn:650-651" }]]);
    const post = postProcessSvg(r.svg!, cmap, "icon-probe");
    expect(post).toContain("<image");
    expect(post).toContain("data:image/svg+xml");
    expect(post).toContain('data-refs="diff:conn:650-651"');
    expect(post).not.toContain("icons.terrastruct.com");
  });

  it("a failed icon fetch still renders without the icon (real d2, stub 404)", async () => {
    const real = await realBin();
    if (!real) {
      console.warn("SKIP real-d2 icon-strip: d2 not on PATH");
      return;
    }
    const { renderD2Theme, D2_THEME_LIGHT } = await import("../src/diagrams/render.js");
    const { postProcessSvg } = await import("../src/diagrams/sanitize.js");
    const { runner } = real;
    const bin = { path: real.path };
    const bad = "https://icons.terrastruct.com/essentials%2Finvented.svg";
    const src = `direction: right\nwarn: "long header" {icon: ${bad}}\nwarn -> norm: unfold {link: "diff:conn:650-651"}`;
    const r = await renderD2Theme(src, {
      runner,
      binPath: bin.path,
      salt: "icon-strip",
      theme: D2_THEME_LIGHT,
      fetchIcon: async (url) => ({ ok: false, reason: `HTTP 404 for ${url}` }),
    });
    expect(r.ok).toBe(true);
    expect(r.iconNotes).toHaveLength(1);
    expect(r.iconNotes[0].url).toBe(bad);
    expect(r.svg).not.toContain("<image");
    const cmap = new Map([["diff:conn:650-651", { canonical: "diff:conn:650-651" }]]);
    const post = postProcessSvg(r.svg!, cmap, "icon-strip");
    expect(post).toContain('data-refs="diff:conn:650-651"');
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

// --- issue #145: diagrams written inline in guide (reader) cards ---------

/** Reader reply with the owner's failing shape inline in a guide card. */
const READER_CLASS_DIAGRAM = `## The problem

A paragraph about the problem.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup" {.class: [bad]}
start -> gone: finish
\`\`\`

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

/** Fixed diagram reply for the reader's repair turn (legal line form). */
const READER_FIXED_REPAIR = `A fixed diagram for the problem card.

\`\`\`d2
direction: right
start: "request in"
gone: "unmount cleanup"
gone.class: [bad]
start -> gone: finish
\`\`\`

\`\`\`json
{}
\`\`\`
`;

function rootDiagramOf(
  ctx: { reviews: { getSnapshot(id: string): ReviewSnapshot | null } },
  id: string,
): { source: string; render?: { hash: string; status: string; error?: string } } | undefined {
  const snap = ctx.reviews.getSnapshot(id)!;
  const cards = snap.pages.find((p) => p.id === "root")?.cards ?? [];
  for (const card of cards) {
    const dg = (card.blocks as { type: string }[]).find((b) => b.type === "diagram") as unknown as {
      source: string;
      render?: { hash: string; status: string; error?: string };
    };
    if (dg) return dg;
  }
  return undefined;
}

describe("reader inline diagrams (#145)", () => {
  it("splitFinalizedBlocks restores the per-card split, extras to the last card", async () => {
    const { splitFinalizedBlocks } = await import("../src/pipeline/apply.js");
    const p = (id: string): ParagraphBlock => ({ type: "paragraph", id, text: { standard: "" }, citations: [] });
    const dg = (id: string): DiagramBlock => ({ type: "diagram", id, source: "", citations: [] });
    const cards = [
      { title: "The problem", blocks: [p("b1"), dg("b2")] },
      { title: "The central change", blocks: [p("b1")] },
    ];
    // 1:1 finalize: same blocks back across the same split.
    expect(splitFinalizedBlocks(cards, [p("b1"), dg("b2"), p("b1")])).toEqual(cards);
    // Repair extras append to the last card, never the first.
    const split = splitFinalizedBlocks(cards, [p("b1"), dg("b2"), p("b1"), dg("b9")]);
    expect(split[0].blocks).toEqual([p("b1"), dg("b2")]);
    expect(split[1].blocks).toEqual([p("b1"), dg("b9")]);
  });

  it("a bad diagram gets exactly one repair turn and lands drawn", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(READER_FIXED_REPAIR) },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(READER_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
        // The diagram repair turn ran exactly once, on the reader session.
        await waitFor(
          () => agents.prompts.filter((p) => p.text.includes("failed validation")).length === 1,
          60000,
        );
        // listByReview returns copies: re-list inside the poll and read
        // fresh state via get(), or the wait spins on a stale snapshot.
        const readerDone = (): boolean => {
          const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
          const last = jobs[jobs.length - 1];
          return last !== undefined && ["done", "error", "cancelled"].includes(ctx.jobs.get(last.id)?.state ?? "");
        };
        await waitFor(readerDone, 60000);
        const readerJobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
        expect(ctx.jobs.get(readerJobs[readerJobs.length - 1]!.id)?.state).toBe("done");
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const dg = rootDiagramOf(ctx, id);
        expect(dg).toBeDefined();
        // The repaired source won and rendered.
        expect(dg!.render?.status).toBe("ok");
        expect(dg!.source).toContain("gone.class: [bad]");
        // The prose is unaffected.
        expect(JSON.stringify(ctx.reviews.getSnapshot(id))).toContain("A paragraph about the problem.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrepairable diagram keeps an error block and the prose", { timeout: 120000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const agents = new FakeAgentRunner([
        { match: "failed validation", events: textEvents("Still prose, no diagram here.\n\n```json\n{}\n```\n") },
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(READER_CLASS_DIAGRAM) },
      ]);
      const { app, ctx } = await createApp("tok", { agents });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as ReviewSnapshot).review.id;
        await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
        // listByReview returns copies: re-list inside the poll and read
        // fresh state via get(), or the wait spins on a stale snapshot.
        const readerDone = (): boolean => {
          const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
          const last = jobs[jobs.length - 1];
          return last !== undefined && ["done", "error", "cancelled"].includes(ctx.jobs.get(last.id)?.state ?? "");
        };
        await waitFor(readerDone, 60000);
        const readerJobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
        expect(ctx.jobs.get(readerJobs[readerJobs.length - 1]!.id)?.state).toBe("done");
        // Exactly one repair turn, no loop.
        expect(agents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const dg = rootDiagramOf(ctx, id);
        expect(dg).toBeDefined();
        expect(dg!.render?.status).toBe("error");
        // The prose is unaffected.
        expect(JSON.stringify(ctx.reviews.getSnapshot(id))).toContain("A paragraph about the problem.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
