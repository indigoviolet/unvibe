/**
 * Inline in-place diagram zoom tests (round two, item 2):
 * - the diagram fits the block at rest (identity transform, no scroll);
 * - +/− buttons and Ctrl+wheel zoom in place, Reset restores;
 * - a plain wheel leaves the zoom alone (the page scrolls instead);
 * - dragging pans once zoomed (never at fit) and never clicks;
 * - citation clicks still reveal at any zoom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DiagramBlock } from "@unvibe/shared";
import { clearD2SvgCache } from "./D2Diagram.js";
import { DiagramView } from "./DiagramView.js";

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

/**
 * jsdom has no PointerEvent, and testing-library's fallback event drops
 * pointer-only props, so pointer sequences are dispatched as plain events
 * with the fields the hook reads assigned by hand (see DiagramOverlay.test).
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

// `desc:` targets dispatch the reveal event with no snapshot needed.
const CITED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><a href="#" data-refs="desc:d-p1" data-src="desc:d-p1"><rect id="box" x="1" y="1" width="10" height="10"/></a></svg>`;

function d2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b1",
    source: "a -> b",
    citations: [],
    render: { hash: "inl1", status: "ok" },
  };
}

function renderInline(): void {
  render(
    <MemoryRouter>
      <DiagramView reviewId="demo" block={d2Block()} onOpenPage={() => {}} fetchSvg={async () => CITED} />
    </MemoryRouter>,
  );
}

function inlineDoc(): HTMLElement {
  return document.querySelector(".dg .dg-doc") as HTMLElement;
}

function inlineBar(): HTMLElement {
  return document.querySelector(".dg .dg-bar") as HTMLElement;
}

beforeEach(() => {
  clearD2SvgCache();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("inline zoom controls", () => {
  it("renders zoom controls next to Expand and rests at fit", async () => {
    renderInline();
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    const bar = within(inlineBar());
    expect(bar.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Reset view" })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Expand diagram" })).toBeInTheDocument();
    expect(bar.getByText("100%")).toBeInTheDocument();
    expect(inlineDoc().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("zoom buttons zoom in place and Reset restores", async () => {
    renderInline();
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    const bar = within(inlineBar());
    fireEvent.click(bar.getByRole("button", { name: "Zoom in" }));
    expect(inlineDoc().style.transform).toBe("translate(0px, 0px) scale(1.25)");
    expect(bar.getByText("125%")).toBeInTheDocument();
    fireEvent.click(bar.getByRole("button", { name: "Reset view" }));
    expect(inlineDoc().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("Ctrl+wheel zooms but a plain wheel leaves the zoom alone", async () => {
    renderInline();
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    const viewport = document.querySelector(".dg .dg-view") as HTMLElement;
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 100, clientY: 80 });
    expect(inlineDoc().style.transform).toBe("translate(0px, 0px) scale(1)");
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 100, clientY: 80, ctrlKey: true });
    expect(inlineDoc().style.transform).not.toBe("translate(0px, 0px) scale(1)");
    expect(inlineDoc().style.transform).toMatch(/scale\((?!1\))/);
  });
});

describe("inline pan and citations", () => {
  it("dragging pans once zoomed, never at fit", async () => {
    renderInline();
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    const viewport = document.querySelector(".dg .dg-view") as HTMLElement;
    // At fit a drag moves nothing…
    firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    firePointer(viewport, "pointermove", { pointerId: 1, clientX: 140, clientY: 120, buttons: 1 });
    firePointer(viewport, "pointerup", { pointerId: 1, clientX: 140, clientY: 120 });
    expect(inlineDoc().style.transform).toBe("translate(0px, 0px) scale(1)");
    // …but zoomed it pans.
    fireEvent.click(within(inlineBar()).getByRole("button", { name: "Zoom in" }));
    firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    firePointer(viewport, "pointermove", { pointerId: 1, clientX: 140, clientY: 120, buttons: 1 });
    firePointer(viewport, "pointerup", { pointerId: 1, clientX: 140, clientY: 120 });
    expect(inlineDoc().style.transform).toBe("translate(40px, 20px) scale(1.25)");
  });

  it("a drag does not click, and clicks still reveal when zoomed", async () => {
    const seen: string[] = [];
    const onReveal = (e: Event): void => {
      seen.push((e as CustomEvent).detail.ref as string);
    };
    window.addEventListener("unvibe:reveal-source", onReveal);
    try {
      renderInline();
      await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
      fireEvent.click(within(inlineBar()).getByRole("button", { name: "Zoom in" }));
      const viewport = document.querySelector(".dg .dg-view") as HTMLElement;
      const anchor = document.querySelector(".dg .dg-svg a[href]") as HTMLElement;
      firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
      firePointer(viewport, "pointermove", { pointerId: 1, clientX: 160, clientY: 100, buttons: 1 });
      firePointer(viewport, "pointerup", { pointerId: 1, clientX: 160, clientY: 100 });
      fireEvent.click(anchor);
      expect(seen).toEqual([]);
      fireEvent.click(anchor);
      expect(seen).toEqual(["desc:d-p1"]);
    } finally {
      window.removeEventListener("unvibe:reveal-source", onReveal);
    }
  });
});
