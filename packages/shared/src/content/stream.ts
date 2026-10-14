/**
 * Paragraph-by-paragraph streaming (issue #126, experiment).
 *
 * Pure splitter: carve a growing agent reply into completed paragraphs
 * without ever emitting a half sentence. The UI shows the completed
 * prefix while the turn fills; the stored turn replaces it when the turn
 * ends and validation has run.
 *
 * Rules:
 * - Cut only at blank lines, and never inside a fenced block (```) or a
 *   `:::` directive block: an unclosed fence/directive holds everything
 *   from its opener in `rest`. A fence/directive chunk completes when its
 *   closing line arrives.
 * - A fence or directive opener after prose without a blank line still
 *   starts a unit (mirroring parseBlocks): the prose before it is
 *   complete.
 * - The trailing chunk (no blank line or closing fence after it yet) is
 *   always `rest` — never shown half-written.
 * - A ```json (or jsonc) fence opens the reply's trailing structured
 *   block: everything from its opener stays in `rest` to the end of the
 *   stream, so provisional content never shows raw trailer JSON. (A
 *   genuine mid-answer json example is likewise held back; the finished
 *   answer renders it normally.)
 *
 * Deterministic and monotone: appending to the buffer only moves text
 * from `rest` to `completed`, never the reverse, so parsed block ids for
 * the completed prefix stay stable across stream updates.
 */
export interface StreamSplit {
  /** Completed chunks, in order (each parseable on its own). */
  completed: string[];
  /** Incomplete tail: held back, never shown. */
  rest: string;
}

const FENCE_OPEN = /^```\s*([A-Za-z0-9_-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const DIRECTIVE_OPEN = /^:::\s*(\S.*)?$/;
const DIRECTIVE_CLOSE = /^:::\s*$/;

function isJsonFence(info: string): boolean {
  const lang = info.toLowerCase();
  return lang === "json" || lang === "jsonc";
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

export function splitStreamText(buffer: string): StreamSplit {
  const lines = buffer.split("\n");
  const completed: string[] = [];
  let chunk: string[] = [];
  let fence = false;
  let directive = false;
  /** First line index not yet completed (everything from here is rest). */
  let restStart = 0;

  const emit = (endExclusive: number): void => {
    const text = chunk.join("\n").replace(/^\s+|\s+$/g, "");
    if (text) completed.push(text);
    chunk = [];
    restStart = endExclusive;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (fence) {
      chunk.push(line);
      i++;
      if (FENCE_CLOSE.test(line)) {
        fence = false;
        emit(i);
      }
      continue;
    }
    if (directive) {
      chunk.push(line);
      i++;
      if (DIRECTIVE_CLOSE.test(line)) {
        directive = false;
        emit(i);
      }
      continue;
    }
    const fenceOpen = line.match(FENCE_OPEN);
    if (fenceOpen) {
      const info = fenceOpen[1] ?? "";
      if (isJsonFence(info)) {
        // Trailing structured block: hold from here to end of stream.
        emit(i);
        restStart = i;
        break;
      }
      emit(i);
      fence = true;
      chunk.push(line);
      i++;
      continue;
    }
    if (DIRECTIVE_OPEN.test(line)) {
      emit(i);
      directive = true;
      chunk.push(line);
      i++;
      continue;
    }
    if (isBlank(line)) {
      emit(i + 1);
      i++;
      continue;
    }
    chunk.push(line);
    i++;
  }
  return { completed, rest: lines.slice(restStart).join("\n") };
}
