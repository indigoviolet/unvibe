/**
 * GET /api/prompts?review=:id (PRD §4.14).
 *
 * - Without `?review=`: every template with its variables marked
 *   (`PromptTemplate`: name, role, tier, variables, raw text).
 * - With `?review=`: plus the exact expanded text that would be sent now,
 *   with layers L0–L4 marked (`<!-- layer:… -->` spans), token counts per
 *   layer, and the cached part set apart (`cached` flags + `cachedTokens`).
 *
 * Review data arrives through the narrow `SnapshotProvider` interface
 * (`getSnapshot(reviewId)`), which the supervisor wires to the
 * review-state module. Without a provider, `?review=` answers 501.
 *
 * Expansion rules (documented for the settings UI):
 * - Base templates (reader, base_pack, critic, hunk_pass, concept_*,
 *   update_pass, consolidate, second_opinion_*) expand against real review
 *   data: source blurb, diff section (with the same budget fallback the
 *   pipeline uses), pinned code, guide, concepts, hunk summaries, the log.
 * - Turn templates (explain, ask, note_ack, depth, examples, diagram,
 *   go_deeper) have no live anchor "now": their L4 renders with the
 *   review's real change list plus clearly-marked `(…)` placeholders for
 *   the anchor quote, thread, card-under-edit and user message.
 * - Caching flags: spans served from a warm base (L0–L3 on a fork) are
 *   `cached`; fresh sessions (reader, hunk pass, consolidate,
 *   second opinions) and every L4 are not.
 */
import type { FastifyInstance } from "fastify";
import {
  PROMPT_TEMPLATE_NAMES,
  tokenizeLinks,
  type PromptExpanded,
  type PromptLayerSpan,
  type PromptsResponse,
  type PromptTemplate,
} from "@unvibe/shared";
import {
  buildConceptsSection,
  buildDiffSection,
  buildGuideSection,
  buildHunkSummaries,
  buildL1bPinned,
  buildL1Source,
  buildSourceBlurb,
  charTokenEstimator,
  filterChangeList,
  formatChangeList,
  formatHunk,
  hunkId,
  pinnedId,
  type PromptReviewSnapshot,
} from "../context/index.js";
import {
  loadTemplatesDirSync,
  renderTemplate,
  resolvePromptsDir,
  type RenderValues,
  type TemplateLibrary,
} from "../prompts/index.js";

/** Narrow interface the supervisor wires to review state. */
export interface SnapshotProvider {
  getSnapshot(reviewId: string): Promise<PromptReviewSnapshot | null>;
}

export interface PromptsRouteDeps {
  /** Defaults to `resolvePromptsDir()` (env `UNVIBE_PROMPTS_DIR` or walk-up). */
  promptsDir?: string;
  /** When absent, `?review=` answers 501 until wired. */
  snapshots?: SnapshotProvider;
}

/** An expanded prompt with its layer spans (extends the shared contract). */
export interface ExpandedPrompt extends PromptExpanded {
  spans: PromptLayerSpan[];
}

interface Span {
  layer: PromptLayerSpan["layer"];
  label: string;
  text: string;
  cached: boolean;
}

function assemble(name: string, spans: Span[]): ExpandedPrompt {
  const parts: string[] = [];
  const fullSpans: PromptLayerSpan[] = spans.map((s) => ({
    layer: s.layer,
    label: s.label,
    tokens: charTokenEstimator.estimateTokens(s.text),
    cached: s.cached,
  }));
  let cachedTokens = 0;
  fullSpans.forEach((info, i) => {
    const text = spans[i].text;
    const flag = info.cached ? "cached:yes" : "cached:no";
    parts.push(
      `<!-- layer:${info.layer} label:${info.label} tokens:${info.tokens} ${flag} -->\n` +
        `${text}` +
        (text.endsWith("\n") ? "" : "\n") +
        `<!-- /layer:${info.layer} -->\n`,
    );
    if (info.cached) cachedTokens += info.tokens;
  });
  const layers = fullSpans.map(({ layer, tokens }) => ({ layer, tokens }));
  return { name, expanded: parts.join("\n"), layers, cachedTokens, spans: fullSpans };
}

