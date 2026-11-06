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
  Thread,
  Page,
  ReviewDescription,
  ReviewSnapshot,
} from "@unvibe/shared";
// `?raw` keeps the JSON out of TS's NodeNext import-attribute rules;
// the loader parses it into the typed snapshot below.
import snapshotRaw from "../../../../fixtures/urllib3-5020/snapshot.json?raw";
import { STATIC_DEMO } from "../demo.js";

const snapshot = JSON.parse(snapshotRaw) as unknown as ReviewSnapshot;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Mock-only augmentation (not in the static demo build): the recording
 * from #341 has no `data-link` anchors at all, so the concept-link
 * behaviour (dotted-link hover preview, popover close rules, navigation
 * and trail, the on-demand concept page) would have nothing to exercise
 * in mock mode. Wrap two existing mentions in the root "problem" card in
 * concept links, rendered the way the app renders them
 * (`<a class="cx" data-link="concept:…">`). The fixture and the service
 * stay untouched; the static demo shows the recording as recorded.
 */
function addMockConceptLinks(pages: Page[]): Page[] {
  if (STATIC_DEMO) return pages;
  const links: [string, string][] = [
    ["obsolete folded header lines", '<a class="cx" data-link="concept:obs-fold">obsolete folded header lines</a>'],
    ["built the headers with", 'built the <a class="cx" data-link="concept:http-headers">headers</a> with'],
  ];
  const problem = pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem");
  for (const block of problem?.blocks ?? []) {
    if (block.type !== "paragraph") continue;
    for (const [plain, linked] of links) {
      block.text.standard = block.text.standard.replace(plain, linked);
    }
  }
  return pages;
}

export const MOCK_PAGES: Page[] = addMockConceptLinks(clone(snapshot.pages));

export const MOCK_ANNOTATIONS: Thread[] = clone(snapshot.annotations);

export const MOCK_DESCRIPTION: ReviewDescription = clone(
  snapshot.description ?? { html: "", rev: "", source: "pr", editable: false },
);
