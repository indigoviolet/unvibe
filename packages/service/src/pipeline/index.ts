/**
 * M3 pipeline surface: the reusable seam for the next agents.
 *
 * - `Pipeline` — reader → base → critic/concepts → hunk pass, plus
 *   `runInFork` / `runSmall` (generic fork jobs), `ensureConceptPage`,
 *   `summarizeHunk`, `fillGoDeeper`, `startReview` / `resumeReview`, and
 *   `updateRunner` (UpdateBaseRunner for the versions module).
 * - Demo ingest — repo-less fixture review running the same code path.
 * - Actions dispatcher — all interaction kinds plus second_opinion.
 */
export { Pipeline, type PipelineOptions } from "./runner.js";
export type { RunInForkOptions, RunInForkResult, RunSmallOptions, RunSmallResult } from "./types.js";
export { ingestDemo, isDemoRequest, demoFixtureName, fixturesDirDefault } from "./demo.js";
export { dispatchAction, type ActionDeps } from "./actions/dispatcher.js";
export { generateAction } from "./actions/generate.js";
export { askAction, explainAction, replyAction, retryAction } from "./actions/conversation.js";
export { noteAction } from "./actions/note.js";
export { depthAction } from "./actions/depth.js";
export { examplesAction } from "./actions/examples.js";
export { diagramAction } from "./actions/diagram.js";
export { undoAction } from "./actions/undo.js";
export { collapseAction } from "./actions/read.js";
export { closeAction, deleteAction } from "./actions/close.js";
export { promoteAction } from "./actions/promote.js";
export { followupAction } from "./actions/followup.js";
export { conceptAction } from "./actions/concept.js";
export { removeSecondOpinionAction, secondOpinionAction } from "./actions/second_opinion.js";