function toTemplate(name: string, lib: TemplateLibrary): PromptTemplate {
  const t = lib.get(name);
  if (!t) throw new Error(`prompt template missing: ${name}`);
  return { name, role: t.role, tier: t.tier, variables: t.variables, template: t.body };
}

/** Values that are genuinely "now"; turn-specific ones stay placeholders. */
const PH = {
  anchorQuote: "(no text selected — open this template from Explain/Ask/Note)",
  anchorBlock: "(the host block is attached when the action runs)",
  thread: "(no thread yet)",
  message: "(the reader's message is attached when the action runs)",
  card: "(no card selected)",
  level: "(target level)",
  direction: "(no placeholder selected)",
  changedHunks: "(no newer version — the update pass lists changed hunks here)",
  staleCards: "(guide is current — affected cards are listed here after a refresh)",
  citedCode: "(cited excerpts are attached when the action runs)",
  topic: "(select a card or finding)",
  claim: "(select a card or finding)",
  mentions: "(mentions resolve when the action runs)",
  contributions: "(no contributions yet)",
};

/**
 * Citation IDs (`code:`/`diff:`) mentioned in Markdown, via shared tokens.
 * Used to attach real cited excerpts to the second-opinion expansion.
 */
function citedCodeIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const token of tokenizeLinks(markdown)) {
    if (/^(code|diff):/.test(token.idText)) ids.push(token.idText);
  }
  return ids;
}

/** Rendered excerpts for the given IDs from reader-pinned code. */
function excerptsFor(snapshot: PromptReviewSnapshot, ids: string[]): string {
  // Index by full ID and by short form (PRD §7.2: prompts may drop @sha).
  const byId = new Map<string, (typeof snapshot.pinnedCode)[number]>();
  for (const pin of snapshot.pinnedCode) {
    const full = pinnedId(pin);
    byId.set(full, pin);
    const short = full.split("@")[0];
    if (!byId.has(short)) byId.set(short, pin);
  }
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const pin = byId.get(id);
    if (pin) parts.push(`### [[${pinnedId(pin)}]]\n\n${pin.text}\n`);
  }
  return parts.length > 0 ? parts.join("\n") : PH.citedCode;
}

function firstFindingTopic(snapshot: PromptReviewSnapshot): { topic: string; claim: string } {
  const f = snapshot.findings[0];
  if (!f) return { topic: PH.topic, claim: PH.claim };
  return {
    topic: `${f.title} (${f.confidence}): ${f.summary}`,
    claim: `${f.title}: ${f.summary}`,
  };
}

function firstFindingCitedCode(snapshot: PromptReviewSnapshot): string {
  const f = snapshot.findings[0];
  if (!f) return PH.citedCode;
  return excerptsFor(snapshot, citedCodeIds(`${f.summary}\n${f.markdown}`));
}

