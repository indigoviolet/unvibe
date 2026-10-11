/**
 * D2 seed determinism probe (bundled + run by `scripts/d2-seed-check.mjs`).
 *
 * Re-renders every pre-rendered fixture diagram
 * (`fixtures/urllib3-5020/diagrams/<hash>.<theme>.svg`) with the real `d2`
 * binary using exactly the seed recipe from
 * `packages/service/src/replay/build-snapshot.ts` (pinned flags via
 * `renderD2Theme`, `salt` = seed hash, same citation map, same
 * `postProcessSvg`) and compares bytes.
 *
 * Why: seeds are served statically by content hash on every platform, while
 * fresh renders are cached under the same hash. If `d2` output differs per
 * platform (same version), one hash names different bytes per machine —
 * report it as a hash/cache design finding, do not paper over it.
 *
 * Exit: 0 when identical (or when d2 is absent/unusable: SKIP). `--strict`
 * exits 1 on any mismatch. CI runs strict on Linux (same lineage as the
 * seeds) and report-only on macOS (cross-platform verdict).
 */
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizeD2Source,
  canonicalizeTarget,
  diagramHash,
  D2_MIN_VERSION,
  extractD2Links,
  parseReply,
} from "@unvibe/shared";
import {
  meetsD2MinVersion,
  resolveD2Bin,
} from "../packages/service/src/diagrams/bins.js";
import { RealCommandRunner } from "../packages/service/src/exec/runner.js";
import {
  D2_THEME_DARK,
  D2_THEME_LIGHT,
  probeD2Version,
  renderD2Theme,
} from "../packages/service/src/diagrams/render.js";
import { postProcessSvg, type CitationMap } from "../packages/service/src/diagrams/sanitize.js";

interface DiagramBlock {
  type: string;
  source: string;
  citations: { target: string }[];
  render?: { hash?: string; status?: string };
}

function collectDiagrams(snapshot: {
  pages: { cards: { blocks: unknown[] }[] }[];
}): { block: DiagramBlock; hash: string }[] {
  const out: { block: DiagramBlock; hash: string }[] = [];
  const seen = new Set<string>();
  const consider = (b: unknown): void => {
    const block = b as DiagramBlock;
    const hash = block?.type === "diagram" ? block.render?.hash : undefined;
    if (typeof hash === "string" && !seen.has(hash)) {
      seen.add(hash);
      out.push({ block, hash });
    }
  };
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const b of card.blocks ?? []) {
        consider(b);
        if ((b as { type?: string }).type === "aside") {
          for (const inner of (b as { inner: unknown[] }).inner ?? []) consider(inner);
        }
      }
    }
  }
  return out;
}

