/**
 * D2 diagram rendering (web-guide owner; D2 decision addendum).
 *
 * Every diagram block renders through `D2Diagram`: the service runs the
 * `d2` binary and caches light + dark SVGs, the web app inlines the one
 * matching the current theme. Mermaid is gone (no compatibility path).
 */
import type { DiagramBlock } from "@unvibe/shared";
import { D2Diagram } from "./D2Diagram.js";

interface Props {
  reviewId: string;
  block: DiagramBlock;
}

export function DiagramView({ reviewId, block }: Props) {
  return (
    <>
      <div className="dg dg-d2">
        <D2Diagram reviewId={reviewId} block={block} />
      </div>
      {block.caption ? <p className="dg-cap">{block.caption}</p> : null}
    </>
  );
}