/** Expand every template against the snapshot. Pure given the library. */
export function expandAll(lib: TemplateLibrary, snapshot: PromptReviewSnapshot): ExpandedPrompt[] {
  const render = (name: string, values: RenderValues): string => {
    const t = lib.get(name);
    if (!t) throw new Error(`prompt template missing: ${name}`);
    return renderTemplate(t, values);
  };

  const l0 = render("instructions", {});
  const blurb = buildSourceBlurb(snapshot);
  const diff = buildDiffSection(snapshot);
  const l1full = buildL1Source(snapshot);
  const l1b = buildL1bPinned(snapshot.pinnedCode);
  const guide = buildGuideSection(snapshot);
  const concepts = buildConceptsSection(snapshot);
  const hunkSummaries = buildHunkSummaries(snapshot);
  const changeList = formatChangeList(
    filterChangeList(snapshot.log, { lastSeenSeq: 0 }).slice(-10),
  );
  const recentLog = changeList === "(no changes)" ? "(log is empty)" : changeList;

  const firstHunk = snapshot.files.flatMap((f) =>
    f.hunks.map((h) => ({ file: f, hunk: h })),
  )[0];
  const hunkText = firstHunk
    ? `${formatHunk(firstHunk.hunk)}\n${firstHunk.hunk.citedByGuide === true ? "\nCITED-BY-GUIDE\n" : ""}`
    : "(no hunks)";
  const hunkPath = firstHunk ? firstHunk.file.path : "(no files)";
  const hunkLabel = firstHunk ? `hunk ${hunkId(firstHunk.hunk.fileKey, firstHunk.hunk.contentHash)}` : "hunk";

  const firstCard = snapshot.cards[0];
  const cardText = firstCard
    ? `### ${firstCard.title ?? "(untitled)"} [[card:${firstCard.id}]]\n\n${firstCard.markdown}\n`
    : PH.card;
  const firstConcept = snapshot.concepts[0];
  const conceptText = firstConcept
    ? `${firstConcept.slug} — ${firstConcept.title}: ${firstConcept.oneLine}`
    : PH.topic;
  const contributionLines = snapshot.log
    .filter((e) => e.kind === "contribution")
    .map((e) => `- [${e.seq}] ${JSON.stringify(e.payload)}`);
  const contributionsText =
    contributionLines.length > 0 ? contributionLines.join("\n") : PH.contributions;

  const { topic, claim } = firstFindingTopic(snapshot);
  const findingCited = firstFindingCitedCode(snapshot);
  const findingsText = snapshot.findings
    .map((f) => `### ${f.title} (${f.confidence}) [[page:${f.pageId}]]\n\n${f.summary}\n`)
    .join("\n");

  const baseSpans = (cached: boolean): Span[] => [
    { layer: "L0", label: "instructions", text: l0, cached },
    { layer: "L1", label: "source", text: l1full.text, cached },
    { layer: "L1b", label: "pinned", text: l1b, cached },
    { layer: "L2", label: "guide", text: `${guide}\n${concepts}\n${hunkSummaries}`, cached },
  ];

  const l3span = (cached: boolean): Span => ({
    layer: "L3",
    label: "log",
    text: recentLog,
    cached,
  });

  const out: ExpandedPrompt[] = [];
  const push = (name: string, spans: Span[]): void => {
    out.push(assemble(name, spans));
  };

  push("instructions", [{ layer: "L0", label: "instructions", text: l0, cached: false }]);
  push("reader", [
    { layer: "L0", label: "instructions", text: l0, cached: false },
    {
      layer: "L1",
      label: "reader task",
      text: render("reader", { source: blurb, diff_inline: diff.text, repo_path: "(worktree path)" }),
      cached: false,
    },
  ]);
  push("base_pack", [
    { layer: "L0", label: "instructions", text: l0, cached: true },
    { layer: "L1", label: "source", text: l1full.text, cached: true },
    { layer: "L1b", label: "pinned", text: l1b, cached: true },
    { layer: "L2", label: "guide", text: `${guide}\n${concepts}\n${hunkSummaries}`, cached: true },
    {
      layer: "L4",
      label: "base_pack",
      text: render("base_pack", {
        source: blurb,
        diff_inline: diff.text,
        pinned_code: l1b,
        guide,
        concepts,
        hunk_summaries: hunkSummaries,
      }),
      cached: false,
    },
  ]);
  const forked = (name: string, l4values: RenderValues): void =>
    push(name, [...baseSpans(true), l3span(true), { layer: "L4", label: name, text: render(name, l4values), cached: false }]);

  forked("critic", {});
  forked("concept_stub", { concept: conceptText, mentions: PH.mentions });
  forked("concept_page", { concept: conceptText, mentions: PH.mentions });
  forked("explain", {
    anchor: { quote: PH.anchorQuote, block: PH.anchorBlock },
    card: cardText,
    thread: PH.thread,
    change_list: changeList,
    message: PH.message,
  });
  forked("ask", {
    anchor: { quote: PH.anchorQuote, block: PH.anchorBlock },
    card: cardText,
    thread: PH.thread,
    change_list: changeList,
    message: PH.message,
  });
  forked("note_ack", {
    anchor: { quote: PH.anchorQuote, block: PH.anchorBlock },
    card: cardText,
    thread: PH.thread,
    change_list: changeList,
  });
  forked("depth", { card: cardText, level: PH.level });
  forked("examples", { card: cardText, level: PH.level });
  forked("diagram", { card: cardText, level: PH.level });
  forked("go_deeper", { direction: PH.direction });
  forked("update_pass", {
    changed_hunks: PH.changedHunks,
    stale_cards: PH.staleCards,
    findings: findingsText === "" ? "(no findings)" : findingsText,
  });

  push("hunk_pass", [
    {
      layer: "L1",
      label: hunkLabel,
      text: render("hunk_pass", { hunk: hunkText, path: hunkPath }),
      cached: false,
    },
  ]);
  push("consolidate", [
    {
      layer: "L3",
      label: "contributions",
      text: render("consolidate", { contributions: contributionsText }),
      cached: false,
    },
  ]);
  push("second_opinion_blind", [
    { layer: "L0", label: "instructions", text: l0, cached: false },
    { layer: "L1", label: "source", text: `${blurb}\n${diff.text}`, cached: false },
    {
      layer: "L4",
      label: "blind review",
      text: render("second_opinion_blind", { topic, cited_code: findingCited }),
      cached: false,
    },
  ]);
  push("second_opinion_check", [
    { layer: "L0", label: "instructions", text: l0, cached: false },
    { layer: "L1", label: "source", text: `${blurb}\n${diff.text}`, cached: false },
    {
      layer: "L4",
      label: "claim check",
      text: render("second_opinion_check", { claim, cited_code: findingCited }),
      cached: false,
    },
  ]);

  return out;
}

