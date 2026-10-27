/**
 * Spike #286 offline harness: renders every samples/*.d2 through the REAL
 * service pipeline (precheck → renderD2Theme light+dark → postProcessSvg),
 * plus mechanism probes that bypass the precheck exactly the way a proposed
 * pipeline change would (raw d2 with identical flags, then the real
 * post-processor), to show each defence still holds.
 *
 * Build:  npx esbuild spikes/d2-features/harness/harness.ts --bundle \
 *           --platform=node --format=esm --outfile=/tmp/d2harness.mjs
 * Run:    node /tmp/d2harness.mjs   (writes out/*.svg + out/report.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeD2Source, extractD2Links, diagramHash } from "../../../packages/shared/src/content/d2.js";
import { precheckD2Source } from "../../../packages/service/src/diagrams/precheck.js";
import { renderD2Theme, D2_THEME_LIGHT, D2_THEME_DARK } from "../../../packages/service/src/diagrams/render.js";
import { postProcessSvg } from "../../../packages/service/src/diagrams/sanitize.js";
import { RealCommandRunner } from "../../../packages/service/src/exec/runner.js";

const ROOT = path.join(process.cwd(), "spikes/d2-features");
const SAMPLES = path.join(ROOT, "samples");
const OUT = path.join(ROOT, "out");
const D2_VERSION = "0.9.0";

const runner = new RealCommandRunner();

interface Row {
  sample: string;
  precheck: string; // "ok" | reason
  rendered: boolean;
  lightBytes?: number;
  darkBytes?: number;
  ms?: number;
  cites?: string[];
  citesMissing?: string[];
  externalAnchors?: string[];
  hasForeignObject?: boolean;
  animated?: boolean;
  error?: string;
  note?: string;
}

function citeMap(source: string): Map<string, { canonical: string }> {
  const m = new Map<string, { canonical: string }>();
  for (const t of extractD2Links(source)) m.set(t, { canonical: t });
  return m;
}

function inspectSvg(svg: string): { external: string[]; foreign: boolean; animated: boolean } {
  const external: string[] = [];
  for (const m of svg.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const href = tag.match(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    if (href) {
      const v = href[1].replace(/^["']|["']$/g, "");
      if (!/^#($|[^/])/.test(v) && v !== "#") external.push(v.slice(0, 80));
    }
  }
  for (const m of svg.matchAll(/\b(?:href|xlink:href)\s*=\s*"([^"]*)"/gi)) {
    const v = m[1];
    if (/^(https?:|javascript:|data:(?!image\/svg|font|image\/png)|\/\/)/i.test(v)) external.push(v.slice(0, 80));
  }
  const foreign = /foreignobject/i.test(svg);
  const animated = /<animate\b|<animatetransform\b|@keyframes|animation:/i.test(svg) || /class="[^"]*\banimated\b/i.test(svg);
  return { external, foreign, animated };
}

async function renderThroughPipeline(name: string, source: string): Promise<Row> {
  const row: Row = { sample: name, precheck: "?", rendered: false };
  const canon = canonicalizeD2Source(source);
  const pre = precheckD2Source(canon);
  row.precheck = pre.ok ? "ok" : pre.reason;
  if (!pre.ok) return row;
  const hash = diagramHash(canon, D2_VERSION);
  const cmap = citeMap(canon);
  const cites = extractD2Links(canon);
  row.cites = cites;
  const t0 = Date.now();
  const [light, dark] = await Promise.all([
    renderD2Theme(canon, { runner, binPath: process.env.D2_BIN as string, salt: hash, theme: D2_THEME_LIGHT }),
    renderD2Theme(canon, { runner, binPath: process.env.D2_BIN as string, salt: hash, theme: D2_THEME_DARK }),
  ]);
  row.ms = Date.now() - t0;
  if (!light.ok || !light.svg || !dark.ok || !dark.svg) {
    row.error = (!light.ok ? light.error : dark.error) ?? "render failed";
    return row;
  }
  const l = postProcessSvg(light.svg, cmap as never, hash);
  const d = postProcessSvg(dark.svg, cmap as never, hash);
  fs.writeFileSync(path.join(OUT, `${name}.light.svg`), l);
  fs.writeFileSync(path.join(OUT, `${name}.dark.svg`), d);
  row.rendered = true;
  row.lightBytes = Buffer.byteLength(l);
  row.darkBytes = Buffer.byteLength(d);
  const hrefs = new Set<string>();
  for (const m of l.matchAll(/\bhref\s*=\s*"([^"]*)"/gi)) hrefs.add(m[1]);
  for (const m of l.matchAll(/\bdata-refs\s*=\s*"([^"]*)"/gi)) hrefs.add(m[1]);
  row.citesMissing = cites.filter((t) => !hrefs.has(t));
  const insp = inspectSvg(l);
  row.externalAnchors = insp.external;
  row.hasForeignObject = insp.foreign;
  row.animated = insp.animated;
  return row;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".d2")).sort();
  for (const f of files) {
    const name = f.replace(/\.d2$/, "");
    const src = fs.readFileSync(path.join(SAMPLES, f), "utf8");
    try {
      rows.push(await renderThroughPipeline(name, src));
    } catch (e) {
      rows.push({ sample: name, precheck: "?", rendered: false, error: `harness: ${(e as Error).message}` });
    }
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 2));
  for (const r of rows) {
    console.log(
      `${r.sample}: precheck=${r.precheck.slice(0, 90)} rendered=${r.rendered}` +
        (r.lightBytes ? ` light=${r.lightBytes} dark=${r.darkBytes} ms=${r.ms}` : "") +
        (r.citesMissing?.length ? ` MISSING=${r.citesMissing.join(",")}` : "") +
        (r.externalAnchors?.length ? ` EXT=${r.externalAnchors.join(",")}` : "") +
        (r.hasForeignObject ? " FOREIGNOBJECT" : "") +
        (r.animated ? " ANIMATED" : "") +
        (r.error ? ` ERR=${r.error.slice(0, 160)}` : ""),
    );
  }
}

void main();
