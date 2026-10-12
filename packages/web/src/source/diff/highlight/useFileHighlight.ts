/**
 * `useFileHighlight` (issue #23).
 *
 * Progressive enhancement for diff code: rows render plain text on first
 * paint (unchanged time-to-first-paint); when the file body becomes visible
 * (the existing per-file lazy gate) and token rows are ready, the component
 * re-renders with highlighted spans. Colours alone change, so there is no
 * layout shift and no scroll jump.
 *
 * Tokens are cached by `lang:contentHash` in `shiki.ts`, so WebSocket
 * patches that re-render rows never recompute.
 *
 * A token upgrade swaps a cell's text nodes for spans, which collapses a
 * text selection anchored inside them — so each hunk's upgrade waits for
 * an active diff selection to clear first (bounded; see
 * `selectionGuard.ts`).
 */

import { useEffect, useState } from "react";
import type { Hunk } from "@unvibe/shared";
import { cachedHunk, detectLanguage, highlightDisabled, highlightHunk, highlightVersion } from "./shiki.js";
import { waitForSelectionClear } from "./selectionGuard.js";
import type { LineTokens } from "./tokenize.js";

export interface FileTokens {
  /** Per-hunk token rows, keyed by content hash. */
  byHash: Map<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] }>;
  /** Bumps as hunk tokens land (drives anchor re-marking). */
  version: number;
  /** False when the file's language is unknown (plain by design). */
  supported: boolean;
}

export function useFileHighlight(path: string, hunks: Hunk[], active: boolean): FileTokens {
  const lang = detectLanguage(path);
  const supported = lang !== null && !highlightDisabled();
  const [byHash, setByHash] = useState<
    Map<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] }>
  >(() => new Map());
  const [version, setVersion] = useState(() => highlightVersion());

  useEffect(() => {
    if (!active || !supported || hunks.length === 0) return;
    let cancelled = false;
    // Seed synchronously from cache (no flash for revisited files).
    setByHash((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const h of hunks) {
        if (!next.has(h.contentHash)) {
          const c = cachedHunk(h.contentHash, path);
          if (c) {
            next.set(h.contentHash, c);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
    void (async () => {
      for (const h of hunks) {
        if (cancelled) return;
        // The module cache is the dedupe: skip hunks already done (or
        // failed → null) by this or any earlier render.
        if (cachedHunk(h.contentHash, path) !== undefined) continue;
        const out = await highlightHunk(h, path);
        if (cancelled) return;
        // Don't collapse the user's live diff selection: wait for it to
        // clear (bounded) before swapping this hunk's text nodes.
        await waitForSelectionClear(undefined, () => cancelled);
        if (cancelled) return;
        if (out) {
          setByHash((prev) => {
            if (prev.has(h.contentHash)) return prev;
            const nextMap = new Map(prev);
            nextMap.set(h.contentHash, out);
            return nextMap;
          });
        }
        setVersion(highlightVersion());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, supported, path, hunks]);

  return { byHash, version, supported };
}
