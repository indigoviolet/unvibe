/**
 * Tooltip (`#tip`): shows any element's `data-tip` text after a short pause.
 *
 * PRD §4.5 dismissal rules, ported from `prototype.html`:
 * - opens after ~0.2 s of hovering;
 * - closes on any scroll anywhere, an outside press, Escape, the window
 *   losing focus (blur), pointer leaving the document, and on resize;
 * - after a scroll, hover is ignored until the pointer really moves (content
 *   sliding under a stationary cursor must not re-open the card).
 */
import { useEffect, useRef } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

const OPEN_DELAY_MS = 180;

export function Tooltip(): React.JSX.Element {
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    let anchor: Element | null = null;
    let openTimer: number | undefined;
    let scrollQuiet = false;

    const hide = (): void => {
      window.clearTimeout(openTimer);
      openTimer = undefined;
      anchor = null;
      tip.hidden = true;
    };

    const show = (): void => {
      if (!anchor || !anchor.isConnected) return;
      const anchorEl = anchor;
      tip.textContent = (anchorEl as HTMLElement).dataset.tip ?? "";
      tip.hidden = false;
      // Floating UI (#201): offset + flip + shift, so the tip never leaves
      // the viewport. Card toolbar tips also avoid the card header: if the
      // flipped/shifted top placement would overlap the header, place below.
      void (async () => {
        const middleware = [offset(6), flip({ padding: 4 }), shift({ padding: 4 })];
        let pos = await computePosition(anchorEl, tip, { placement: "top", middleware });
        if (anchorEl.isConnected && !tip.hidden) {
          const header = anchorEl.closest(".ui-card")?.querySelector(":scope > .exp-h");
          if (header && pos.placement === "top") {
            const h = header.getBoundingClientRect();
            const overlaps = pos.y < h.bottom && pos.y + tip.offsetHeight > h.top && pos.x < h.right && pos.x + tip.offsetWidth > h.left;
            if (overlaps) pos = await computePosition(anchorEl, tip, { placement: "bottom", middleware });
          }
        }
        if (!anchorEl.isConnected || tip.hidden) return;
        tip.style.left = `${pos.x}px`;
        tip.style.top = `${pos.y}px`;
      })();
    };

    const onMouseOver = (e: MouseEvent): void => {
      if (scrollQuiet) return;
      const el = e.target as Element | null;
      const t = el?.closest?.("[data-tip]");
      if (t && !el?.closest?.("#pop")) {
        if (t !== anchor) {
          window.clearTimeout(openTimer);
          anchor = t;
          openTimer = window.setTimeout(show, OPEN_DELAY_MS);
        }
      } else {
        hide();
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      // `?? 0`: movement may be undefined on synthetic events; only a real
      // move clears the post-scroll quiet period.
      if ((e.movementX ?? 0) !== 0 || (e.movementY ?? 0) !== 0) scrollQuiet = false;
    };

    const onScroll = (e: Event): void => {
      if ((e.target as Element | null)?.closest?.("#pop")) return;
      scrollQuiet = true;
      hide();
    };

    const onPointerDown = (): void => {
      tip.hidden = true;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") hide();
    };

    const onMouseLeave = (): void => {
      hide();
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(openTimer);
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  return <div id="tip" ref={tipRef} hidden />;
}
