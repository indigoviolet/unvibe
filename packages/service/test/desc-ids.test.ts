/**
 * Issue #96: agents cannot get `desc:` IDs from the review tools.
 *
 * Fault 1: `resolve` never looks at the PR description, so it can never
 * return a `desc:` candidate.
 * Fault 2: `search` numbers `desc:` IDs by re-splitting the stored HTML
 * (`descItems`), which counts headings and every list item — while ingest
 * (`renderMarkdownBlocks`) numbers one ID per block with no ID for
 * headings and one ID for a whole list. The two drift after the first
 * heading or list.
 *
 * These tests drive the MCP tools through the registry (HTTP, like
 * `mcp.test.ts`) with the real `StoreReviewReader` over a stored snapshot,
 * and assert the returned IDs equal the IDs ingest assigned (read from
 * `renderMarkdownBlocks(...).paragraphs`, never hand-counted).
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ReviewSnapshot } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { renderMarkdownBlocks } from "../src/ingest/description.js";
import { McpRegistry, type IssuedSession } from "../src/mcp/index.js";
import { StoreReviewReader } from "../src/mcp/reviewReader.js";
import { lookupForSnapshot } from "../src/pipeline/lookup.js";
import { buildExcerptMap } from "../src/secondopinion/excerpts.js";
import { createApp } from "../src/server.js";
import type { ReviewStore } from "../src/state/store.js";

// Paragraph, heading, paragraph, multi-item list, paragraph, code, paragraph.
const BODY = [
  "Intro paragraph about the motivate alpha.",
  "",
  "## Background heading",
  "",
  "Second paragraph mentioning the prototype link beta.",
  "",
  "- list item one gamma",
  "- list item two delta",
  "- list item three epsilon",
  "",
  "Third paragraph after the list zeta.",
  "",
  "```python",
  "code block eta = 1",
  "```",
  "",
  "Fourth paragraph at the end theta.",
  "",
].join("\n");

function snapshotFor(html: string, extra?: Partial<ReviewSnapshot["description"]>): ReviewSnapshot {
  return {
    review: {
      id: "rv_desc96",
      repoId: "octo/hello",
      branch: "feature",
      prNumber: 7,
      versions: [],
      currentVersion: 1,
      createdAt: 1,
    },
    version: {
      n: 1,
      headSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      baseRef: "main",
      fetchedAt: 1,
      idMapping: {},
    },
    files: [],
    description: {
      html,
      rev: "1",
      source: "pr",
      editable: true,
      ...extra,
    },
    ingest: { status: "ready" },
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as ReviewSnapshot;
}

const live: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (live.length > 0) await live.pop()!.close();
});

async function serveRegistry(snapshot: ReviewSnapshot): Promise<{ base: string; registry: McpRegistry }> {
  const store = { getSnapshot: (id: string) => (id === "rv_desc96" ? snapshot : null) } as ReviewStore;
  const reader = new StoreReviewReader({ reviews: store, dataDir: "/tmp" });
  const registry = new McpRegistry({ reader, commands: new FakeCommandRunner() });
  const { app } = await createApp("test-token", { mcp: registry });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as AddressInfo;
  live.push({ close: () => app.close() });
  return { base: `http://127.0.0.1:${addr.port}`, registry };
}

async function callTool(
  base: string,
  registry: McpRegistry,
  role: "session" | "second-opinion",
  name: string,
  args: Record<string, string>,
): Promise<string> {
  const issued: IssuedSession = registry.issueSession("rv_desc96", `s-${role}`, role);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + issued.path)));
  try {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
    };
    return res.content.map((c) => c.text).join("\n");
  } finally {
    await client.close();
  }
}

/** Ingest-assigned ID of the paragraph whose text contains `needle`. */
function ingestIdFor(needle: string): string {
  const rendered = renderMarkdownBlocks(BODY);
  const para = rendered.paragraphs.find((p) => p.text.includes(needle));
  if (!para) throw new Error(`no ingest paragraph contains ${needle}`);
  return para.id;
}

