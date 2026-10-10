/**
 * Interaction pure logic (M4).
 *
 * The `actions` route and `pipeline/actions/*` handlers call into these
 * helpers; everything here is pure over snapshots/drafts except the
 * recorder hook (`types.ts`), which the shared-context agent owns.
 */
export {
  recordInteraction,
  setInteractionRecorder,
  noopRecorder,
  type InteractionEvent,
  type InteractionRecorder,
} from "./types.js";
export {
  findCardTarget,
  findCardTargetInDraft,
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
  type CardTarget,
} from "./cards.js";
export {
  findBlock,
  hostBlockText,
  cardTextFor,
  nearbyAnnotationsText,
  threadTextFor,
  changeListTextFor,
  l4Variables,
  cardPromptText,
} from "./l4.js";
export { isValidMermaid, mermaidProblem } from "./mermaid.js";
