/**
 * D2 diagram rendering (web-guide owner; D2 decision addendum).
 *
 * Every diagram block renders through `D2Diagram`: the service runs the
 * `d2` binary and caches light + dark SVGs, the web app inlines the one
 * matching the current theme. Mermaid is gone (no compatibility path).
 *
 * Issue #47: each diagram carries an Expand control opening a
 * full-window overlay (`DiagramOverlay`) with wheel/pinch zoom, drag pan
 * and reset — the escape hatch for diagrams too wide to read inline.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import type { DiagramBlock } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { D2Diagram, type FetchDiagramSvg } from "./D2Diagram.js";
import { DiagramOverlay } from "./DiagramOverlay.js";
import { RichText } from "./RichText.js";

interface Props {
  reviewId: string;
  block: DiagramBlock;
  /** Open a guide page in-app. */
  onOpenPage: (pageId: string) => void;
  /** Override the SVG fetch (unit tests); defaults to the API client. */
  fetchSvg?: FetchDiagramSvg;
}

export function DiagramView({ reviewId, block, onOpenPage, fetchSvg }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="dg dg-d2">
        <D2Diagram reviewId={reviewId} block={block} fetchSvg={fetchSvg} />
        <div className="dg-bar">
          <button
            type="button"
            className="tbtn dg-expand"
            aria-label="Expand diagram"
            aria-haspopup="dialog"
            onClick={() => setExpanded(true)}
          >
            <Icon name="open" /> Expand
          </button>
        </div>
      </div>
      {expanded
        ? createPortal(
            <DiagramOverlay
              reviewId={reviewId}
              block={block}
              fetchSvg={fetchSvg}
              onClose={() => setExpanded(false)}
            />,
            document.body,
          )
        : null}
      {block.caption ? (
        <p className="dg-cap">
          <RichText html={block.caption} className="rt" onOpenPage={onOpenPage} />
        </p>
      ) : null}
    </>
  );
}
