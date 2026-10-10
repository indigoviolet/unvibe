/**
 * Mock-mode entry point (M2, web-guide owner). Isolated in this one small
 * file so the merge with the diff agent's `src/mock/index.ts` is trivial:
 * that module assembles the full fixture from `./guide.js` + `./diff.js`
 * and replaces calls to `ensureMockSnapshot`.
 *
 * - `isMockMode()` is true when built with `VITE_MOCK=1`.
 * - `ensureMockSnapshot(reviewId)` loads the guide fixture into the store
 *   with an empty diff (`files: []`). Citation previews and `revealSource`
 *   fall back to `prototypeLines.ts` until the diff fixture lands.
 */
import type { ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import {
  guideAnnotations,
  guideDescription,
  guidePages,
  guideReview,
  guideVersion,
} from "./guide.js";

export function isMockMode(): boolean {
  return import.meta.env.VITE_MOCK === "1";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build the guide-only mock snapshot (diff side filled in by `mock/diff`). */
export function buildGuideSnapshot(reviewId: string): ReviewSnapshot {
  return {
    review: { ...guideReview, id: reviewId },
    version: guideVersion,
    files: [],
    pages: clone(guidePages),
    annotations: clone(guideAnnotations),
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    description: clone(guideDescription),
  };
}

/** Load the fixture into the store unless a snapshot is already present. */
export function ensureMockSnapshot(reviewId: string): void {
  const { snapshot, setSnapshot } = useReview.getState();
  if (snapshot) return;
  setSnapshot(buildGuideSnapshot(reviewId));
}
