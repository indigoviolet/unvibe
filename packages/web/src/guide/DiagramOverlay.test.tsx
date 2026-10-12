/**
 * Expanded diagram overlay tests (issue #47):
 * - Expand opens a dialog and moves focus into it; Esc and the close
 *   control shut it and focus returns to the Expand control;
 * - +/− buttons, wheel zoom and reset change the CSS transform;
 * - citation click still reveals; a drag suppresses the click;
 * - zoomAround math clamps to the overlay limits.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DiagramBlock } from "@unvibe/shared";
import { clearD2SvgCache } from "./D2Diagram.js";
import { DiagramView } from "./DiagramView.js";
import { zoomAround, fitContentBox, IDENTITY_VIEW } from "./panZoom.js";
import { naturalSize } from "./d2sanitize.js";

// jsdom has no matchMedia: pretend the OS prefers light.
function stubMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
    writable: true,
  });
}
stubMatchMedia();

// `desc:` targets dispatch the reveal event with no snapshot needed.
const CITED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><a href="#" data-refs="desc:d-p1" data-src="desc:d-p1"><rect id="box" x="1" y="1" width="10" height="10"/></a></svg>`;

function d2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b1",
    source: "a -> b",
    citations: [],
    render: { hash: "hov1", status: "ok" },
  };
}

/**
 * jsdom has no PointerEvent, and testing-library's fallback event drops
 * pointer-only props (pointerId/clientX/buttons arrive undefined), so
 * pointer sequences are dispatched as plain events with the fields the
 * overlay reads assigned by hand. React's synthetic pointer handlers read
 * them off the native event.
 */
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  props: { pointerId?: number; clientX?: number; clientY?: number; buttons?: number },
): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, props);
  act(() => {
    el.dispatchEvent(e);
  });
}

function renderDiagram(): void {
  render(
    <MemoryRouter>
      <DiagramView reviewId="demo" block={d2Block()} onOpenPage={() => {}} fetchSvg={async () => CITED} />
    </MemoryRouter>,
  );
}

async function openOverlay(): Promise<HTMLElement> {
  renderDiagram();
  await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
  const expand = screen.getByRole("button", { name: "Expand diagram" });
  expand.focus();
  fireEvent.click(expand);
  const dialog = await screen.findByRole("dialog", { name: "Expanded diagram" });
  return dialog as HTMLElement;
}

