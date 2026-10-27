/**
 * Spike #286 icon-allowlist demo (owner decision): only three defences remain.
 * Demonstrates the allowlisted-icon render path end to end with REAL pieces:
 *  - validate: host exactly icons.terrastruct.com, https, no query/fragment
 *  - pre-fetch the bytes ourselves (5 s cap), stage into the compile dir,
 *    rewrite the source to the staged file, compile with the pipeline's
 *    IDENTICAL flags (d2 embeds local icons as data: even --bundle=false)
 *  - post-process with the real postProcessSvg + ONE variant line:
 *    keep <image> iff href is data:image/* (today it is dropped entirely)
 *  - 404/invented name -> strip the icon key, render without, record reason
 *  - disallowed host -> rejected before compile with a reason
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeD2Source, extractD2Links } from "../../../packages/shared/src/content/d2.js";
import { postProcessSvg, rewriteCitationAnchors, stripTokenTitles, sanitizeSvg, namespaceIds } from "../../../packages/service/src/diagrams/sanitize.js";
import { RealCommandRunner } from "../../../packages/service/src/exec/runner.js";

const ROOT = path.join(process.cwd(), "spikes/d2-features");
const OUT = path.join(ROOT, "out");
const D2 = process.env.D2_BIN as string;
const runner = new RealCommandRunner();
const ALLOW_HOST = "icons.terrastruct.com";

function validateIconUrl(raw: string): { ok: true; path: string } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: `icon URL does not parse: ${raw}` }; }
  if (u.protocol !== "https:") return { ok: false, reason: `icon URL must be https: ${raw}` };
  if (u.host !== ALLOW_HOST) return { ok: false, reason: `icon host not allowlisted (want ${ALLOW_HOST}): ${u.host}` };
  if (u.search || u.hash) return { ok: false, reason: `icon URL must have no query or fragment: ${raw}` };
  if (!u.pathname.endsWith(".svg")) return { ok: false, reason: `icon URL must end in .svg: ${raw}` };
  return { ok: true, path: u.pathname };
}

function extractIconUrls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bicon\s*:\s*("[^"]*"|'[^']*'|[^\s}]+)/gi)) {
    out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  for (const m of src.matchAll(/\bsrc\s*:\s*("[^"]*"|'[^']*'|[^\s}]+)/gi)) {
    out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return [...new Set(out)];
}

/** Simulate the proposed one-rule sanitiser change: everything real except
 *  <image> is kept iff its href is data:image/*. Implemented by masking
 *  data:-images through the real sanitizeSvg (which drops all <image>), then
 *  restoring the masked tags scrubbed to x/y/width/height/href only. */
function postWithIconKeep(raw: string, cmap: Map<string, { canonical: string }>, hash: string): string {
  const icons: string[] = [];
  const masked = raw.replace(/<image\b[^>]*>([\s\S]*?<\/image\s*>)?/gi, (m) => {
    const href = m.match(/\bhref\s*=\s*("[^"]*"|'[^']*')/i);
    const v = href ? href[1].slice(1, -1) : "";
    if (!/^data:image\//i.test(v)) return "";
    const attrs = ["x", "y", "width", "height"].map((a) => {
      const mm = m.match(new RegExp(`\\b${a}\\s*=\\s*("[^"]*"|'[^']*')`, "i"));
      return mm ? `${a}=${mm[1]}` : "";
    }).filter(Boolean).join(" ");
    icons.push(`<image ${attrs} href="${v}"/>`);
    return `<g data-d2icon="${icons.length - 1}"></g>`;
  });
  let out = rewriteCitationAnchors(masked, cmap as never);
  out = stripTokenTitles(out);
  out = sanitizeSvg(out);
  out = namespaceIds(out, hash);
  icons.forEach((tag, i) => { out = out.replace(`<g data-d2icon="${i}"></g>`, tag); });
  return out;
}

async function fetchIcon(url: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status} for ${url}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 100 * 1024) return { ok: false, reason: `icon too large (${buf.length}B): ${url}` };
    return { ok: true, bytes: buf };
  } catch (e) {
    return { ok: false, reason: `fetch failed (${(e as Error).message}): ${url}` };
  }
}