describe("issue #96: desc: IDs from the review tools", () => {
  it("search returns the IDs ingest assigned (heading + list do not shift them)", async () => {
    const rendered = renderMarkdownBlocks(BODY);
    const { base, registry } = await serveRegistry(snapshotFor(rendered.html));
    for (const needle of [
      "prototype link beta",
      "list item two delta",
      "after the list zeta",
      "code block eta",
      "at the end theta",
    ]) {
      const text = await callTool(base, registry, "session", "search_review", { query: needle });
      expect(text, `search for ${needle}`).toContain(`desc:${ingestIdFor(needle)}`);
    }
  });

  it("search IDs validate and resolve back to the same text", async () => {
    const rendered = renderMarkdownBlocks(BODY);
    const snapshot = snapshotFor(rendered.html);
    const { base, registry } = await serveRegistry(snapshot);
    for (const needle of ["prototype link beta", "list item two delta", "at the end theta"]) {
      const id = ingestIdFor(needle);
      const text = await callTool(base, registry, "session", "search_review", { query: needle });
      expect(text).toContain(`desc:${id}`);
      // The citation validator resolves the ID back to the paragraph text.
      const lookup = lookupForSnapshot(snapshot);
      expect(lookup.descParagraph(id), `validator descParagraph(${id})`).toContain(needle);
      // Second-opinion excerpts carry the same ID with the same text.
      const excerpts = await buildExcerptMap({ snapshot });
      const excerpt = excerpts.find((e) => e.id === `desc:${id}`);
      expect(excerpt, `excerpt desc:${id}`).toBeDefined();
      expect(excerpt!.text).toContain(needle);
    }
  });

  it("resolve returns the same desc: candidates as search", async () => {
    const rendered = renderMarkdownBlocks(BODY);
    const { base, registry } = await serveRegistry(snapshotFor(rendered.html));
    for (const needle of [
      "prototype link beta",
      "list item two delta",
      "after the list zeta",
      "code block eta",
      "at the end theta",
    ]) {
      const text = await callTool(base, registry, "session", "resolve", { description: needle });
      expect(text, `resolve for ${needle}`).toContain(`desc:${ingestIdFor(needle)}`);
    }
  });

  it("second-opinion restriction behaves for desc: in resolve exactly as in search", async () => {
    const rendered = renderMarkdownBlocks(BODY);
    const snapshot = snapshotFor(rendered.html);
    // A guide card containing the same query word: visible to session, hidden
    // from second-opinion in both tools.
    snapshot.pages = [
      {
        id: "root",
        kind: "root",
        title: "t",
        saved: false,
        cards: [
          {
            id: "c-central",
            pageId: "root",
            title: "Central change",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [],
            undoStack: [],
          },
        ],
      },
    ];
    const { base, registry } = await serveRegistry(snapshot);
    const needle = "prototype link beta";
    const id = ingestIdFor(needle);

    const sessSearch = await callTool(base, registry, "session", "search_review", { query: needle });
    const sessResolve = await callTool(base, registry, "session", "resolve", { description: needle });
    expect(sessSearch).toContain(`desc:${id}`);
    expect(sessResolve).toContain(`desc:${id}`);

    const soSearch = await callTool(base, registry, "second-opinion", "search_review", { query: needle });
    const soResolve = await callTool(base, registry, "second-opinion", "resolve", { description: needle });
    // Description is allowed for the role in both tools …
    expect(soSearch).toContain(`desc:${id}`);
    expect(soResolve).toContain(`desc:${id}`);
    // … while cards stay hidden in both tools.
    expect(soSearch).not.toContain("card:");
    expect(soResolve).not.toContain("card:");
  });

  it("an edited description (pendingHtml) still gives consistent IDs", async () => {
    const rendered = renderMarkdownBlocks(BODY);
    const id = ingestIdFor("after the list zeta");
    const editedHtml = rendered.html.replace("after the list zeta", "after the list ZETA-EDITED");
    const snapshot = snapshotFor(rendered.html, { pendingHtml: editedHtml });
    const { base, registry } = await serveRegistry(snapshot);
    const searchText = await callTool(base, registry, "session", "search_review", { query: "ZETA-EDITED" });
    expect(searchText).toContain(`desc:${id}`);
    const resolveText = await callTool(base, registry, "session", "resolve", { description: "ZETA-EDITED" });
    expect(resolveText).toContain(`desc:${id}`);
    const lookup = lookupForSnapshot(snapshot);
    expect(lookup.descParagraph(id)).toContain("ZETA-EDITED");
  });
});

