// File extension -> language id used by every candidate.
const EXT = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
};
export function languageOf(path) {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return (m && EXT[m[1].toLowerCase()]) || null;
}
/** 1-based inclusive line range helpers. */
export function splitLines(text) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