beforeEach(() => {
  clearD2SvgCache();
  document.documentElement.removeAttribute("data-theme");
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("zoomAround", () => {
  it("zooms around the cursor point and clamps to the limits", () => {
    const z = zoomAround(IDENTITY_VIEW, 100, 50, 2);
    expect(z.s).toBe(2);
    // The anchor point stays put: x' = cx - (cx - x) * r.
    expect(z.x).toBe(100 - 100 * 2);
    expect(z.y).toBe(50 - 50 * 2);
    expect(zoomAround(IDENTITY_VIEW, 0, 0, 100).s).toBe(8);
    expect(zoomAround(IDENTITY_VIEW, 0, 0, 0.001).s).toBe(0.25);
    expect(zoomAround(IDENTITY_VIEW, 0, 0, -2)).toEqual(IDENTITY_VIEW);
  });
});

describe("fitContentBox", () => {
  it("centers the measured box with equal margins, capped at 1×", () => {
    // Wide content with a badge overflowing the top (negative boxY): the
    // box — not the viewBox — is what gets centered.
    const fit = fitContentBox(1392, 911, -21, -16, 1400, 271);
    expect(fit).not.toBeNull();
    const s = 1392 / 1400;
    expect(fit!.s).toBeCloseTo(s, 10);
    // Margins are symmetric by construction: left = right, top = bottom.
    const left = s * -21 + fit!.x;
    const right = 1392 - (s * (-21 + 1400) + fit!.x);
    expect(left).toBeCloseTo(right, 10);
    const top = s * -16 + fit!.y;
    const bottom = 911 - (s * (-16 + 271) + fit!.y);
    expect(top).toBeCloseTo(bottom, 10);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("never upscales: small content centers at natural size", () => {
    expect(fitContentBox(1392, 911, 0, 0, 340, 150)).toEqual({
      s: 1,
      x: (1392 - 340) / 2,
      y: (911 - 150) / 2,
    });
  });

  it("clamps to the zoom limits and rejects degenerate boxes", () => {
    expect(fitContentBox(10000, 10000, 0, 0, 10, 10)?.s).toBe(1);
    expect(fitContentBox(10, 10, 0, 0, 10000, 10000)?.s).toBe(0.25);
    expect(fitContentBox(0, 600, 0, 0, 100, 100)).toBeNull();
    expect(fitContentBox(600, 600, 0, 0, 0, 100)).toBeNull();
  });
});

describe("naturalSize", () => {
  it("reads the viewBox", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 1379 251");
    expect(naturalSize(svg)).toEqual({ w: 1379, h: 251 });
    svg.removeAttribute("viewBox");
    expect(naturalSize(svg)).toBeNull();
  });
});

describe("DiagramOverlay open/close", () => {
  it("opens on Expand and moves focus into the dialog", async () => {
    const dialog = await openOverlay();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
    // The overlay renders its own copy of the diagram.
    await waitFor(() =>
      expect(document.querySelector(".dg-ov-doc .dg-svg svg")).not.toBeNull(),
    );
  });

  it("Esc closes and focus returns to the Expand control", async () => {
    await openOverlay();
    const expand = screen.getByRole("button", { name: "Expand diagram" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(expand);
  });

  it("the close control closes the overlay", async () => {
    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Close diagram" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("DiagramOverlay zoom/pan", () => {
  it("zoom buttons change the transform and Reset restores it", async () => {
    const dialog = await openOverlay();
    const withinDialog = within(dialog);
    const doc = document.querySelector(".dg-ov-doc") as HTMLElement;
    expect(doc.style.transform).toBe("translate(0px, 0px) scale(1)");
    fireEvent.click(withinDialog.getByRole("button", { name: "Zoom in" }));
    expect(doc.style.transform).toBe("translate(0px, 0px) scale(1.25)");
    expect(withinDialog.getByText("125%")).toBeInTheDocument();
    fireEvent.click(withinDialog.getByRole("button", { name: "Reset view" }));
    expect(doc.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(withinDialog.getByText("100%")).toBeInTheDocument();
  });

  it("wheel zooms around the pointer", async () => {
    await openOverlay();
    const viewport = document.querySelector(".dg-ov-view") as HTMLElement;
    const doc = document.querySelector(".dg-ov-doc") as HTMLElement;
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 100, clientY: 80 });
    expect(doc.style.transform).not.toBe("translate(0px, 0px) scale(1)");
    expect(doc.style.transform).toMatch(/scale\((?!1\))/);
  });

  it("dragging pans the diagram", async () => {
    await openOverlay();
    const viewport = document.querySelector(".dg-ov-view") as HTMLElement;
    const doc = document.querySelector(".dg-ov-doc") as HTMLElement;
    firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    firePointer(viewport, "pointermove", { pointerId: 1, clientX: 140, clientY: 120, buttons: 1 });
    firePointer(viewport, "pointerup", { pointerId: 1, clientX: 140, clientY: 120 });
    expect(doc.style.transform).toBe("translate(40px, 20px) scale(1)");
  });
});

describe("DiagramOverlay citations", () => {
  it("click on a cited shape still reveals", async () => {
    const seen: string[] = [];
    const onReveal = (e: Event): void => {
      seen.push((e as CustomEvent).detail.ref as string);
    };
    window.addEventListener("unvibe:reveal-source", onReveal);
    try {
      await openOverlay();
      const viewport = document.querySelector(".dg-ov-view") as HTMLElement;
      const anchor = document.querySelector(".dg-ov-doc .dg-svg a[href]") as HTMLElement;
      // A real click is a press + release at one spot: the press must not
      // capture the pointer (that would retarget mouseup and break the
      // click), so the reveal still fires.
      firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 50, clientY: 50, buttons: 1 });
      firePointer(viewport, "pointerup", { pointerId: 1, clientX: 50, clientY: 50 });
      fireEvent.click(anchor);
      expect(seen).toEqual(["desc:d-p1"]);
    } finally {
      window.removeEventListener("unvibe:reveal-source", onReveal);
    }
  });

  it("a drag does not count as a click on a cited shape", async () => {
    const seen: string[] = [];
    const onReveal = (e: Event): void => {
      seen.push((e as CustomEvent).detail.ref as string);
    };
    window.addEventListener("unvibe:reveal-source", onReveal);
    try {
      await openOverlay();
      const viewport = document.querySelector(".dg-ov-view") as HTMLElement;
      const anchor = document.querySelector(".dg-ov-doc .dg-svg a[href]") as HTMLElement;
      // A 40px drag, then the click that ends it: suppressed.
      firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
      firePointer(viewport, "pointermove", { pointerId: 1, clientX: 140, clientY: 100, buttons: 1 });
      firePointer(viewport, "pointerup", { pointerId: 1, clientX: 140, clientY: 100 });
      fireEvent.click(anchor);
      expect(seen).toEqual([]);
      // The next plain click reveals again.
      fireEvent.click(anchor);
      expect(seen).toEqual(["desc:d-p1"]);
    } finally {
      window.removeEventListener("unvibe:reveal-source", onReveal);
    }
  });
});
