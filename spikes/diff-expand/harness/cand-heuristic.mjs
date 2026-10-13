// Candidate 4: indentation + keyword heuristic, any language.
import { heuristicChain } from "./heuristic.mjs";
export const name = "indent heuristic";
export async function init() {}
export async function chain(_lang, _path, source, a, b) { return heuristicChain(source, a, b); }