function firstDiff(a: string, b: string): { offset: number; aCtx: string; bCtx: string } | null {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  const n = Math.min(ab.length, bb.length);
  let i = 0;
  while (i < n && ab[i] === bb[i]) i++;
  if (i === n && ab.length === bb.length) return null;
  const ctx = (buf: Buffer): string =>
    buf
      .subarray(Math.max(0, i - 80), i + 80)
      .toString("utf8")
      .replace(/\s+/g, " ")
      .slice(0, 160);
  return { offset: i, aCtx: ctx(ab), bCtx: ctx(bb) };
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const strict = args.includes("--strict");
  const fixturesDir = path.join(ROOT, "fixtures", "urllib3-5020");
  const diagramsDir = path.join(fixturesDir, "diagrams");

  const bin = resolveD2Bin({});
  const runner = new RealCommandRunner();
  const version = bin ? await probeD2Version(runner, bin.path).catch(() => null) : null;
  if (!bin || !version || !meetsD2MinVersion(version)) {
    console.log(
      `D2-SEED-CHECK: SKIP (d2 ${bin ? `version ${version ?? "unknown"} too old` : "not found"}; ` +
        `run \`mise install d2\`)`,
    );
    return;
  }
  console.log(`D2-SEED-CHECK: d2 ${version} at ${bin.path} on ${process.platform}/${process.arch}`);

  const snapshot = JSON.parse(fs.readFileSync(path.join(fixturesDir, "snapshot.json"), "utf8")) as {
    files: { fileKey: string }[];
    pages: { cards: { blocks: unknown[] }[] }[];
  };
  const metaAliases = (
    JSON.parse(fs.readFileSync(path.join(fixturesDir, "meta.json"), "utf8")) as {
      keyAliases?: Record<string, string>;
    }
  ).keyAliases ?? {};
  const filesByKey = new Map(snapshot.files.map((f) => [f.fileKey, f]));
  const resolveKey = (key: string): string | null => {
    if (filesByKey.has(key)) return key;
    const aliased = metaAliases[key];
    return aliased && filesByKey.has(aliased) ? aliased : null;
  };

  const diagrams = collectDiagrams(snapshot);
  // Recording-derived diagrams (same recipe as build-snapshot.ts): the
  // on-demand fold/path recordings contribute seeds the snapshot lacks.
  for (const file of ["diagram-fold.md", "diagram-path.md"]) {
    try {
      const text = fs.readFileSync(path.join(fixturesDir, "recordings", file), "utf8");
      for (const b of parseReply(text).blocks) {
        const d = b as unknown as DiagramBlock;
        if (d?.type === "diagram" && !diagrams.some((x) => x.block.source === d.source)) {
          diagrams.push({ block: d, hash: diagramHash(d.source, D2_MIN_VERSION) });
        }
      }
    } catch {
      // missing recording: ignore (snapshot build validates the manifest)
    }
  }
  console.log(`D2-SEED-CHECK: ${diagrams.length} seeded diagram(s)`);
  let failures = 0;
  for (const { block, hash } of diagrams) {
    // Salt and hash must reproduce the seed recipe exactly.
    const canon = canonicalizeD2Source(block.source);
    const pinned = diagramHash(canon, D2_MIN_VERSION);
    if (pinned !== hash) {
      console.log(`  ${hash}: hash mismatch (seed recipe gives ${pinned}; seed made with another version?)`);
      failures++;
      continue;
    }
    // Same citation map as build-snapshot.ts.
    const cmap: CitationMap = new Map();
    for (const raw of extractD2Links(block.source)) {
      const c = canonicalizeTarget(raw, resolveKey);
      cmap.set(raw, { canonical: c });
      cmap.set(c, { canonical: c });
    }
    for (const c of block.citations ?? []) {
      const canonTarget = canonicalizeTarget(c.target, resolveKey);
      if (!cmap.has(canonTarget)) cmap.set(canonTarget, { canonical: canonTarget });
      if (!cmap.has(c.target)) cmap.set(c.target, { canonical: canonTarget });
    }
    const [light, dark] = await Promise.all([
      renderD2Theme(block.source, { runner, binPath: bin.path, salt: hash, theme: D2_THEME_LIGHT }),
      renderD2Theme(block.source, { runner, binPath: bin.path, salt: hash, theme: D2_THEME_DARK }),
    ]);
    for (const [theme, res] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const seedPath = path.join(diagramsDir, `${hash}.${theme}.svg`);
      if (!res.ok || !res.svg) {
        console.log(`  ${hash}.${theme}: RENDER FAILED (${res.error ?? "unknown"})`);
        failures++;
        continue;
      }
      let seed: string;
      try {
        seed = fs.readFileSync(seedPath, "utf8");
      } catch {
        console.log(`  ${hash}.${theme}: seed file missing (${seedPath})`);
        failures++;
        continue;
      }
      const fresh = postProcessSvg(res.svg, cmap, hash);
      const diff = firstDiff(seed, fresh);
      if (!diff) {
        console.log(`  ${hash}.${theme}: identical (${seed.length} bytes)`);
      } else {
        console.log(
          `  ${hash}.${theme}: DIFFERENT at byte ${diff.offset} (seed ${seed.length}B vs fresh ${fresh.length}B)\n` +
            `    seed : …${diff.aCtx}…\n` +
            `    fresh: …${diff.bCtx}…`,
        );
        failures++;
      }
    }
  }
  if (failures === 0) {
    console.log("D2-SEED-CHECK: IDENTICAL (fresh renders match the pre-rendered seeds byte for byte)");
    return;
  }
  console.log(`D2-SEED-CHECK: DIFFERENT (${failures} mismatch(es); see above — a hash/cache design finding, not a render bug)`);
  if (strict) process.exitCode = 1;
};

await main();
