/**
 * Atomic geometry reads for the long journeys (#363 B1).
 *
 * Two separate `boundingBox()` calls can straddle a late-loading banner
 * (CI hit 67.5px in j352, fixed twice): read every rect in ONE synchronous
 * `evaluate` and compare offsets *inside* their row, so content above the
 * list can move the whole row without flaking the assert.
 *
 * B, C and D reuse this; add new geometry helpers here, not per journey.
 */
import type { Locator, Page } from "@playwright/test";

export interface MeasuredBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One row plus the named boxes inside it, all read in a single evaluate. */
export interface WithinMeasurement {
  row: MeasuredBox;
  inner: Record<string, MeasuredBox>;
}

/**
 * Read `rowSelector` and the selectors inside it atomically (page scope).
 * Throws when the row or any inner selector matches nothing.
 */
export async function measureWithin(
  page: Page,
  rowSelector: string,
  innerSelectors: string | readonly string[],
): Promise<WithinMeasurement> {
  const sels = typeof innerSelectors === "string" ? [innerSelectors] : innerSelectors;
  return page.evaluate(
    ([rowSel, innerSels]) => {
      const rowEl = document.querySelector(rowSel);
      if (!rowEl) throw new Error(`measureWithin: no element for ${rowSel}`);
      const box = (r: DOMRect): MeasuredBox => ({ x: r.x, y: r.y, width: r.width, height: r.height });
      const inner: Record<string, MeasuredBox> = {};
      for (const sel of innerSels) {
        const el = rowEl.querySelector(sel);
        if (!el) throw new Error(`measureWithin: no ${sel} within ${rowSel}`);
        inner[sel] = box(el.getBoundingClientRect());
      }
      return { row: box(rowEl.getBoundingClientRect()), inner };
    },
    [rowSelector, sels] as const,
  );
}

/**
 * Same, scoped to an already-located row (still one evaluate, still atomic).
 */
export async function measureWithinRow(
  row: Locator,
  innerSelectors: string | readonly string[],
): Promise<WithinMeasurement> {
  const sels = typeof innerSelectors === "string" ? [innerSelectors] : innerSelectors;
  return row.evaluate((rowEl, innerSels) => {
    const box = (r: DOMRect): MeasuredBox => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const inner: Record<string, MeasuredBox> = {};
    for (const sel of innerSels) {
      const el = rowEl.querySelector(sel);
      if (!el) throw new Error(`measureWithinRow: no ${sel} within the row`);
      inner[sel] = box(el.getBoundingClientRect());
    }
    return { row: box(rowEl.getBoundingClientRect()), inner };
  }, sels);
}
