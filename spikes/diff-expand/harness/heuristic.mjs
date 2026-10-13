// Candidate 4: indentation + bracket heuristic. No dependency, no language knowledge
// beyond a keyword list. Returns the chain of enclosing units, innermost first.
const DEF_KEYWORD =
  /^(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+|async\s+|override\s+|unsafe\s+|extern\s+|pub(?:\([^)]*\))?\s+|const\s+|open\s+|sealed\s+|data\s+|inline\s+|virtual\s+|declare\s+|readonly\s+)*(function\*?|def|class|func|fn|impl|trait|struct|enum|interface|module|namespace|type|sub|proc|fun|object|protocol|extension|record|macro_rules!)\b/;
const CONTROL = /^(?:if|else|for|while|switch|case|catch|try|do|return|with|unless|until|begin|when|elif|except|finally|match|loop|select|defer|go|throw|new|await|yield)\b/;
const BOUND_FN = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>|<)/;
const C_LIKE_METHOD = /^[\w$<>\[\],.?*&:\s@]+\([^;]*$/; // `name(args) {` or a signature that continues
const CLOSER = /^(?:[)\]}]|end\b)/;
const LEAD = /^(?:@|#\[|#!\[|\/\/|\/\*|\*|#(?!\s*(?:include|define|if|endif|pragma)))/;

function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

function looksLikeUnit(text) {
  const t = text.trim();
  if (CONTROL.test(t)) return false;
  if (DEF_KEYWORD.test(t)) return true;
  if (BOUND_FN.test(t)) return true;
  // Go/Rust/Java/C style: `name(...) {` / `Type name(...) {`, also multi-line signatures.
  if (/[{(,]$/.test(t) && C_LIKE_METHOD.test(t) && !/^[\w$.]+\(/.test(t.replace(/^(?:[\w$<>\[\],.?*&]+\s+)+/, "x ")) === false) {
    return /^(?:[\w$<>\[\],.?*&]+\s+)+[\w$]+\s*\(/.test(t) || /^[\w$]+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{$/.test(t);
  }
  return false;
}

/** End line (1-based) of the block opened by the header at 1-based line h. */
function blockEnd(lines, h, indents) {
  const base = indents[h - 1];
  let last = h;
  for (let i = h + 1; i <= lines.length; i++) {
    const text = lines[i - 1];
    if (text.trim() === "") continue;
    const ind = indents[i - 1];
    if (ind > base) { last = i; continue; }
    const t = text.trim();
    // A closer at the header's own indent ends the block; a continuation of the
    // signature (`) -> X:`, `) {`) does not.
    if (ind === base && CLOSER.test(t)) {
      if (/[:{(,]$/.test(t) || /=>\s*\{?$/.test(t)) { last = i; continue; }
      return i;
    }
    return last;
  }
  return last;
}

function leadStart(lines, h, indents) {
  let s = h;
  while (s > 1) {
    const text = lines[s - 2];
    if (text.trim() === "" || indents[s - 2] !== indents[h - 1]) break;
    if (!LEAD.test(text.trim())) break;
    s--;
  }
  return s;
}

export function heuristicChain(source, a, b) {
  const lines = source.split("\n");
  const indents = lines.map(indentOf);
  const chain = [];
  // Smallest indent in the range: headers must be at or below it.
  let limit = Infinity;
  for (let i = a; i <= b && i <= lines.length; i++) {
    if (lines[i - 1].trim() !== "") limit = Math.min(limit, indents[i - 1]);
  }
  if (limit === Infinity) limit = 1e9;
  // A header inside the range at the range's own indent can still be the unit
  // (the signature line itself changed), so the first pass allows `<=`.
  let allowEqual = true;
  for (let i = a; i >= 1; i--) {
    const text = lines[i - 1];
    if (text.trim() === "") continue;
    const ind = indents[i - 1];
    const ok = allowEqual ? ind <= limit : ind < limit;
    if (!ok) continue;
    if (i < a) allowEqual = false;
    if (CLOSER.test(text.trim())) {
      // `) -> X:` / `) {` closes a multi-line signature: the header is the opener above it.
      if (/[:{]$/.test(text.trim()) || /=>\s*\{?$/.test(text.trim())) {
        let j = i - 1;
        while (j >= 1 && (lines[j - 1].trim() === "" || indents[j - 1] > ind)) j--;
        if (j >= 1 && indents[j - 1] === ind && !CLOSER.test(lines[j - 1].trim())) { i = j + 1; limit = Math.max(limit, ind + 1); allowEqual = false; continue; }
      }
      if (ind < limit) limit = ind;
      continue;
    }
    if (!looksLikeUnit(text)) { if (ind < limit) limit = ind; continue; }
    const end = blockEnd(lines, i, indents);
    if (end < b) { if (ind < limit) limit = ind; continue; }
    if (end === i && a !== i) { if (ind < limit) limit = ind; continue; }
    chain.push({ start: leadStart(lines, i, indents), end, kind: "block", name: text.trim().slice(0, 60) });
    limit = ind;
    allowEqual = false;
    if (ind === 0) break;
  }
  return chain;
}