async function compileInDir(source: string, dir: string, salt: string): Promise<{ ok: true; svg: string; ms: number } | { ok: false; err: string }> {
  const t0 = Date.now();
  const r = await runner.run(D2, {
    args: ["--layout=dagre", "--pad=20", "--theme=0", `--salt=${salt}`, "--no-xml-tag", "--bundle=false", "-", "-"],
    cwd: dir,
    env: {
      PATH: "/usr/bin:/bin", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9",
      http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9",
      ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
      D2_BUNDLE: "false", GITHUB_TOKEN: undefined,
    },
    stdin: canonicalizeD2Source(source), timeoutMs: 15000,
  });
  if (r.code !== 0) {
    return { ok: false, err: `${r.stderr}\n${r.stdout}`.split("\n").find((l) => l.trim())?.slice(0, 200) ?? `exit ${r.code}` };
  }
  return { ok: true, svg: r.stdout, ms: Date.now() - t0 };
}

async function demo(name: string, source: string): Promise<void> {
  console.log(`--- ${name} ---`);
  const stripped: string[] = [];
  let src = source;
  // 1. validate every icon/image URL pre-compile
  for (const url of extractIconUrls(src)) {
    const v = validateIconUrl(url);
    if (!v.ok) { console.log(`REJECTED pre-compile: ${v.reason}`); return; }
  }
  // 2. pre-fetch allowlisted icons, stage, rewrite; strip on failure
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2icon-"));
  for (const url of extractIconUrls(src)) {
    const f = await fetchIcon(url);
    if (!f.ok) {
      console.log(`STRIPPED (render without): ${f.reason}`);
      stripped.push(url);
      src = src.split(url).join("");
      // drop a now-empty `icon: ` key remainder
      src = src.replace(/\{\s*icon\s*:\s*\}/g, "{}").replace(/\{(\s*),\s*/g, "{$1").replace(/,\s*\}/g, "}");
      continue;
    }
    const fname = `staged-${Buffer.from(url).toString("hex").slice(0, 12)}.svg`;
    fs.writeFileSync(path.join(dir, fname), f.bytes);
    console.log(`fetched ${f.bytes.length}B -> ${fname}`);
    src = src.split(url).join(`./${fname}`);
  }
  // 3. compile with pipeline flags
  const res = await compileInDir(src, dir, `icon-${name}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  if (!res.ok) { console.log(`COMPILE FAIL: ${res.err}`); return; }
  // 4. real post-processor; today it drops <image> — apply the variant after to show the delta
  const cmap = new Map<string, { canonical: string }>();
  for (const t of extractD2Links(src)) cmap.set(t, { canonical: t });
  const postDropped = postProcessSvg(res.svg, cmap as never, `icon-${name}`);
  const hasImageRaw = /<image\b/i.test(res.svg);
  const hasImagePost = /<image\b/i.test(postDropped);
  const withKept = postWithIconKeep(res.svg, cmap, `icon-${name}`);
  const hasImageKept = /<image\b/i.test(withKept);
  const extRefs = [...withKept.matchAll(/\bhref\s*=\s*"(https?:[^"]*)"/gi)].map((m) => m[1]);
  const anchors = [...withKept.matchAll(/data-refs="([^"]*)"/gi)].map((m) => m[1]);
  console.log(`raw <image>: ${hasImageRaw}, post <image> (today): ${hasImagePost}, with keep-data: variant: ${hasImageKept}`);
  console.log(`external hrefs after variant: [${extRefs.join("|") || "none"}] anchors: [${anchors.join("|")}] stripped: [${stripped.join("|") || "none"}]`);
  fs.writeFileSync(path.join(OUT, `icon-${name}.svg`), withKept);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await demo("allowed", `direction: right\nwarn: "long header value" {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg}\nwarn -> norm: unfold {link: "diff:conn:650-651"}\nnorm: "_normalize_header_values" {link: "diff:conn:80-88"}\n`);
  await demo("disallowed-host", `direction: right\nwarn: "long header value" {icon: https://example.com/warn.svg}\nwarn -> norm: unfold {link: "diff:conn:650-651"}\n`);
  await demo("invented-404", `direction: right\nwarn: "long header value" {icon: https://icons.terrastruct.com/essentials%2Fdatabase-server.svg}\nwarn -> norm: unfold {link: "diff:conn:650-651"}\nnorm: "_normalize_header_values" {link: "diff:conn:80-88"}\n`);
  await demo("query-fragment", `direction: right\nwarn: "x" {icon: https://icons.terrastruct.com/essentials%2F304-archive.svg?v=2}\nwarn -> norm: unfold {link: "diff:conn:650-651"}\n`);
}

void main();
