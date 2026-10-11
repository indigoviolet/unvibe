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
  DIAGRAM_LIMITS,
  diagramCites,
  diagramProblem,
  validateDiagram,
} from "./diagram-spec.js";
export type {
  DiagramDirection,
  DiagramFlowEdge,
  DiagramFlowNode,
  DiagramKind,
  DiagramMessage,
  DiagramPanel,
  DiagramSpec,
  DiagramState,
  DiagramValidation,
} from "./diagram-spec.js";
export { renderDiagramSvg } from "./diagram-render.js";
