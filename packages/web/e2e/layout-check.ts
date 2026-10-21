/**
 * Generic layout check (#225), reusable by the visual tour and by
 * journeys against the real service. No screenshot baselines.
 *
 * Asserts, for the current page state:
 * - no horizontal page scroll;
 * - no element overflows its card or panel horizontally (descendant
 *   bounding boxes within the container, and `scrollWidth <=
 *   clientWidth` on cards and panels);
 * - rows in a ListRow list (`.ui-list > .ui-row`) share one height;
 * - rows in the same column/form share their right edge (sibling
 *   `.ui-field` rows; an add row — input + button — vs. the list
 *   or card below it in the same parent; and a single-line add row
 *   fills its own row, trailing control at the row's right edge).
 *
 * Elements inside a horizontally scrollable ancestor (e.g. a diff
 * code table's scroller) are exempt from the descendant-box rule:
 * that scroller is the intended horizontal overflow path. Fixed and
 * absolutely positioned descendants are exempt too (menus, popovers
 * and floating cards are checked by their own tour checks).
 *
 * On failure the message names the scene and the offending element.
 */
import { expect, type Page } from "@playwright/test";

interface LayoutReport {
  violations: string[];
}

/** Collect layout violations for the current page state (no assert). */
export async function collectLayoutViolations(page: Page): Promise<string[]> {
  const report = (await page.evaluate(() => {
    const TOL = 1.5;
    const violations: string[] = [];
    const describe = (el: Element): string => {
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
      const cls = typeof (el as HTMLElement).className === "string"
        ? `.${(el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : "";
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el as HTMLElement);
      return s.display !== "none" && s.visibility !== "hidden";
    };
    const scrollableX = (el: Element): boolean => {
      const s = getComputedStyle(el as HTMLElement);
      return s.overflowX === "auto" || s.overflowX === "scroll";
    };
    // An ancestor (strictly between descendant and container, or the
    // descendant itself) that scrolls horizontally owns the overflow.
    const insideScroller = (el: Element, container: Element): boolean => {
      let node: Element | null = el;
      while (node && node !== container) {
        if (scrollableX(node)) return true;
        node = node.parentElement;
      }
      return false;
    };
    const positionedOut = (el: Element, container: Element): boolean => {
      let node: Element | null = el;
      while (node && node !== container) {
        const pos = getComputedStyle(node as HTMLElement).position;
        if (pos === "fixed" || pos === "absolute") return true;
        node = node.parentElement;
      }
      return false;
    };

    // 1. No horizontal page scroll.
    const pageOver = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    ) - window.innerWidth;
    if (pageOver > TOL) {
      violations.push(`page has horizontal scroll (${Math.round(pageOver)}px too wide)`);
    }

    // 2. Cards and panels: no horizontal overflow.
    const reported = new Set<string>();
    const containers = document.querySelectorAll(
      ".ui-card, [role=\"tabpanel\"], .prblock",
    );
    containers.forEach((container) => {
      if (!visible(container)) return;
      if (!scrollableX(container) && container.scrollWidth > container.clientWidth + TOL) {
        violations.push(
          `${describe(container)} scrolls horizontally (scrollWidth ${container.scrollWidth} > clientWidth ${container.clientWidth})`,
        );
      }
      const c = container.getBoundingClientRect();
      container.querySelectorAll("*").forEach((el) => {
        if (!visible(el)) return;
        if (insideScroller(el, container) || positionedOut(el, container)) return;
        const r = el.getBoundingClientRect();
        if (r.left < c.left - TOL || r.right > c.right + TOL) {
          // A nested card/panel reports its own overflow; don't repeat
          // the same element for every ancestor container.
          const key = `overflow:${describe(el)}`;
          if (reported.has(key)) return;
          reported.add(key);
          violations.push(
            `${describe(el)} overflows ${describe(container)} horizontally (element ${Math.round(r.left)}-${Math.round(r.right)}, container ${Math.round(c.left)}-${Math.round(c.right)})`,
          );
        }
      });
    });

    // 3. Equal row heights within a ListRow list.
    document.querySelectorAll(".ui-list").forEach((list) => {
      if (!visible(list)) return;
      const rows = [...list.querySelectorAll(":scope > .ui-row")].filter(visible);
      if (rows.length < 2) return;
      const heights = rows.map((r) => r.getBoundingClientRect().height);
      const lo = Math.min(...heights);
      const hi = Math.max(...heights);
      if (hi - lo > TOL) {
        const tall = rows[heights.indexOf(hi)];
        violations.push(
          `unequal row heights in ${describe(list)} (${lo.toFixed(1)}px vs ${hi.toFixed(1)}px, tallest: ${describe(tall)})`,
        );
      }
    });

    // 4a. Sibling form rows share their right edge.
    const fieldParents = new Set<Element>();
    document.querySelectorAll(".ui-field").forEach((f) => {
      if (f.parentElement) fieldParents.add(f.parentElement);
    });
    fieldParents.forEach((parent) => {
      const rows = [...parent.children].filter(
        (ch) => ch.classList.contains("ui-field") && visible(ch),
      );
      if (rows.length < 2) return;
      const rights = rows.map((r) => r.getBoundingClientRect().right);
      if (Math.max(...rights) - Math.min(...rights) > TOL) {
        const off = rows[rights.indexOf(Math.min(...rights))];
        violations.push(
          `form rows in ${describe(parent)} do not share a right edge (${rights.map((r) => Math.round(r)).join(", ")}; off: ${describe(off)})`,
        );
      }
    });

    // Text inputs only: checkboxes (reviewed boxes), radios and hidden
    // inputs are controls, not add-row fields.
    const isTextInput = (el: Element): boolean =>
      el.tagName === "INPUT" &&
      (el as HTMLInputElement).type !== "checkbox" &&
      (el as HTMLInputElement).type !== "radio" &&
      (el as HTMLInputElement).type !== "hidden";
    const hasTextInput = (el: Element): boolean =>
      isTextInput(el) || [...el.querySelectorAll("input")].some(isTextInput);

    // 4b. An add row (input + button) and the list/card below it in
    // the same parent share their right edge.
    document.querySelectorAll("*").forEach((parent) => {
      const kids = [...parent.children].filter(visible);
      if (kids.length < 2) return;
      const isListOrCard = (el: Element): boolean =>
        el.classList.contains("ui-list") || el.classList.contains("ui-card");
      const isAddRow = (el: Element): boolean =>
        !isListOrCard(el) && hasTextInput(el) && !!el.querySelector("button");
      const lists = kids.filter(isListOrCard);
      const adds = kids.filter(isAddRow);
      if (lists.length === 0 || adds.length === 0) return;
      const target = Math.max(...lists.map((el) => el.getBoundingClientRect().right));
      for (const add of adds) {
        const right = add.getBoundingClientRect().right;
        if (Math.abs(right - target) > TOL) {
          violations.push(
            `${describe(add)} does not share the right edge of the list/card below it in ${describe(parent)} (add row ends ${Math.round(right)}, list/card ends ${Math.round(target)})`,
          );
        }
      }
      if (adds.length >= 2) {
        const rights = adds.map((el) => el.getBoundingClientRect().right);
        if (Math.max(...rights) - Math.min(...rights) > TOL) {
          violations.push(
            `add rows in ${describe(parent)} do not share a right edge (${rights.map((r) => Math.round(r)).join(", ")})`,
          );
        }
      }
    });

    // 4c. A single-line add row (a text input plus a button as direct
    // children: path + "Add by path", PR URL + "Open PR") fills its
    // own row: the trailing control ends at the row's right edge
    // (inside padding). Both row boxes still stretch full width when
    // the input is capped (`.ui-input` max-width), so comparing row
    // boxes cannot see it — the #225 start-page and Repos complaints.
    // Rows inside a positioned ancestor (menus, popovers) are exempt,
    // like in rule 2. Scrollers are deliberately NOT exempt: the
    // page's own vertical scroller computes to `overflow-x: auto`,
    // which would exempt every row — and content narrower than its
    // row is a gap inside a scroller too.
    document.querySelectorAll("*").forEach((row) => {
      const kids = [...row.children].filter(visible);
      if (kids.length < 2) return;
      if (!kids.some(isTextInput) || !kids.some((k) => k.tagName === "BUTTON")) return;
      let exempt = false;
      let node: Element | null = row.parentElement;
      while (node && !exempt) {
        const pos = getComputedStyle(node as HTMLElement).position;
        if (pos === "fixed" || pos === "absolute") exempt = true;
        node = node.parentElement;
      }
      if (exempt) return;
      // Wrapped rows reflow legitimately short: single line only.
      const centers = kids.map((k) => {
        const b = k.getBoundingClientRect();
        return (b.top + b.bottom) / 2;
      });
      if (Math.max(...centers) - Math.min(...centers) > TOL) return;
      const box = row.getBoundingClientRect();
      const padRight = Number.parseFloat(getComputedStyle(row as HTMLElement).paddingRight) || 0;
      const trailing = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
      if (box.right - padRight - trailing > TOL) {
        violations.push(
          `${describe(row)} add row does not fill its row (trailing control ends ${Math.round(trailing)}, row ends ${Math.round(box.right)})`,
        );
      }
    });

    return { violations } as LayoutReport;
  })) as LayoutReport;
  return report.violations;
}

/** Run the generic layout assertions for one named scene. */
export async function checkLayout(page: Page, scene: string): Promise<void> {
  const violations = await collectLayoutViolations(page);
  expect(
    violations,
    `${scene}: layout violations:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
  ).toEqual([]);
}
