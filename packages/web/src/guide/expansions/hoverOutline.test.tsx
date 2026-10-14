/**
 * Hover-outline regression (issue #111): the guide's mouseover handlers
 * must not strip the depth stepper pips (`.pips i.on`, owned by React).
 * Clearing is scoped to the outline elements the handlers add.
 */
import { afterEach, describe, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GuideThreadHooks } from "../../comments/GuideThreads.js";
import { useReview } from "../../state/store.js";
import { ExpansionHighlights } from "./ExpansionHighlights.js";

function mountPage(): HTMLElement {
  const page = document.createElement("div");
  page.id = "page";
  page.innerHTML = `
    <section class="card" id="C-c1">
      <span class="depth">
        <span class="pips"><i class="on"></i><i class="on"></i><i class=""></i></span>
      </span>
      <mark class="anc ex on" data-jump="ann_old">Nav 2</mark>
    </section>
    <section class="card child on" id="B-ann_old"></section>
    <div class="ithread on" id="thr_old"></div>
  `;
  document.body.appendChild(page);
  return page;
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  document.getElementById("page")?.remove();
});

describe("hover outline (#111)", () => {
  test("a mouseover leaves depth pips on while clearing mark/card/thread outlines", () => {
    const page = mountPage();
    render(
      <MemoryRouter initialEntries={["/review/demo"]}>
        <ExpansionHighlights />
        <GuideThreadHooks />
      </MemoryRouter>,
    );
    page.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    // Pips keep their React-rendered active state.
    const pips = [...page.querySelectorAll(".pips i")];
    expect(pips).toHaveLength(3);
    expect(pips[0].classList.contains("on")).toBe(true);
    expect(pips[1].classList.contains("on")).toBe(true);
    expect(pips[2].classList.contains("on")).toBe(false);
    // The handlers' own outlines are still cleared.
    expect(page.querySelector("mark.on")).toBeNull();
    expect(page.querySelector(".card.child.on")).toBeNull();
    expect(page.querySelector(".ithread.on")).toBeNull();
  });
});
