/**
 * Mock guide fixture (web-guide owner).
 *
 * Pages, annotations and description for the urllib3#5020 sample review,
 * loaded from the generated `fixtures/urllib3-5020/snapshot.json` — what
 * the real pipeline produces from the recorded session, with real file
 * keys and `d-p1…` paragraph ids.
 *
 * `src/mock/index.ts` depends on `MOCK_PAGES`, `MOCK_ANNOTATIONS` and
 * `MOCK_DESCRIPTION`. `MOCK_KEY_ALIASES` maps the fixture's short citation
 * keys (`conn`, `tconn`, …; see `meta.json`) to real file keys so citation
 * previews and reveal work; live snapshots carry no aliases.
 */
import type {
  Annotation,
  Page,
  ReviewDescription,
  ReviewSnapshot,
} from "@unvibe/shared";
// `?raw` keeps the JSON out of TS's NodeNext import-attribute rules;
// the loader parses it into the typed snapshot below.
import metaRaw from "../../../../fixtures/urllib3-5020/meta.json?raw";
import snapshotRaw from "../../../../fixtures/urllib3-5020/snapshot.json?raw";

const snapshot = JSON.parse(snapshotRaw) as unknown as ReviewSnapshot;
const meta = JSON.parse(metaRaw) as unknown as { keyAliases?: Record<string, string> };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const MOCK_PAGES: Page[] = clone(snapshot.pages);

export const MOCK_ANNOTATIONS: Annotation[] = clone(snapshot.annotations);

export const MOCK_DESCRIPTION: ReviewDescription = clone(
  snapshot.description ?? { html: "", rev: "", source: "pr", editable: false },
);

/** Fixture short file-key aliases (`conn` → `src-urllib3-connection.py`). */
export const MOCK_KEY_ALIASES: Record<string, string> = { ...(meta.keyAliases ?? {}) };
