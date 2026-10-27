/**
 * Spike #286 mechanism probes (owner decision: only 3 defences remain).
 * Bypasses the precheck exactly the way a lifted ban would: runs the raw
 * `d2` binary with the pipeline's IDENTICAL flags, then the REAL
 * postProcessSvg, and reports what survives the sanitiser.
 *
 * Probes:
 *  - md/latex labels: do their links survive postProcessSvg?
 *  - vars / classes: / d2-config / tooltip: what renders, what survives?
 *  - icon rewrite: `icon: <url>` -> staged bundled local file, same flags,
 *    cwd=staged dir. Defence check: no network (sandbox proxies), output
 *    keeps or drops the icon?
 *  - icon remote (evidence): raw render with sandbox env; does it fail?
 *  - boards: layers -> output dir (how many SVGs?); steps +
 *    --animate-interval -> animated SVG? cites in boards? reduced motion?
 *  - caps: chain diagrams at 12/20/30/50/80 shapes: wall ms + output bytes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeD2Source, extractD2Links, diagramHash } from "../../../packages/shared/src/content/d2.js";
import { postProcessSvg } from "../../../packages/service/src/diagrams/sanitize.js";
import { RealCommandRunner } from "../../../packages/service/src/exec/runner.js";

const ROOT = path.join(process.cwd(), "spikes/d2-features");
const SAMPLES = path.join(ROOT, "samples");
const OUT = path.join(ROOT, "out");
const D2 = process.env.D2_BIN as string;

const runner = new RealCommandRunner();

function sandboxEnv(): Record<string, string | undefined> {
  return {
    PATH: "/usr/bin:/bin",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    all_proxy: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1:9".slice(0, 0) + "127.0.0.1,localhost",
    D2_BUNDLE: "false",
    GITHUB_TOKEN: undefined,
  };
}

function flags(salt: string, theme: number, extra: string[] = []): string[] {
  return [`--layout=dagre`, `--pad=20`, `--theme=${theme}`, `--salt=${salt}`,
    "--no-xml-tag", "--bundle=false", ...extra, "-", "-"];
}

async function rawRender(source: string, salt: string, opts: { cwd?: string; extra?: string[] } = {}):
  Promise<{ ok: boolean; svg?: string; err?: string; ms?: number }> {
  const tmp = opts.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2probe-"));
  const t0 = Date.now();
  try {
    const r = await runner.run(D2, {
      args: flags(salt, 0, opts.extra), cwd: tmp, env: sandboxEnv(),
      stdin: canonicalizeD2Source(source), timeoutMs: 15000,
    });
    const ms = Date.now() - t0;
    if (r.code !== 0) {
      const msg = `${r.stderr}\n${r.stdout}`.split("\n").find((l) => l.trim()) ?? `exit ${r.code}`;
      return { ok: false, err: msg.slice(0, 300), ms };
    }
    if (!r.stdout.includes("<svg")) return { ok: false, err: "no SVG", ms };
    return { ok: true, svg: r.stdout, ms };
  } finally {
    if (!opts.cwd) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

function cmapOf(src: string): Map<string, { canonical: string }> {
  const m = new Map<string, { canonical: string }>();
  for (const t of extractD2Links(src)) m.set(t, { canonical: t });
  return m;
}

function summarize(label: string, src: string, res: { ok: boolean; svg?: string; err?: string; ms?: number }): void {
  if (!res.ok || !res.svg) { console.log(`${label}: RAW-FAIL ms=${res.ms} err=${res.err}`); return; }
  const hash = diagramHash(canonicalizeD2Source(src), "0.9.0");
  const out = postProcessSvg(res.svg, cmapOf(src) as never, hash);
  const anchors = [...out.matchAll(/<a\b[^>]*data-refs="([^"]*)"[^>]*>/gi)].map((m) => m[1]);
  const rawExt = [...out.matchAll(/\bhref\s*=\s*"(https?:[^"]*|javascript:[^"]*)"/gi)].map((m) => m[1]);
  const foreign = /foreignobject/i.test(out);
  const title = [...out.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => m[1].slice(0, 80));
  const animated = /<animate\b|@keyframes|animation:/i.test(out);
  const motion = /prefers-reduced-motion/i.test(out);
  fs.writeFileSync(path.join(OUT, `probe-${label}.svg`), out);
  console.log(`${label}: rawBytes=${Buffer.byteLength(res.svg)} postBytes=${Buffer.byteLength(out)} ms=${res.ms} anchors=[${anchors.join("|")}] extHrefs=[${rawExt.join("|")}] foreign=${foreign} titles=[${title.join("|")}] animated=${animated} reducedMotionQuery=${motion}`);
}

function chain(n: number): string {
  const lines = ["direction: right"];
  for (let i = 0; i < n; i++) lines.push(`s${i}: "step ${i}" {link: "diff:conn:${i}-${i + 8}"}`);
  for (let i = 0; i < n - 1; i++) lines.push(`s${i} -> s${i + 1}: go {link: "diff:conn:${i}-${i + 8}"}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const read = (f: string): string => fs.readFileSync(path.join(SAMPLES, f), "utf8");

  for (const f of ["05-md-label.d2", "29-latex-label.d2", "09-vars.d2", "10-classes.d2",
    "11-tooltip.d2", "30-d2config.d2", "06-layers.d2", "07-scenarios.d2", "08-steps-animate.d2"]) {
    const src = read(f);
    summarize(f.replace(/\.d2$/, ""), src, await rawRender(src, `probe-${f}`));
  }

  // icon remote: evidence that the fetch fails offline/sandboxed
  summarize("02-icon-remote", read("02-icon-remote.d2"), await rawRender(read("02-icon-remote.d2"), "probe-icon-remote"));

  // icon rewrite: bundled local file staged next to the source
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2icon-"));
  fs.mkdirSync(path.join(stage, "icons"), { recursive: true });
  fs.writeFileSync(path.join(stage, "icons", "warn.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1 15 14H1Z" fill="#c62828"/></svg>`);
  const iconSrc = `direction: right\nwarn: "long header value" {icon: ./icons/warn.svg}\nwarn -> norm: unfold {link: "diff:conn:650-651"}\nnorm: "_normalize_header_values" {link: "diff:conn:80-88"}\n`;
  summarize("32-icon-local-rewrite", iconSrc, await rawRender(iconSrc, "probe-icon-local", { cwd: stage }));
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* noop */ }

  // boards: layers to an output dir
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2boards-"));
    const src = read("06-layers.d2");
    const infile = path.join(dir, "in.d2");
    const outdir = path.join(dir, "boards");
    fs.writeFileSync(infile, canonicalizeD2Source(src));
    const r = await runner.run(D2, {
      args: ["--layout=dagre", "--pad=20", "--theme=0", "--no-xml-tag", "--bundle=false", infile, outdir],
      cwd: dir, env: sandboxEnv(), timeoutMs: 15000,
    });
    let listing = "";
    try {
      listing = fs.readdirSync(outdir).join(",");
      for (const f of fs.readdirSync(outdir)) {
        const b = fs.statSync(path.join(outdir, f)).size;
        listing += ` ${f}=${b}B`;
        if (f.endsWith(".svg") && !fs.existsSync(path.join(OUT, `probe-boards-${f}`))) {
          const raw = fs.readFileSync(path.join(outdir, f), "utf8");
          const hash = diagramHash(canonicalizeD2Source(src) + f, "0.9.0");
          fs.writeFileSync(path.join(OUT, `probe-boards-${f}`), postProcessSvg(raw, cmapOf(src) as never, hash));
        }
      }
    } catch (e) { listing = `no-outdir code=${r.code} ${(r.stderr || r.stdout).split("\n")[0]?.slice(0, 200)}`; }
    console.log(`boards-layers-to-dir: code info: ${listing}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }

  // steps + --animate-interval flag -> single animated SVG?
  {
    const src = read("08-steps-animate.d2");
    const res = await rawRender(src, "probe-animate-flag", { extra: ["--animate-interval=1000"] });
    summarize("08-steps-animate-flag", src, res);
    // and without the flag (what plain stdout gives)
    summarize("08-steps-plain", src, await rawRender(src, "probe-animate-plain"));
  }

  // caps: wall time + output bytes at 12/20/30/50/80 shapes
  for (const n of [12, 20, 30, 50, 80]) {
    const src = chain(n);
    fs.writeFileSync(path.join(SAMPLES, `gen-cap-${n}.d2`), src);
    const t0 = Date.now();
    const res = await rawRender(src, `cap-${n}`);
    const ms = Date.now() - t0;
    const bytes = res.svg ? Buffer.byteLength(res.svg) : 0;
    const post = res.svg ? Buffer.byteLength(postProcessSvg(res.svg, cmapOf(src) as never, diagramHash(canonicalizeD2Source(src), "0.9.0"))) : 0;
    console.log(`cap-${n}: ok=${res.ok} wallMs=${ms} rawBytes=${bytes} postBytes=${post} err=${res.err ?? ""}`);
  }
}

void main();
