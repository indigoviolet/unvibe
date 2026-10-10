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
      tip.textContent = (anchor as HTMLElement).dataset.tip ?? "";
      tip.hidden = false;
      const r = anchor.getBoundingClientRect();
      let top = r.top - tip.offsetHeight - 6;
      if (top < 4) top = r.bottom + 6;
      tip.style.left = `${Math.max(4, Math.min(window.innerWidth - tip.offsetWidth - 4, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
      tip.style.top = `${top}px`;
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
