/**
 * Agent-reply content layer (PRD §10): trailing-JSON split, Markdown →
 * `Block[]` parsing, streaming prefix parses, and target collection for
 * the citation validator.
 */
export type {
  FindingConfidence,
  ParsedCard,
  ParseOptions,
  ReplyData,
  SplitError,
  SplitErrorKind,
  SplitResult,
} from "./types.js";
export { splitReply } from "./split.js";
export {
  HUNK_SUMMARY_MAX,
  looksLikeJson,
  parseHunkReply,
  truncateAtWordBoundary,
} from "./hunk.js";
export type { HunkReplyResult } from "./hunk.js";
export {
  collectTargets,
  parseBlocks,
  parseCards,
  parseCardsPartial,
  parseReply,
  renderInline,
  renderMarkdown,
  splitCardSections,
} from "./parse.js";
export type { CollectedTargets, ParsedReply, RenderedInline } from "./parse.js";
export {
  blockPlainText,
  CARD_TITLE_FALLBACK_MAX,
  displayCardTitle,
  fallbackCardTitle,
  normalizeEchoLine,
  stripEchoFromCards,
  stripLeadingEcho,
} from "./titles.js";
export {
  D2_MIN_VERSION,
  D2_RENDER_OPTIONS,
  D2_VERSION_UNKNOWN,
  DIAGRAM_HASH_LEN,
  DIAGRAM_POSTPROCESS_VERSION,
  canonicalizeD2Source,
  diagramHash,
  extractD2Links,
} from "./d2.js";
export {
  allDiagramBlocks,
  dedupeBlockIds,
  findDiagramByHash,
  findDiagramBySource,
  freshBlockId,
  liveBlockLists,
} from "./blocks.js";
export { renderUntrustedMarkdown } from "./untrusted.js";
export type { BlockSnapshot } from "./blocks.js";
