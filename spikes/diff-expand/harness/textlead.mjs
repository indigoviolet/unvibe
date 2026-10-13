// Leading doc comments / attributes / decorators directly above a start line, found by
// text only. Used by the candidates that have no syntax tree to ask.
const LEAD = /^\s*(?:@|#\[|\/\/|\/\*|\*|#(?!\s*(?:include|define|if|endif|pragma)\b))/;
export function leadStartByText(lines, start) {
  let s = start;
  while (s > 1 && lines[s - 2].trim() !== "" && LEAD.test(lines[s - 2])) s--;
  return s;
}
export const isLeadOrBlank = (line) => line.trim() === "" || LEAD.test(line) || /^\s*(?:export\b|"""|''')/.test(line);
