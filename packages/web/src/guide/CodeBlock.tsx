/**
 * Highlighted code block (issue #255).
 *
 * Renders `CodeBlock.code` as an opaque HTML string — the same rule as
 * every highlight pass (issue #101): the `<pre>` carries no React
 * children, so anchor marks may wrap, split and merge its text nodes
 * freely and React only ever swaps the whole string.
 *
 * - First paint is plain escaped text (no layout shift later: only span
 *   colours change, and plain runs stay spanless so copy-paste carries
 *   no artefacts).
 * - When the fence language's grammar loads, the highlighted HTML swaps
 *   in. Unknown or missing languages stay plain.
 * - The swap waits for an active code selection to clear (bounded), so a
 *   select-then-comment gesture is never collapsed mid-drag.
 * - The highlighted DOM keeps the same text content (one span per token
 *   run, lines joined with `\n`), so text offsets for anchoring are
 *   unchanged.
 */
import { useEffect, useState } from "react";
import { escapeHtml } from "../components/escapeHtml.js";
import { codeLineHtml } from "../source/diff/highlight/codeHtml.js";
import {
  cachedCodeBlock,
  highlightCodeBlock,
  highlightDisabled,
  normalizeCodeLanguage,
} from "../source/diff/highlight/shiki.js";
import type { LineTokens } from "../source/diff/highlight/tokenize.js";
import "../source/diff/highlight/highlight.css";

function blockHtml(code: string, rows: (LineTokens | null)[]): string {
  const lines = code.split("\n");
  return lines.map((line, i) => codeLineHtml(line, rows[i] ?? null)).join("\n");
}

/** True when a live non-collapsed selection sits inside guide/document code. */
function isCodeSelectionActive(): boolean {
  try {
    const sel = typeof document !== "undefined" && document.getSelection ? document.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    const anchor = sel.anchorNode;
    if (!anchor) return false;
    const el = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    return !!el?.closest?.("pre.code");
  } catch {
    return false;
  }
}

/** Resolve once no code selection is active, the wait times out, or cancelled. */
function waitForCodeSelectionClear(isCancelled?: () => boolean, waitMs = 1500): Promise<void> {
  if (!isCodeSelectionActive()) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (isCancelled?.() === true || !isCodeSelectionActive() || Date.now() - started >= waitMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 120);
    };
    window.setTimeout(tick, 120);
  });
}

export function HighlightedCode({ language, code, top }: { language?: string; code: string; top: string }) {
  // Plain first paint; `?nohl=1` stays plain (the diff escape hatch).
  const [html, setHtml] = useState<string>(() => escapeHtml(code));

  useEffect(() => {
    if (highlightDisabled() || normalizeCodeLanguage(language) === null) {
      setHtml(escapeHtml(code));
      return;
    }
    const cached = cachedCodeBlock(language, code);
    if (cached) {
      setHtml(blockHtml(code, cached));
      return;
    }
    if (cached === null) {
      setHtml(escapeHtml(code));
      return;
    }
    setHtml(escapeHtml(code));
    let cancelled = false;
    void (async () => {
      const out = await highlightCodeBlock(language, code);
      if (cancelled || !out) return;
      await waitForCodeSelectionClear(() => cancelled);
      if (cancelled) return;
      setHtml(blockHtml(code, out));
    })();
    return () => {
      cancelled = true;
    };
  }, [language, code]);

  return <pre className="code sel" data-top={top} dangerouslySetInnerHTML={{ __html: html }} />;
}
