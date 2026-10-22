/**
 * Diagram zoom controls (issues #47, #16 round two).
 *
 * One control set shared by the expanded overlay and the inline in-place
 * zoom: zoom out, live zoom percentage, zoom in, reset to fit. Same
 * names in both places ("Zoom in", "Zoom out", "Reset").
 */
import { Button } from "../ui/index.js";

export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  /** Current scale (1 = fit/natural). */
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}): React.JSX.Element {
  const percent = Math.round(scale * 100);
  return (
    <>
      <button type="button" className="ib" aria-label="Zoom out" onClick={onZoomOut}>
        <span aria-hidden="true">−</span>
      </button>
      <span className="dg-zoom" aria-live="polite" aria-label={`Zoom ${percent} percent`}>
        {percent}%
      </span>
      <button type="button" className="ib" aria-label="Zoom in" onClick={onZoomIn}>
        <span aria-hidden="true">+</span>
      </button>
      <Button variant="secondary" size="sm" type="button" aria-label="Reset view" onClick={onReset}>
        Reset
      </Button>
    </>
  );
}
