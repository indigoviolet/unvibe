/**
 * Shared D2 finalize + one repair turn for inline diagrams (issue #130).
 *
 * Only the Add-diagram action used to run the diagram pipeline
 * (cite validation, compile-check, render, cache, exactly one repair
 * turn); diagrams written inline in Explain expansions reached the reader
 * unchecked, so a bad shape (a box named `steps`, `.class:` inside
 * braces) surfaced as raw source with a jargon note. Every fill that
 * stores diagram blocks now finalizes them here and gets one repair turn
 * on failure, so stored blocks carry a real status.
 */
import { dedupeBlockIds, JOB_PRIORITY, type AsideBlock, type Block, type DiagramBlock } from "@unvibe/shared";
import { isReplayRunner } from "../../agent/factory.js";
import { DiagramCache } from "../../diagrams/cache.js";
import { resolveD2Bin, meetsD2MinVersion } from "../../diagrams/bins.js";
import { probeD2Version } from "../../diagrams/render.js";
import { finalizeDiagramBlock, type FinalizeDeps } from "../../diagrams/pipeline.js";
import {
  baseVersionOf,
  getSnapshotOrThrow,
  type ActionContext,
} from "./common.js";
import { storedCardTitle } from "./events.js";

/** True when a block list holds a diagram at any depth (asides nest). */
function hasDiagram(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "diagram" || (b.type === "aside" && hasDiagram((b as AsideBlock).inner)));
}

/**
 * Depth-first non-ok diagrams: the repair slots, in prompt/splice order
 * (top-level first, then aside-nested). `ok` diagrams are never touched.
 */
function repairableDiagrams(blocks: Block[]): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  const walk = (list: Block[]): void => {
    for (const b of list) {
      if (b.type === "diagram") {
        if (b.render?.status !== "ok") out.push(b);
      } else if (b.type === "aside") {
        walk((b as AsideBlock).inner);
      }
    }
  };
  walk(blocks);
  return out;
}

/** Run the D2 finalize pipeline over fresh blocks (diagrams at any depth). */
export async function finalizeFresh(
  ctx: ActionContext,
  fresh: Block[],
): Promise<{ blocks: Block[]; needsRepair: boolean; messages: string[] }> {
  const { pipeline, reviewId } = ctx;
  // Fast path: no diagrams, nothing to do (and no `d2` probe to pay for).
  if (!hasDiagram(fresh)) {
    return { blocks: fresh, needsRepair: false, messages: [] };
  }
  const lookup = pipeline.lookupForDiagrams(reviewId);
  const d2bin = resolveD2Bin({});
  let d2version: string | null = null;
  if (d2bin) {
    try {
      const v = await probeD2Version(pipeline.commands, d2bin.path);
      if (v && meetsD2MinVersion(v)) d2version = v;
    } catch {
      d2version = null;
    }
  }
  const fixturesDir = ctx.fixturesDir ?? pipeline.fixturesDir;
  const cache = new DiagramCache({
    dataDir: pipeline.dataDir,
    ...(fixturesDir ? { fixturesDir } : {}),
  });
  const deps: FinalizeDeps = {
    runner: pipeline.commands,
    dataDir: pipeline.dataDir,
    ...(fixturesDir ? { fixturesDir } : {}),
    lookup,
    d2bin: d2version ? d2bin : null,
    d2version,
    cache,
  };
  return finalizeList(fresh, deps);
}

/** Recursive finalize over one block list (asides nest). */
async function finalizeList(
  fresh: Block[],
  deps: FinalizeDeps,
): Promise<{ blocks: Block[]; needsRepair: boolean; messages: string[] }> {
  const out: Block[] = [];
  let needsRepair = false;
  const messages: string[] = [];
  for (const b of fresh) {
    if (b.type !== "diagram") {
      if (b.type === "aside") {
        const inner = await finalizeList((b as AsideBlock).inner, deps);
        out.push({ ...(b as AsideBlock), inner: inner.blocks });
        if (inner.needsRepair) {
          needsRepair = true;
          messages.push(...inner.messages);
        }
        continue;
      }
      out.push(b);
      continue;
    }
    const d = b as DiagramBlock;
    const caption = typeof d.caption === "string" ? d.caption : undefined;
    const finalized = await finalizeDiagramBlock(d.source, caption, deps);
    // Preserve the parser's block id (finalize uses a placeholder).
    out.push({ ...finalized.block, id: d.id });
    if (finalized.needsRepair) {
      needsRepair = true;
      messages.push(...finalized.messages);
    }
  }
  return { blocks: out, needsRepair, messages };
}

