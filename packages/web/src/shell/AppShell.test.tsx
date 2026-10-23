/**
 * Pane-toggle behaviour tests for the review shell (issue #83) against
 * the mock API (`VITE_MOCK=1`): the `[ Guide | Source ]` selector moves
 * between two-pane, guide-only and source-only layouts, never hides both
 * panes, restores the split width, and brings panes back on demand
 * (`REVEAL_EVENT` from the guide, `SHOW_GUIDE_EVENT` from the source).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { resetMockState } from "../mock/index.js";
import { REVEAL_EVENT } from "../source/diff/revealSource.js";
import { SHOW_GUIDE_EVENT } from "./panes.js";
import { AppShell } from "./AppShell.js";
import { useReview } from "../state/store.js";

// Stub the heavy panes (issue #119): every assertion below is on #page /
// #right / .cols, which AppShell itself renders, and both window events are
// handled in AppShell — the 4-file demo diff render is not under test here.
vi.mock("../guide/GuidePage.js", () => ({
  GuidePage: () => <div data-testid="guide-stub" />,
}));
vi.mock("../source/SourcePane.js", () => ({
  SourcePane: () => <div data-testid="source-stub" />,
}));

const CONN = "src-urllib3-connection.py";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
  // jsdom has no matchMedia (the guide's diagrams read the OS theme).
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
});

async function renderShell(): Promise<void> {
  render(
    <MemoryRouter initialEntries={["/review/demo"]}>
      <AppShell reviewId="demo" />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Guide" }, { timeout: 5000 });
}

function guide(): HTMLElement {
  const el = document.getElementById("page");
  if (!el) throw new Error("missing #page");
  return el;
}

function source(): HTMLElement {
  const el = document.getElementById("right");
  if (!el) throw new Error("missing #right");
  return el;
}

function guideSeg(): HTMLElement {
  // Scoped to the review bar (issue #119): a document-wide role query
  // walks the whole 4-file demo diff on every call (~150 ms each).
  return within(document.getElementById("reviewbar")!).getByRole("button", { name: "Guide" });
}

function sourceSeg(): HTMLElement {
  return document.getElementById("toggleRight") ?? screen.getByRole("button", { name: "Source" });
}

describe("AppShell pane toggles", () => {
  it("moves both → guide only → both → source only → both", async () => {
    await renderShell();
    // jsdom defaults to a 1024px window: docked two-pane layout.
    expect(guideSeg()).toHaveAttribute("aria-pressed", "true");
    expect(sourceSeg()).toHaveAttribute("aria-pressed", "true");
    expect(guide().classList.contains("hide")).toBe(false);
    expect(source().classList.contains("hide")).toBe(false);

    await fireEvent.click(guideSeg());
    expect(guideSeg()).toHaveAttribute("aria-pressed", "false");
    expect(sourceSeg()).toHaveAttribute("aria-pressed", "true");
    expect(guide().classList.contains("hide")).toBe(true);
    expect(source().classList.contains("hide")).toBe(false);
    // Source-only is a plain section, never the narrow overlay.
    expect(source().classList.contains("overlay")).toBe(false);

    await fireEvent.click(guideSeg());
    expect(guide().classList.contains("hide")).toBe(false);
    expect(source().classList.contains("hide")).toBe(false);

    await fireEvent.click(sourceSeg());
    expect(guideSeg()).toHaveAttribute("aria-pressed", "true");
    expect(sourceSeg()).toHaveAttribute("aria-pressed", "false");
    expect(guide().classList.contains("hide")).toBe(false);
    expect(source().classList.contains("hide")).toBe(true);

    await fireEvent.click(sourceSeg());
    expect(guide().classList.contains("hide")).toBe(false);
    expect(source().classList.contains("hide")).toBe(false);
  });

  it("cannot hide both panes: switching off the only visible pane switches to the other", async () => {
    await renderShell();
    // Guide only, then Guide acts as a switch to source-only.
    await fireEvent.click(sourceSeg());
    expect(source().classList.contains("hide")).toBe(true);
    await fireEvent.click(guideSeg());
    expect(guide().classList.contains("hide")).toBe(true);
    expect(source().classList.contains("hide")).toBe(false);
    // Source only, then Source acts as a switch back to guide-only.
    await fireEvent.click(sourceSeg());
    expect(guide().classList.contains("hide")).toBe(false);
    expect(source().classList.contains("hide")).toBe(true);
  });

  it("restores the split width after a full-width source pane", async () => {
    await renderShell();
    const before = localStorage.getItem("unvibe.paneWidth");
    expect(before).not.toBeNull();
    const cols = document.querySelector(".cols") as HTMLElement;
    const twoPane = cols.style.gridTemplateColumns;
    expect(twoPane).toMatch(/6px/);
    // Source-only: single column, and the stored split width is untouched.
    await fireEvent.click(guideSeg());
    expect(cols.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(localStorage.getItem("unvibe.paneWidth")).toBe(before);
    // Back to both: the previous split width returns.
    await fireEvent.click(guideSeg());
    expect(cols.style.gridTemplateColumns).toBe(twoPane);
    expect(localStorage.getItem("unvibe.paneWidth")).toBe(before);
  });

  it("reveal from guide-only opens source without hiding the guide", async () => {
    await renderShell();
    await fireEvent.click(sourceSeg());
    expect(source().classList.contains("hide")).toBe(true);
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { ref: `diff:${CONN}:77` } }));
    await waitFor(() => expect(source().classList.contains("hide")).toBe(false));
    expect(guide().classList.contains("hide")).toBe(false);
  });

  it("navigation from source-only shows the guide without hiding source", async () => {
    await renderShell();
    await fireEvent.click(guideSeg());
    expect(guide().classList.contains("hide")).toBe(true);
    // Fired by "Open as page" (SourcePane) and promoted
    // page links (DescriptionView), and the comments menu jumping to a
    // guide thread (CommentsMenu).
    window.dispatchEvent(new CustomEvent(SHOW_GUIDE_EVENT));
    await waitFor(() => expect(guide().classList.contains("hide")).toBe(false));
    expect(source().classList.contains("hide")).toBe(false);
  });
});
