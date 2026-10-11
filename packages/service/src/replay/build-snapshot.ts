/**
 * CLI: `npm run fixture:snapshot` — build
 * `fixtures/urllib3-5020/snapshot.json` from the recordings plus pre-rendered
 * D2 SVGs into `fixtures/urllib3-5020/diagrams/<hash>.<theme>.svg`.
 * Exits non-zero (and writes nothing) when any citation is unverified.
 * Diagram pre-rendering needs the real `d2` binary; when absent the
 * snapshot still builds (render hashes are version-pinned) but SVGs are
 * left as-is with a warning.
 *
 * Usage: `node ./dist/replay/build-snapshot.js [--fixtures <dir>] [--out <file>]`
 */
import fs from "node:fs";
import path from "node:path";
import { buildSnapshot, defaultFixturesDir } from "./snapshot.js";
import { RealCommandRunner } from "../exec/runner.js";
import { resolveD2Bin, meetsD2MinVersion } from "../diagrams/bins.js";
import { probeD2Version, renderD2Theme, D2_THEME_DARK, D2_THEME_LIGHT } from "../diagrams/render.js";
import { postProcessSvg, type CitationMap } from "../diagrams/sanitize.js";
import type { DiagramBlock } from "@unvibe/shared";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const fixturesDir = path.resolve(arg("--fixtures") ?? defaultFixturesDir(import.meta.url));
const out = path.resolve(arg("--out") ?? path.join(fixturesDir, "snapshot.json"));

function collectDiagrams(snapshot: { pages: { cards: { blocks: unknown[] }[] }[] }): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const b of card.blocks ?? []) {
        if ((b as { type?: string }).type === "diagram") out.push(b as DiagramBlock);
        if ((b as { type?: string }).type === "aside") {
          for (const inner of (b as { inner: unknown[] }).inner ?? []) {
            if ((inner as { type?: string }).type === "diagram") out.push(inner as DiagramBlock);
          }
        }
      }
    }
  }
  // Dedupe by source (same diagram may appear in two recordings).
  const seen = new Set<string>();
  return out.filter((d) => {
    if (seen.has(d.source)) return false;
    seen.add(d.source);
    return true;
  });
}

try {
  const { snapshot, counts } = buildSnapshot(fixturesDir);
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
  const cites = counts.reduce((s, c) => s + c.citations, 0);
  console.log(
    `snapshot: ${snapshot.pages.length} pages, ${snapshot.files.length} files, ` +
      `${counts.length} recordings, ${cites} citations, 0 unverified → ${out}`,
  );

  // --- pre-render fixture diagrams (needs real d2) ----------------------
  // Snapshot-embedded diagrams (go-deeper flow card) plus the on-demand
  // diagram recordings (fold/path via the replay runner): all must have
  // pre-rendered SVGs so the demo serves diagrams without `d2`.
  const diagrams = collectDiagrams(snapshot);
  {
    const { parseReply } = await import("@unvibe/shared");
    for (const file of ["diagram-fold.md", "diagram-path.md"]) {
      try {
        const text = fs.readFileSync(path.join(fixturesDir, "recordings", file), "utf8");
        for (const block of parseReply(text).blocks) {
          if ((block as { type?: string }).type === "diagram") {
            const d = block as DiagramBlock;
            if (!diagrams.some((x) => x.source === d.source)) {
              // Compute the version-pinned hash like snapshot.ts does.
              const { diagramHash, D2_MIN_VERSION } = await import("@unvibe/shared");
              diagrams.push({ ...d, render: { hash: diagramHash(d.source, D2_MIN_VERSION), status: "ok" as const } });
            }
          }
        }
      } catch {
        // missing recording: snapshot build already validated the manifest
      }
    }
  }
  if (diagrams.length === 0) {
    console.log("diagrams: none in snapshot");
  } else {
    const bin = resolveD2Bin({});
    const runner = new RealCommandRunner();
    const version = bin ? await probeD2Version(runner, bin.path).catch(() => null) : null;
    if (!bin || !version || !meetsD2MinVersion(version)) {
      console.warn(
        `diagrams: SKIP pre-render (d2 ${bin ? `version ${version ?? "unknown"} too old` : "not found"}); ` +
          `snapshot render hashes are version-pinned and the seeded cache will serve existing SVGs`,
      );
    } else {
      const dir = path.join(fixturesDir, "diagrams");
      fs.mkdirSync(dir, { recursive: true });
      // Canonical resolver (same alias mapping as snapshot.ts): raw link:
      // tokens (diff:conn:…) → canonical (diff:<real-key>:…).
      const { canonicalizeTarget, extractD2Links } = await import("@unvibe/shared");
      const filesByKey = new Map(snapshot.files.map((f) => [f.fileKey, f]));
      const metaAliases = (JSON.parse(fs.readFileSync(path.join(fixturesDir, "meta.json"), "utf8")) as { keyAliases?: Record<string, string> }).keyAliases ?? {};
      const resolveKey = (key: string): string | null => {
        if (filesByKey.has(key)) return key;
        const aliased = metaAliases[key];
        return aliased && filesByKey.has(aliased) ? aliased : null;
      };
      for (const d of diagrams) {
        const hash = d.render?.hash;
        if (!hash) continue;
        const cmap: CitationMap = new Map();
        for (const raw of extractD2Links(d.source)) {
          const canon = canonicalizeTarget(raw, resolveKey);
          cmap.set(raw, { canonical: canon });
          cmap.set(canon, { canonical: canon });
        }
        for (const c of d.citations) {
          const canon = canonicalizeTarget(c.target, resolveKey);
          if (!cmap.has(canon)) cmap.set(canon, { canonical: canon });
          if (!cmap.has(c.target)) cmap.set(c.target, { canonical: canon });
        }
        const [light, dark] = await Promise.all([
          renderD2Theme(d.source, { runner, binPath: bin.path, salt: hash, theme: D2_THEME_LIGHT }),
          renderD2Theme(d.source, { runner, binPath: bin.path, salt: hash, theme: D2_THEME_DARK }),
        ]);
        if (!light.ok || !light.svg || !dark.ok || !dark.svg) {
          throw new Error(`diagram pre-render failed for ${hash}: ${light.error ?? dark.error}`);
        }
        fs.writeFileSync(path.join(dir, `${hash}.light.svg`), postProcessSvg(light.svg, cmap, hash));
        fs.writeFileSync(path.join(dir, `${hash}.dark.svg`), postProcessSvg(dark.svg, cmap, hash));
        console.log(`diagrams: rendered ${hash} (light+dark) → ${dir}/`);
      }
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
