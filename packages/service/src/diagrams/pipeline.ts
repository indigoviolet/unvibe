/**
 * D2 validation pipeline (docs/d2-diagrams.md).
 *
 * 1. Extract `link:` values from source (parser already did → block.citations).
 * 2. Validate each with the existing citation validator (ranges, auto-repair,
 *    unverified).
 * 3. Compile-check via the binary (`d2 validate -`).
 *    Either failure → exactly one repair turn carrying validator/compiler
 *    messages (the caller sends it).
 * 4. Render light + dark, post-process (anchor rewriting + sanitisation).
 * 5. Cache by hash (content hash of canonical source + d2 version + options).
 *
 * When the binary is unavailable: skip compile-check and rendering, keep
 * cite validation, mark `unavailable`, and render later on demand when the
 * binary appears (the diagrams endpoint does it).
 */
import { canonicalizeD2Source, canonicalizeTarget, diagramHash } from "@unvibe/shared";
import type { Citation, DiagramBlock } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import type { ReviewLookup } from "../validate/lookup.js";
import { validateTarget } from "../validate/index.js";
import type { ResolvedD2Bin } from "./bins.js";
import { checkD2Source, renderD2Theme, D2_THEME_DARK, D2_THEME_LIGHT } from "./render.js";
import { postProcessSvg, type CitationMap } from "./sanitize.js";
import { DiagramCache } from "./cache.js";

export interface FinalizeDeps {
  runner: CommandRunner;
  dataDir: string;
  fixturesDir?: string;
  lookup: ReviewLookup;
  d2bin: ResolvedD2Bin | null;
  d2version: string | null;
  cache?: DiagramCache;
}

export interface FinalizedBlock {
  block: DiagramBlock;
  /** True when cite validation or compile-check failed (caller sends one repair turn). */
  needsRepair: boolean;
  /** Validator + compiler messages for the repair turn. */
  messages: string[];
}

/**
 * Finalize one parsed diagram block (citations already extracted by the
 * parser). Canonicalises citations, compile-checks, renders, caches, and
 * sets `render`. Never throws (failures are `needsRepair` or `error`
 * status).
 */
