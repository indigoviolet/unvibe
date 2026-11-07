/**
 * Interaction pure logic (M4).
 *
 * The `actions` route and `pipeline/actions/*` handlers call into these
 * helpers; everything here is pure over snapshots/drafts. The interaction
 * hook lives in `sharedctx/hooks.ts` (single home for `recordInteraction`);
 * the canonical names are re-exported here so action modules have one
 * import site.
 */
export {
  recordInteraction,
  setInteractionHandler,
  getInteractionHandler,
  type InteractionEvent,
  type InteractionEventKind,
  type InteractionHandler,
} from "../sharedctx/hooks.js";
export {
  findCardTarget,
  findCardTargetInDraft,
  conversationForAnswer,
  mirrorPromotedAnswer,
  targetLevel,
  targetBlocks,
  targetRevision,
  pushUndo,
  setTargetContent,
  applyUndo,
  stepLevel,
  hasLevelText,
  paragraphIds,
  existingExampleKeys,
  insertExamples,
  hasDiagram,
  insertDiagrams,
  hasPrinciple,
  mergeDepthText,
  markStaleAnchors,
  withFreshAsideId,
  type CardTarget,
} from "./cards.js";
export {
  findBlock,
  findAnswer,
  findComment,
  commentPlainText,
  commentHostText,
  hostBlockText,
  blockPlainText,
  cardTextFor,
  nearbyAnnotationsText,
  replyTextFor,
  threadTextFor,
  turnsTextFor,
  itemIdForAnchor,
  replyRefForId,
  offsetsTextFor,
  changedHunksForTurn,
  l4Variables,
  cardPromptText,
  excerptQuote,
  quoteForPrompt,
} from "./l4.js";

