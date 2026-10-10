/**
 * Mermaid diagram rendering (M2, web-guide owner).
 *
 * The `mermaid` package loads lazily so the guide stays fast when no card
 * shows a diagram. Light/dark follows the page theme; a parse failure (or
 * load failure) falls back to the readable source in a code block.
 */
import { Suspense, lazy, useId } from "react";

const MermaidSvg = lazy(() => import("./MermaidSvg.js"));

interface Props {
  source: string;
  caption?: string;
}

export function DiagramView({ source, caption }: Props) {
  const fallbackId = useId();
  return (
    <>
      <div className="dg">
        <Suspense
          fallback={
            <div className="working" role="status">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Rendering diagram…</span>
            </div>
          }
        >
          <MermaidSvg source={source} fallbackId={fallbackId} />
        </Suspense>
      </div>
      {caption ? <p className="dg-cap">{caption}</p> : null}
    </>
  );
}
