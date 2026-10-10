/**
 * Recorded sessions (PRD §18): a replay `AgentRunner` over the
 * `fixtures/urllib3-5020/` recordings, plus the snapshot builder that turns
 * those recordings into a validated `ReviewSnapshot`.
 */
export { ReplayAgentRunner, chunkText, usageFor } from "./runner.js";
export type { ManifestEntry, ReplayOptions, ResolvedRecording } from "./runner.js";
export { buildSnapshot, defaultFixturesDir, hunkContentHash } from "./snapshot.js";
export type { BuildFailure, BuiltSnapshot, FixtureMeta } from "./snapshot.js";
