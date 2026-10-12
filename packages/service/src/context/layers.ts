/**
 * Context layers L1, L1b, L2 (PRD §9.1) as pure string builders.
 *
 * Determinism: every builder is a pure function of its inputs. Files and
 * hunks render in input order; numbers and IDs are derived, never
 * generated; no timestamps. The same snapshot renders to the same bytes,
 * which is what makes provider caching work (§9.2).
 */
import {
  charTokenEstimator,
  DEFAULT_INLINE_BUDGET_TOKENS,
  type TokenEstimator,
} from "./tokens.js";
import type {
  ContextDiffLine,
  ContextFile,
  ContextHunk,
  FindingInput,
  GuideCardInput,
  PinnedExcerpt,
  PromptReviewSnapshot,
} from "./types.js";

/** Canonical hunk ID rendered on every hunk header (PRD §7.2). */
export function hunkId(fileKey: string, contentHash: string): string {
  return `h:${fileKey}:${contentHash}`;
}

/** Canonical pinned-code ID for an excerpt. */
export function pinnedId(pin: PinnedExcerpt): string {
  const range = pin.start === pin.end ? `${pin.start}` : `${pin.start}-${pin.end}`;
  return `code:${pin.path}:${range}@${pin.sha}`;
}

function countKind(lines: ContextDiffLine[], kind: ContextDiffLine["kind"]): number {
  let n = 0;
  for (const l of lines) if (l.kind === kind) n++;
  return n;
}

/**
 * Render one hunk header: hunk ID, raw `@@` line, function context, new-side
 * range, and +/− counts — the "Hunk i of n · lines a–b · in <function> ·
 * +x −y" shape from §4.13 with the raw line kept for hover.
 */
export function formatHunkHeader(hunk: ContextHunk): string {
  const added = countKind(hunk.lines, "add");
  const removed = countKind(hunk.lines, "del");
  const newCount = added + countKind(hunk.lines, "ctx");
  const newEnd = newCount > 0 ? hunk.newStart + newCount - 1 : hunk.newStart;
  const where = hunk.context ? ` in ${hunk.context}` : "";
  return (
    `### [[${hunkId(hunk.fileKey, hunk.contentHash)}]] ` +
    `\`${hunk.header}\`${where} · lines ${hunk.newStart}–${newEnd} · +${added} −${removed}`
  );
}

/**
 * Render one diff line with its new-side number (`n<no> + …` for added and
 * context lines) or old-side number (`o<no> - …` for deletions), so every
 * inlined line carries an ID-able location (PRD §9.1).
 */
export function formatDiffLine(line: ContextDiffLine, newNo: number, oldNo: number): string {
  if (line.kind === "del") return `o${oldNo} - ${line.text}`;
  const mark = line.kind === "add" ? "+" : " ";
  return `n${newNo} ${mark} ${line.text}`;
}

/** Render a full hunk: header plus every line with its number. */
export function formatHunk(hunk: ContextHunk): string {
  const out = [formatHunkHeader(hunk)];
  let n = hunk.newStart;
  let o = hunk.oldStart;
  for (const line of hunk.lines) {
    out.push(formatDiffLine(line, n, o));
    if (line.kind !== "del") n++;
    if (line.kind !== "add") o++;
  }
  return out.join("\n");
}

/** One-line summary row for a hunk the budget (or Hide-uninteresting) left out. */
export function formatHiddenHunk(hunk: ContextHunk): string {
  const summary = hunk.summary ?? "(no summary yet)";
  const reason = hunk.hiddenReason ? ` · ${hunk.hiddenReason}` : "";
  return `- [[${hunkId(hunk.fileKey, hunk.contentHash)}]]: ${summary}${reason}`;
}

export interface L1Options {
  estimator?: TokenEstimator;
  /** Inline budget in tokens (setting, default ~40k, PRD §9.1). */
  inlineBudgetTokens?: number;
  /**
   * Content hashes of hunks overlapping reader-pinned excerpts. Over
   * budget, these still inline in full; everything else falls back to
   * headers + summaries fetched later with `get_hunk`.
   */
  pinnedHunkHashes?: ReadonlySet<string>;
}

export interface L1Result {
  text: string;
  /** True when the fallback rendering was used. */
  overBudget: boolean;
  diffTokens: number;
  inlineBudgetTokens: number;
  inlinedHunkIds: string[];
  summarizedHunkIds: string[];
}

export interface DiffSectionResult {
  text: string;
  overBudget: boolean;
  diffTokens: number;
  inlineBudgetTokens: number;
  inlinedHunkIds: string[];
  summarizedHunkIds: string[];
}

/**
 * The `{{source}}` variable: metadata, description or commit log, and the
 * file list — everything in L1 except the diff itself and hidden rows.
 */
