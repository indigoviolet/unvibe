/**
 * JSON diagram rendering (replaces Mermaid).
 *
 * Static SVG through the prototype's own classes: exact style match,
 * automatic light/dark, strict-CSP clean, no lazy chunks. A render
 * failure falls back to the readable source in a code block.
 */
import type { DiagramSpec } from "@unvibe/shared";
import { DiagramSvg } from "./DiagramSvg.js";

interface Props {
  spec: DiagramSpec;
  caption?: string;
  unverified?: string[];
}

export function DiagramView({ spec, caption, unverified }: Props) {
  return (
    <>
      <div className="dg">
        <DiagramSvg spec={spec} unverified={unverified} />
      </div>
      {caption ? <p className="dg-cap" dangerouslySetInnerHTML={{ __html: caption }} /> : null}
    </>
  );
}