export async function finalizeDiagramBlock(source: string, caption: string | undefined, deps: FinalizeDeps): Promise<FinalizedBlock> {
  const canonSource = canonicalizeD2Source(source);
  const messages: string[] = [];

  // --- steps 1–2: validate each link: target ---------------------------
  // Re-extract from source (parser did the same; this is the pipeline's own
  // pass so repair messages name the exact failing token).
  const { extractD2Links } = await import("@unvibe/shared");
  const rawTargets = extractD2Links(canonSource);
  const citations: Citation[] = [];
  let hasUnverified = false;
  for (const target of rawTargets) {
    const rep = validateTarget(target, deps.lookup);
    if (rep.status === "repaired" && rep.repairedTo) {
      citations.push({ target: canonicalizeTarget(rep.repairedTo, deps.lookup.resolveFileKey.bind(deps.lookup)) });
    } else if (rep.status === "unverified") {
      hasUnverified = true;
      citations.push({ target, unverified: true });
      messages.push(`- ${target}: ${rep.reason ?? "could not be verified"}`);
    } else {
      citations.push({ target: canonicalizeTarget(target, deps.lookup.resolveFileKey.bind(deps.lookup)) });
    }
  }
  // Caption citations (parser unioned them into block.citations; here we
  // only have source + caption text — the caller passes the parser's full
  // citation list separately when needed. For the pipeline helper the
  // source links are the contract; captions rarely carry cites.)

  // --- binary unavailable: mark unavailable, skip compile + render ------
  // Hash with the gated version (== the seed version) so the seeded cache
  // hits without `d2`; re-validated when the binary appears (endpoint
  // on-demand render recomputes with the real version).
  if (!deps.d2bin || !deps.d2version) {
    const { D2_MIN_VERSION } = await import("@unvibe/shared");
    const hash = diagramHash(canonSource, D2_MIN_VERSION);
    const block: DiagramBlock = {
      type: "diagram",
      id: "b-d2",
      source: canonSource,
      ...(caption ? { caption } : {}),
      citations,
      render: { hash, status: "unavailable" },
    };
    return { block, needsRepair: hasUnverified, messages };
  }

  // --- step 3: compile-check -------------------------------------------
  const check = await checkD2Source(canonSource, {
    runner: deps.runner,
    binPath: deps.d2bin.path,
  }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
  if (!check.ok) {
    messages.push(`- compile error: ${check.error ?? "d2 rejected the source"}`);
    const hash = diagramHash(canonSource, deps.d2version);
    const block: DiagramBlock = {
      type: "diagram",
      id: "b-d2",
      source: canonSource,
      ...(caption ? { caption } : {}),
      citations,
      render: { hash, status: "error", error: check.error ?? "compile error" },
    };
    return { block, needsRepair: true, messages };
  }

  if (hasUnverified) {
    const hash = diagramHash(canonSource, deps.d2version);
    const block: DiagramBlock = {
      type: "diagram",
      id: "b-d2",
      source: canonSource,
      ...(caption ? { caption } : {}),
      citations,
      render: { hash, status: "error", error: messages.join("; ").slice(0, 500) },
    };
    return { block, needsRepair: true, messages };
  }

  // --- steps 4–5: render light + dark, post-process, cache -------------
  const hash = diagramHash(canonSource, deps.d2version);
  const cache = deps.cache ?? new DiagramCache({ dataDir: deps.dataDir, ...(deps.fixturesDir ? { fixturesDir: deps.fixturesDir } : {}) });

  // Citation map for anchor rewriting (canonical + unverified flags).
  const cmap: CitationMap = new Map();
  for (const c of citations) {
    cmap.set(c.target, { canonical: c.target, ...(c.unverified ? { unverified: true as const } : {}) });
  }
  // Also map raw forms to canonical (parser may have canonicalised already;
  // the SVG contains the raw source tokens, so map both).
  for (const raw of rawTargets) {
    const canon = cmap.get(canonicalizeTarget(raw, deps.lookup.resolveFileKey.bind(deps.lookup)))?.canonical ?? raw;
    if (!cmap.has(raw)) {
      const unverified = citations.find((c) => c.target === canon)?.unverified;
      cmap.set(raw, { canonical: canon, ...(unverified ? { unverified: true as const } : {}) });
    }
  }

  const [light, dark] = await Promise.all([
    renderD2Theme(canonSource, { runner: deps.runner, binPath: deps.d2bin.path, salt: hash, theme: D2_THEME_LIGHT }),
    renderD2Theme(canonSource, { runner: deps.runner, binPath: deps.d2bin.path, salt: hash, theme: D2_THEME_DARK }),
  ]);

  if (!light.ok || !light.svg || !dark.ok || !dark.svg) {
    const err = (!light.ok ? light.error : dark.error) ?? "d2 render failed";
    const block: DiagramBlock = {
      type: "diagram",
      id: "b-d2",
      source: canonSource,
      ...(caption ? { caption } : {}),
      citations,
      render: { hash, status: "error", error: err },
    };
    return { block, needsRepair: true, messages: [...messages, `- render error: ${err}`] };
  }

  // --- silent-drop check (§9): compiled but a cite has no matching href --
  // D2 silently drops a `link:` written on its own dedented line under a
  // sequence message (no <a>, no visible text, exit 0). The repair trigger
  // is "every validated cite has a matching href in the rendered SVG", not
  // only "the binary exited non-zero".
  const hrefs = new Set<string>();
  for (const m of light.svg.matchAll(/\bhref\s*=\s*"([^"]*)"/gi)) hrefs.add(m[1]);
  for (const m of light.svg.matchAll(/\bxlink:href\s*=\s*"([^"]*)"/gi)) hrefs.add(m[1]);
  const missing = rawTargets.filter((t) => {
    const canonTargets = [
      t,
      canonicalizeTarget(t, deps.lookup.resolveFileKey.bind(deps.lookup)),
      cmap.get(t)?.canonical ?? "",
    ].filter(Boolean);
    return !canonTargets.some((c) => hrefs.has(c));
  });
  if (missing.length > 0) {
    const dropped = missing
      .map(
        (t) =>
          `- cite "${t}" is missing from the rendered SVG: a \`link:\` on its own indented line is silently dropped by D2; attach each citation inline on its shape or connection, e.g. \`a -> b: label { link: "${t}" }\` or \`myshape: "Short label" { link: "${t}" }\` (sequence-diagram edge cites only survive inline)`,
      )
      .join("\n");
    const block: DiagramBlock = {
      type: "diagram",
      id: "b-d2",
      source: canonSource,
      ...(caption ? { caption } : {}),
      citations,
      render: { hash, status: "error", error: `cites missing from SVG: ${missing.join(", ")}` },
    };
    return { block, needsRepair: true, messages: [...messages, dropped] };
  }

  cache.put(hash, "light", postProcessSvg(light.svg, cmap, hash));
  cache.put(hash, "dark", postProcessSvg(dark.svg, cmap, hash));

  const block: DiagramBlock = {
    type: "diagram",
    id: "b-d2",
    source: canonSource,
    ...(caption ? { caption } : {}),
    citations,
    render: { hash, status: "ok" },
  };
  return { block, needsRepair: false, messages: [] };
}