export function buildSourceBlurb(snapshot: PromptReviewSnapshot): string {
  const head: string[] = [
    `# Source: ${snapshot.title}`,
    "",
    `- repo: ${snapshot.repo}`,
    `- branch: ${snapshot.branch}`,
    ...(snapshot.prNumber !== undefined ? [`- pr: #${snapshot.prNumber}`] : []),
    `- version: ${snapshot.version} (head ${snapshot.headSha}, base ${snapshot.baseRef})`,
    "",
  ];
  if (snapshot.sourceKind === "pr") {
    head.push("## Description", "", snapshot.description ?? "(no description)", "");
  } else {
    head.push("## Commit log", "", snapshot.commitLog ?? "(no commits)", "");
  }
  head.push("## Files", "");
  for (const file of snapshot.files) {
    const lines = file.hunks.flatMap((h) => h.lines);
    const added = lines.filter((l) => l.kind === "add").length;
    const removed = lines.filter((l) => l.kind === "del").length;
    const hidden = file.hunks.filter((h) => h.hiddenReason !== undefined).length;
    const hiddenNote = hidden > 0 ? ` · ${hidden} hidden` : "";
    const hunks = file.hunks.length === 1 ? "1 hunk" : `${file.hunks.length} hunks`;
    head.push(`- ${file.path} — +${added} −${removed} (${hunks}${hiddenNote})`);
  }
  head.push("");
  return head.join("\n");
}

/**
 * The `{{diff_inline}}` variable: per-file hunks with IDs inline.
 *
 * Over the inline budget, only cited and pinned hunks inline in full;
 * every other hunk becomes a header + one-line summary row, with a notice
 * that the rest is fetched with `get_hunk`. Guide-cited hunks are always
 * inlined: a real version never hides a hunk the guide cites (§4.13).
 */
export function buildDiffSection(
  snapshot: PromptReviewSnapshot,
  opts: L1Options = {},
): DiffSectionResult {
  const estimator = opts.estimator ?? charTokenEstimator;
  const inlineBudgetTokens = opts.inlineBudgetTokens ?? DEFAULT_INLINE_BUDGET_TOKENS;
  const pinned = opts.pinnedHunkHashes ?? new Set<string>();

  const fullFileSections: string[] = [];
  const allHunks: { file: ContextFile; hunk: ContextHunk; full: string }[] = [];
  for (const file of snapshot.files) {
    const parts = [`## file: ${file.path} (${file.category})`, ""];
    for (const hunk of file.hunks) {
      const full = formatHunk(hunk);
      allHunks.push({ file, hunk, full });
      parts.push(full, "");
    }
    fullFileSections.push(parts.join("\n"));
  }
  const fullDiff = fullFileSections.join("\n");
  const diffTokens = estimator.estimateTokens(fullDiff);
  const overBudget = diffTokens > inlineBudgetTokens;

  const inlinedHunkIds: string[] = [];
  const summarizedHunkIds: string[] = [];
  let text: string;
  if (!overBudget) {
    text = `## Diff\n\n${fullDiff}`;
    for (const { hunk } of allHunks) inlinedHunkIds.push(hunkId(hunk.fileKey, hunk.contentHash));
  } else {
    const parts = [
      "## Diff (budget-limited)",
      "",
      `> Diff over the inline budget (${diffTokens} tokens > ${inlineBudgetTokens}): ` +
        "showing hunk headers, summaries and pinned hunks in full. " +
        "Fetch any other hunk with `get_hunk`.",
      "",
    ];
    const byFile = new Map<string, string[]>();
    for (const { file, hunk, full } of allHunks) {
      const id = hunkId(hunk.fileKey, hunk.contentHash);
      if (pinned.has(hunk.contentHash) || hunk.citedByGuide === true) {
        inlinedHunkIds.push(id);
        pushFileLine(byFile, file, full);
      } else {
        summarizedHunkIds.push(id);
        pushFileLine(byFile, file, `${formatHunkHeader(hunk)}\n${formatHiddenHunk(hunk)}`);
      }
    }
    for (const file of snapshot.files) {
      const lines = byFile.get(file.fileKey);
      if (!lines) continue;
      parts.push(`## file: ${file.path} (${file.category})`, "", ...lines, "");
    }
    text = parts.join("\n");
  }
  return { text, overBudget, diffTokens, inlineBudgetTokens, inlinedHunkIds, summarizedHunkIds };
}

/** One-line rows for every hidden hunk (the L1 tail section). */
export function buildHiddenHunksSection(snapshot: PromptReviewSnapshot): string {
  const rows: string[] = [];
  for (const file of snapshot.files) {
    for (const hunk of file.hunks) {
      if (hunk.hiddenReason !== undefined) rows.push(formatHiddenHunk(hunk));
    }
  }
  return ["## Hidden hunks", "", ...(rows.length > 0 ? rows : ["(none)"]), ""].join("\n");
}

/**
 * Build L1 Source: metadata, description or commit log, the diff with IDs
 * inline, the file list, and one-line summaries of hidden hunks.
 */
export function buildL1Source(snapshot: PromptReviewSnapshot, opts: L1Options = {}): L1Result {
  const diff = buildDiffSection(snapshot, opts);
  const text = [buildSourceBlurb(snapshot), diff.text, buildHiddenHunksSection(snapshot)].join("\n");
  return {
    text,
    overBudget: diff.overBudget,
    diffTokens: diff.diffTokens,
    inlineBudgetTokens: diff.inlineBudgetTokens,
    inlinedHunkIds: diff.inlinedHunkIds,
    summarizedHunkIds: diff.summarizedHunkIds,
  };
}

