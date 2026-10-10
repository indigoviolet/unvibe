/**
 * Mock guide fixture. Owner: web guide agent.
 * M1-web-diff stub: empty pages/annotations so the diff pane (hide
 * uninteresting's "never hide a hunk the guide cites" rule) has no cited
 * hunks yet. The guide agent replaces this file with real fixture content;
 * `src/mock/index.ts` only depends on these two exported names.
 */
import type { Annotation, Page } from "@unvibe/shared";

export const MOCK_PAGES: Page[] = [];

export const MOCK_ANNOTATIONS: Annotation[] = [];