export interface RepairDiagramsOpts {
  /** Context line for the repair prompt (the card text, or `Explain: …`). */
  card: string;
  level: string;
  /** Dedupe anchor for the repair job (caller-scoped, e.g. card or annotation). */
  dedupeAnchor: string;
  /** Distinguishes repair jobs from first passes on the Debug page. */
  requestKind?: string;
  cardId?: string;
  annotationId?: string;
  conversationKey?: string;
  echoCandidates?: string[];
}

/** Marker line of the diagram repair prompt (fake-runner scripts match it). */
export const DIAGRAM_REPAIR_MARKER = "The previous diagram failed validation:";

/**
 * Repair-turn variables for the `diagram` template: the failed sources
 * (depth-first, the splice order below) plus the validator/compiler
 * messages, asking for fixed D2. Pure so fills that already hold a
 * session (go-deeper, concept pages) can run the same turn without
 * enqueueing a nested job.
 */
export function buildRepairVariables(
  card: string,
  level: string,
  messages: string[],
  blocks: Block[],
): { card: string; level: string } {
  const problems = messages.join("\n");
  const prevSources = repairableDiagrams(blocks)
    .map((d) => `\`\`\`d2\n${d.source}\n\`\`\``)
    .join("\n");
  return {
    card: `${card}\n\n${DIAGRAM_REPAIR_MARKER}\n${problems}\n${prevSources}\nFix the D2 source (citations and syntax) and reply again.`,
    level,
  };
}

/**
 * Merge a repair reply into the first pass: keep first-pass prose and
 * `ok` diagrams, splice repaired diagrams into the failed slots in
 * depth-first order (aside-nested included), preserving the stored ids
 * so anchors keep matching. Extra repair diagrams append at top level;
 * slots with no repair keep their error status. Throws when the repair
 * carries no diagram at all (the caller keeps the error-status blocks).
 */
export function mergeRepairedDiagrams(fresh: Block[], retry: Block[]): Block[] {
  const repaired = retry.filter((b): b is DiagramBlock => b.type === "diagram");
  const slots = repairableDiagrams(fresh).length;
  if (repaired.length === 0) {
    if (slots > 0) throw new Error(`diagram repair failed: no diagram in repair reply`);
    return fresh;
  }
  let i = 0;
  const splice = (list: Block[]): Block[] =>
    list.map((b) => {
      if (b.type === "diagram") {
        if (b.render?.status === "ok" || i >= repaired.length) return b;
        const fix = repaired[i++]!;
        return { ...fix, id: b.id };
      }
      if (b.type === "aside") return { ...(b as AsideBlock), inner: splice((b as AsideBlock).inner) };
      return b;
    });
  const out = splice(fresh);
  const extras = repaired.slice(i);
  if (extras.length === 0) return out;
  // Repair replies number their blocks from scratch (#116): dedupe across
  // the merge so one anchor still matches one block.
  return dedupeBlockIds([...out, ...extras]);
}

/** One repair turn: re-ask with validator/compiler messages + previous source. */
export async function repairDiagrams(
  ctx: ActionContext,
  opts: RepairDiagramsOpts,
  fresh: Block[],
  messages: string[],
): Promise<Block[]> {
  const { pipeline, reviews, reviewId } = ctx;
  const live = getSnapshotOrThrow(reviews, reviewId);
  const variables = buildRepairVariables(opts.card, opts.level, messages, fresh);
  const echoTitle = opts.cardId ? storedCardTitle(live, opts.cardId) : undefined;
  const res = await pipeline.runInFork({
    reviewId,
    kind: "diagram",
    template: "diagram",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: {
      anchor: opts.dedupeAnchor,
      requestKind: opts.requestKind ?? "diagram-repair",
      baseVersion: baseVersionOf(live),
    },
    ...(opts.cardId ? { cardId: opts.cardId } : {}),
    ...(opts.annotationId ? { annotationId: opts.annotationId } : {}),
    ...(opts.conversationKey ? { conversationKey: opts.conversationKey } : {}),
    ...((echoTitle ?? opts.echoCandidates) ? { echoCandidates: echoTitle ? [echoTitle] : opts.echoCandidates! } : {}),
    ...(isReplayRunner(pipeline.runner) ? { replay: { kind: "diagram" } } : {}),
  });
  const retry = res.cards.flatMap((c) => c.blocks) as Block[];
  return mergeRepairedDiagrams(fresh, retry);
}
