/**
 * JSON diagram renderer (replaces Mermaid).
 *
 * Pure SVG from `renderDiagramSvg` (shared, no DOM): prototype classes
 * only, no inline styles, light/dark from CSS variables. Cited
 * nodes/edges/panels carry `data-refs`/`data-src` so the standard hover
 * preview (0.2 s, same dismissal) and click-to-reveal apply; the component
 * only wires click/keyboard to `revealSource` (the hover popover listens
 * globally for `[data-refs]`).
 */
import { useId, useMemo } from "react";
import type { DiagramSpec } from "@unvibe/shared";
import { renderDiagramSvg } from "@unvibe/shared";
import { revealSource } from "../source/reveal.js";

interface Props {
  spec: DiagramSpec;
  /** Cite targets the validator could not check (dimmed badges). */
  unverified?: string[];
}

export function DiagramSvg({ spec, unverified }: Props) {
  const rawId = useId();
  const mid = useMemo(() => `dg${rawId.replace(/[^a-zA-Z0-9]/g, "")}`, [rawId]);
  const uv = useMemo(() => (unverified?.length ? new Set(unverified) : undefined), [unverified]);
  let svg: string;
  try {
    svg = renderDiagramSvg(spec, mid, uv);
  } catch {
    return (
      <div>
        <pre className="code">{JSON.stringify(spec, null, 2)}</pre>
        <p className="hint">This diagram could not be rendered, so its source is shown.</p>
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={spec.title}
      dangerouslySetInnerHTML={{ __html: svg }}
      onClick={(e) => {
        const el = (e.target as Element | null)?.closest?.("[data-src]");
        if (el) revealSource(el.getAttribute("data-src") ?? "");
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = (e.target as Element | null)?.closest?.("[data-src]");
        if (el) {
          e.preventDefault();
          revealSource(el.getAttribute("data-src") ?? "");
        }
      }}
    />
  );
}
