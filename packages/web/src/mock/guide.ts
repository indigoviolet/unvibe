/**
 * Mock guide fixture (web-guide owner).
 *
 * Pages, annotations and description for the urllib3#5020 sample review,
 * loaded from the generated `fixtures/urllib3-5020/snapshot.json` — what
 * the real pipeline produces from the recorded session, with real file
 * keys and `d-p1…` paragraph ids.
 *
 * `src/mock/index.ts` depends on `MOCK_PAGES`, `MOCK_ANNOTATIONS` and
 * `MOCK_DESCRIPTION`. The generated snapshot stores canonical citation
 * targets (real file keys), so no alias table is needed anywhere.
 */
import type {
  Annotation,
  Page,
  ReviewDescription,
  ReviewSnapshot,
} from "@unvibe/shared";
// `?raw` keeps the JSON out of TS's NodeNext import-attribute rules;
// the loader parses it into the typed snapshot below.
import snapshotRaw from "../../../../fixtures/urllib3-5020/snapshot.json?raw";

const snapshot = JSON.parse(snapshotRaw) as unknown as ReviewSnapshot;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const MOCK_PAGES: Page[] = clone(snapshot.pages);

export const MOCK_ANNOTATIONS: Annotation[] = clone(snapshot.annotations);

export const MOCK_DESCRIPTION: ReviewDescription = clone(
  snapshot.description ?? { html: "", rev: "", source: "pr", editable: false },
);