function pushFileLine(byFile: Map<string, string[]>, file: ContextFile, line: string): void {
  const arr = byFile.get(file.fileKey);
  if (arr) arr.push(line, "");
  else byFile.set(file.fileKey, [line, ""]);
}

/** Build L1b: pinned excerpts, each with a `code:` ID. */
export function buildL1bPinned(pins: PinnedExcerpt[]): string {
  if (pins.length === 0) return "## Pinned code\n\n(none)\n";
  const parts = ["## Pinned code", ""];
  for (const pin of pins) {
    parts.push(`### [[${pinnedId(pin)}]]`, "");
    // Pins stored before their text was persisted (or whose file could
    // not be resolved) carry empty text: say so instead of an empty fence.
    if (pin.text) parts.push(`\`\`\`${pin.language ?? ""}`, pin.text, "```", "");
    else parts.push("(pinned excerpt unavailable — needs re-pinning)", "");
  }
  return parts.join("\n");
}

/** Render one guide card at standard depth with its `card:` reference. */
export function formatGuideCard(card: GuideCardInput): string {
  const title = card.title ?? "(untitled)";
  return [`### ${title} [[card:${card.id}]]`, "", card.markdown, ""].join("\n");
}

/** Render one finding with its page reference and confidence label. */
export function formatFinding(finding: FindingInput): string {
  return [
    `### ${finding.title} (${finding.confidence}) [[page:${finding.pageId}]]`,
    "",
    finding.summary,
    "",
    finding.markdown,
    "",
  ].join("\n");
}

/**
 * The `{{guide}}` variable and the first half of L2: guide cards at
 * standard depth plus findings.
 */
export function buildGuideSection(snapshot: PromptReviewSnapshot): string {
  const parts = ["## Guide (standard depth)", ""];
  if (snapshot.cards.length === 0) parts.push("(guide not generated yet)", "");
  for (const card of snapshot.cards) parts.push(formatGuideCard(card));
  parts.push("## Findings", "");
  if (snapshot.findings.length === 0) parts.push("(no findings)", "");
  for (const finding of snapshot.findings) parts.push(formatFinding(finding));
  return parts.join("\n");
}

/** The `{{concepts}}` variable: the one-line concept index. */
export function buildConceptsSection(snapshot: PromptReviewSnapshot): string {
  const parts = ["## Concept index", ""];
  if (snapshot.concepts.length === 0) {
    parts.push("(no concepts)", "");
  } else {
    for (const c of snapshot.concepts) {
      parts.push(`- [[concept:${c.slug}|${c.title}]] — ${c.oneLine}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

/**
 * Build L2 Reader output: guide cards at standard depth, findings, the
 * one-line concept index (PRD §9.1).
 */
export function buildL2Guide(snapshot: PromptReviewSnapshot): string {
  return [buildGuideSection(snapshot), buildConceptsSection(snapshot)].join("\n");
}

/**
 * Build the hunk-summaries section (the `{{hunk_summaries}}` variable of
 * the base pack): one line per hunk, summary or `(pending)`.
 */
export function buildHunkSummaries(snapshot: PromptReviewSnapshot): string {
  const rows: string[] = ["## Hunk summaries", ""];
  let any = false;
  for (const file of snapshot.files) {
    for (const hunk of file.hunks) {
      any = true;
      rows.push(`- [[${hunkId(hunk.fileKey, hunk.contentHash)}]]: ${hunk.summary ?? "(pending)"}`);
    }
  }
  if (!any) rows.push("(no hunks)");
  rows.push("");
  return rows.join("\n");
}

export interface L4Conversation {
  /** Quoted anchor text. */
  anchorQuote: string;
  /** Full host block: paragraph, description text, or diff lines. */
  anchorBlock: string;
  /** The card the anchor belongs to, rendered to Markdown. */
  cardText: string;
  /** Nearby annotations in full. */
  nearbyAnnotations: string;
  /** Thread messages so far, rendered to Markdown. */
  threadText: string;
  /** Filtered change list for this session's next turn (pre-rendered). */
  changeListText: string;
  /** The user's message this turn. */
  userMessage: string;
}

/**
 * Build L4 Conversation (PRD §9.1): anchor quote, full host block, its
 * card, nearby annotations, thread so far, change list, user message.
 * Empty parts render as `(none)` so the shape is stable.
 */
export function buildL4Conversation(conv: L4Conversation): string {
  const part = (title: string, body: string): string =>
    `## ${title}\n\n${body === "" ? "(none)" : body}\n`;
  return (
    `# Conversation\n\n` +
    part("Anchor", `> ${conv.anchorQuote}`) +
    part("Host block", conv.anchorBlock) +
    part("Card", conv.cardText) +
    part("Nearby annotations", conv.nearbyAnnotations) +
    part("Thread so far", conv.threadText) +
    part("Change list", conv.changeListText) +
    part("User message", conv.userMessage)
  );
}
