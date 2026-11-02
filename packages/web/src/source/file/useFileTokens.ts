/**
 * Syntax tokens for the file tab (#317): the diff's Shiki highlighter
 * (`highlightLines`, same grammar/theme as diff rows), applied in
 * windows so a large file never blocks the UI — the window holding the
 * cited range tokenises first, the rest follow chunk by chunk, each
 * awaited so the browser paints between chunks. Plain first paint;
 * only colours change when tokens land, so there is no layout shift.
 * Unknown languages and `?nohl=1` stay plain.
 */
import { useEffect, useRef, useState } from "react";
import { detectLanguage, highlightDisabled, highlightLines } from "../diff/highlight/shiki.js";
import type { LineTokens } from "../diff/highlight/tokenize.js";
import { planHighlightWindows, type HighlightWindow } from "./highlightWindow.js";

function isFileSelectionActive(): boolean {
  try {
    const sel = typeof document !== "undefined" && document.getSelection ? document.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    const anchor = sel.anchorNode;
    if (!anchor) return false;
    const el = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    return !!el?.closest?.(".codefile");
  } catch {
    return false;
  }
}

function waitForFileSelectionClear(isCancelled: () => boolean, waitMs = 1500): Promise<void> {
  if (!isFileSelectionActive()) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (isCancelled() || !isFileSelectionActive() || Date.now() - started >= waitMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 120);
    };
    window.setTimeout(tick, 120);
  });
}

export function useFileTokens(
  path: string,
  lines: string[] | null,
  focusStart: number,
  focusEnd: number,
): ReadonlyMap<number, LineTokens | null> {
  const [tokens, setTokens] = useState<ReadonlyMap<number, LineTokens | null>>(() => new Map());
  const doneStarts = useRef<Set<number>>(new Set());
  const forPath = useRef(path);

  useEffect(() => {
    if (forPath.current !== path) {
      forPath.current = path;
      doneStarts.current = new Set();
      setTokens(new Map());
    }
    if (!lines || lines.length === 0) return;
    if (highlightDisabled() || detectLanguage(path) === null) return;
    let cancelled = false;
    const windows = planHighlightWindows(lines.length, focusStart, focusEnd);
    void (async () => {
      for (const w of windows) {
        if (cancelled) return;
        if (doneStarts.current.has(w.start)) continue;
        const out = await highlightWindow(path, lines, w, () => cancelled);
        if (cancelled || !out) continue;
        await waitForFileSelectionClear(() => cancelled);
        if (cancelled) return;
        doneStarts.current.add(w.start);
        setTokens((prev) => {
          const next = new Map(prev);
          out.forEach((row, i) => next.set(w.start + i, row));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, lines, focusStart, focusEnd]);

  return tokens;
}

/** One window's tokens; over-cap windows split in half down to 25 lines. */
async function highlightWindow(
  path: string,
  lines: string[],
  w: HighlightWindow,
  isCancelled: () => boolean,
): Promise<(LineTokens | null)[] | null> {
  const texts = lines.slice(w.start - 1, w.end);
  const out = await highlightLines(path, texts);
  if (out || isCancelled()) return out;
  if (w.end - w.start + 1 <= 25) return null;
  const mid = w.start + Math.floor((w.end - w.start) / 2);
  const left = await highlightWindow(path, lines, { start: w.start, end: mid }, isCancelled);
  if (isCancelled()) return null;
  const right = await highlightWindow(path, lines, { start: mid + 1, end: w.end }, isCancelled);
  if (!left && !right) return null;
  return [...(left ?? texts.slice(0, mid - w.start + 1).map(() => null)), ...(right ?? texts.slice(mid - w.start + 1).map(() => null))];
}
