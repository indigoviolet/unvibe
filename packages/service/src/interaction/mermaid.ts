/**
 * Mermaid validation (M4, PRD §13/§19.4).
 *
 * Diagrams are fenced `mermaid` blocks. Before storing one we check it
 * parses (structurally: known diagram header, balanced brackets/quotes);
 * on failure the caller asks the agent for one repair turn instead of
 * storing a broken diagram.
 */

const HEADER_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline)\b/;

const PAIRS: Record<string, string> = {
  "[": "]",
  "{": "}",
  "(": ")",
};

/**
 * True when `source` looks like a parseable Mermaid diagram. This is a
 * structural check, not a full grammar: it catches empty sources,
 * unknown headers, unbalanced brackets and unterminated strings — the
 * failure modes a repair turn can fix.
 */
export function isValidMermaid(source: string): boolean {
  if (!source || !source.trim()) return false;
  const lines = source.split("\n");
  if (!HEADER_RE.test(lines[0])) return false;
  const stack: string[] = [];
  let inString: string | null = null;
  let escaped = false;
  for (const ch of source) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "[" || ch === "{" || ch === "(") stack.push(ch);
    else if (ch === "]" || ch === "}" || ch === ")") {
      const open = stack.pop();
      if (!open || PAIRS[open] !== ch) return false;
    }
  }
  return inString === null && stack.length === 0;
}

/** One-line reason used in the repair prompt. */
export function mermaidProblem(source: string): string {
  if (!source || !source.trim()) return "the diagram source is empty";
  const first = source.split("\n")[0];
  if (!HEADER_RE.test(first)) {
    return `the first line must declare a diagram type (e.g. \`flowchart LR\`), got: ${first.slice(0, 80)}`;
  }
  return "the diagram has unbalanced brackets or an unterminated string";
}
