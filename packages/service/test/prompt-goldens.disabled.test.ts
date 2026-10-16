// DISABLED(#188): pins exact prompt bytes per template
/**
 * Golden files for every template rendered against the fixed fixture
 * snapshot. Re-render with UPDATE_GOLDENS=1 after intentional changes:
 * review the diff before committing.
 */
import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_NAMES } from "@unvibe/shared";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConceptsSection,
  buildDiffSection,
  buildGuideSection,
  buildHunkSummaries,
  buildL1bPinned,
  buildSourceBlurb,
  formatHunk,
} from "../src/context/index.js";
import {
  loadTemplatesDirSync,
  renderTemplate,
  type RenderValues,
} from "../src/prompts/index.js";
import { accessPolicyText } from "../src/prompts/access.js";
import { fixtureSnapshot } from "./fixtures.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");
const GOLDENS = path.join(TEST_DIR, "goldens");

function goldenValues(): Record<string, RenderValues> {
  const snap = fixtureSnapshot();
  const source = buildSourceBlurb(snap);
  const diff = buildDiffSection(snap).text;
  const pinned = buildL1bPinned(snap.pinnedCode);
  const guide = buildGuideSection(snap);
  const concepts = buildConceptsSection(snap);
  const hunkSummaries = buildHunkSummaries(snap);
  const firstHunk = snap.files[0].hunks[0];
  const card = `### ${snap.cards[0].title} [[card:${snap.cards[0].id}]]\n\n${snap.cards[0].markdown}\n`;
  const anchor = {
    quote: "obsolete line folding",
    block: "HTTP/1.1 used to let a server continue a header value on the next line. [[desc:d-intro]]",
  };
  const thread = "you: What is a fold?\nai: A header value continued on the next line. [[desc:d-intro]]";
  const changeList = "- [1 thread-summary global] Reader settled the cookie question";
  return {
    instructions: {},
    reader: { source, diff_inline: diff, repo_path: "/tmp/unvibe-wt/branch" },
    base_pack: { source, diff_inline: diff, pinned_code: pinned, guide, concepts, hunk_summaries: hunkSummaries },
    critic: {},
    hunk_pass: { hunk: formatHunk(firstHunk), path: snap.files[0].path },
    plotline_assign: {
      plotlines: "- retry-logic: Retry failed uploads — retries with backoff",
      hunks: "- h:conn:h111 src/conn.py: Adds a fast path that skips values without CRLF.",
      commits: "- `aaa1114` Unfold obsolete folded header values — hunks: h:conn:h111, h:conn:h222",
    },
    concept_stub: {
      concept: "obs-fold — Obsolete line folding: a header value continued on the next line.",
      mentions: "- problem card [[card:c-problem]]\n- diff [[diff:conn:650-651]]",
    },
    concept_page: {
      concept: "obs-fold — Obsolete line folding: a header value continued on the next line.",
      mentions: "- problem card [[card:c-problem]]\n- diff [[diff:conn:650-651]]",
    },
    ask: { anchor, card, thread, change_list: changeList, message: "Does Requests see the raw value?" },
    ask_turn: { change_list: changeList, message: "What about ordering?" },
    depth: { card, level: "deep" },
    examples: { card, level: "standard" },
    diagram: { card, level: "standard" },
    go_deeper: { direction: "Data flow: from the socket to HTTPHeaderDict — follows a folded header to both views." },
    update_pass: {
      changed_hunks: "### [[h:conn:h111]] reflowed: +1 −1",
      stale_cards: "### The central change [[card:c-central]] (2 cited hunks changed)",
      findings: "### Folds that end in a bare LF are not unfolded (medium) [[page:f-lf]] — still applies",
    },
    consolidate: {
      contributions: '- c1 [fact] "Requests reads the original message" [[diff:tsock:139-146]]\n- c2 [fact] duplicate',
    },
    second_opinion_blind: {
      topic: "Folds that end in a bare LF are not unfolded (medium): the pattern needs CRLF.",
      cited_code: `### [[code:src/urllib3/connection.py:91-110]]\n\ndef _normalize_header_value(value): ...`,
    },
    second_opinion_check: {
      claim: "Folds that end in a bare LF are not unfolded: the pattern needs CRLF.",
      cited_code: `### [[code:src/urllib3/connection.py:91-110]]\n\ndef _normalize_header_value(value): ...`,
    },
  };
}

describe("template goldens", () => {
  const lib = loadTemplatesDirSync(REPO_PROMPTS);
  const values = goldenValues();
  // Issue #160: the instructions golden renders the lock-down variant —
  // the golden file itself is unchanged, proving the default is
  // byte-for-byte the pre-#160 wording.
  values["instructions"] = { access_policy: accessPolicyText(lib, "lockdown") };
  const update = process.env.UPDATE_GOLDENS === "1";

  for (const name of PROMPT_TEMPLATE_NAMES) {
    it(`${name} renders the golden bytes`, () => {
      const t = lib.get(name);
      if (!t) throw new Error(`missing template ${name}`);
      const rendered = renderTemplate(t, values[name]);
      const file = path.join(GOLDENS, `${name}.md`);
      if (update) {
        fs.mkdirSync(GOLDENS, { recursive: true });
        fs.writeFileSync(file, rendered);
      }
      expect(rendered, `${name}: run UPDATE_GOLDENS=1 to refresh, then review the diff`).toBe(
        fs.readFileSync(file, "utf8"),
      );
    });
  }
});
