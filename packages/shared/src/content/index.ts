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
  collectTargets,
  parseBlocks,
  parseCards,
  parseCardsPartial,
  parsePartial,
  parseReply,
  renderInline,
  renderMarkdown,
  splitCardSections,
} from "./parse.js";
export type { CollectedTargets, ParsedReply, RenderedInline } from "./parse.js";
export {
  D2_MIN_VERSION,
  D2_RENDER_OPTIONS,
  D2_VERSION_UNKNOWN,
  DIAGRAM_HASH_LEN,
  canonicalizeD2Source,
  diagramHash,
  extractD2Links,
} from "./d2.js";
