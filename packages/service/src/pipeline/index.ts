/**
 * M3 pipeline surface: the reusable seam for the next agents.
 *
 * - `Pipeline` — reader → base → critic/concepts → hunk pass, plus
 *   `runInFork` / `runSmall` (generic fork jobs), `ensureConceptPage`,
 *   `summarizeHunk`, `fillGoDeeper`, `startReview` / `resumeReview`, and
 *   `updateRunner` (UpdateBaseRunner for the versions module).
 * - Demo ingest — repo-less fixture review running the same code path.
 * - Actions dispatcher — `generate` implemented, the rest 501 stubs.
 */
export { Pipeline, type PipelineOptions } from "./runner.js";
export type { RunInForkOptions, RunInForkResult, RunSmallOptions, RunSmallResult } from "./types.js";
export { ingestDemo, isDemoRequest, demoFixtureName, fixturesDirDefault } from "./demo.js";
export { dispatchAction, type ActionDeps } from "./actions/dispatcher.js";
export { generateAction } from "./actions/generate.js";
