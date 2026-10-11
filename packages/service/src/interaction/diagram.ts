/**
 * Diagram validation (replaces Mermaid; PRD §13/§19.4).
 *
 * Diagrams are fenced `diagram` blocks holding the JSON spec. Before
 * storing one we check it validates (structure + `cite` grammar); on
 * failure the caller asks the agent for one repair turn instead of
 * storing a broken diagram.
 */
import { validateDiagram, type DiagramSpec } from "@unvibe/shared";

/** True when `spec` is a structurally valid diagram. */
export function isValidDiagram(spec: unknown): boolean {
  return validateDiagram(spec).ok;
}

/** One-line reason used in the repair prompt. */
export function diagramProblem(spec: unknown): string {
  const v = validateDiagram(spec);
  if (v.ok) return "the diagram is valid";
  return v.errors[0] ?? "invalid diagram";
}

/** All validator messages for a spec (repair prompt body). */
export function diagramProblems(spec: unknown): string[] {
  return validateDiagram(spec).errors;
}

export type { DiagramSpec };