/** GET /api/prompts?review=:id */
export async function registerPrompts(
  app: FastifyInstance,
  deps: PromptsRouteDeps = {},
): Promise<void> {
  const dir = deps.promptsDir ?? resolvePromptsDir();
  let lib: TemplateLibrary | null = null;
  let loadError: string | null = null;
  if (dir) {
    try {
      lib = loadTemplatesDirSync(dir);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  app.get("/api/prompts", async (req, reply) => {
    if (!lib) {
      return reply
        .code(501)
        .send({ error: "prompts unavailable", detail: loadError ?? `no prompts dir (set UNVIBE_PROMPTS_DIR)` });
    }
    const query = req.query as { review?: string };
    const templates: PromptTemplate[] = PROMPT_TEMPLATE_NAMES.map((name) => toTemplate(name, lib));
    const body: PromptsResponse = { templates };
    if (query.review !== undefined) {
      if (!deps.snapshots) {
        return reply.code(501).send({ error: "review expansion not wired: no snapshot provider" });
      }
      let snapshot: PromptReviewSnapshot | null;
      try {
        snapshot = await deps.snapshots.getSnapshot(query.review);
      } catch (err) {
        return reply
          .code(500)
          .send({ error: "snapshot failed", detail: err instanceof Error ? err.message : String(err) });
      }
      if (!snapshot) return reply.code(404).send({ error: `unknown review ${query.review}` });
      try {
        (body as PromptsResponse & { expanded: ExpandedPrompt[] }).expanded = expandAll(lib, snapshot);
      } catch (err) {
        return reply
          .code(500)
          .send({ error: "expansion failed", detail: err instanceof Error ? err.message : String(err) });
      }
    }
    return body;
  });
}
