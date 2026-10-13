/**
 * MCP tool definitions (PRD §10).
 *
 * Descriptions + input schemas are frozen constants: they are part of the
 * cached prefix (L0), so they must be byte-stable across releases. The
 * golden test `test/mcp.test.ts` ("tool surface is byte-stable") fails on
 * any change; update it deliberately, never incidentally.
 */

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    additionalProperties: false;
  };
}

const GET_HUNK: McpToolDef = {
  name: "get_hunk",
  description:
    "Return one diff hunk by its h: ID (h:<fileKey>:<contentHash>). " +
    "Output starts with the hunk ID and file header, then the hunk text " +
    "with the new-side line number on every line.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Hunk ID, e.g. h:conn:9f2c." },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

const GET_CODE: McpToolDef = {
  name: "get_code",
  description:
    "Return lines of a file at a commit (default: the review head). " +
    "Output starts with a code: ID, then the requested lines with line " +
    "numbers. Paths must stay inside the repo; anything else is refused.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative file path." },
      lines: { type: "string", description: 'Line range, e.g. "10-20" or "10".' },
      sha: { type: "string", description: "Commit SHA (default: review head)." },
    },
    required: ["path", "lines"],
    additionalProperties: false,
  },
};

const SEARCH_REVIEW: McpToolDef = {
  name: "search_review",
  description:
    "Substring search over this review: guide cards, annotations, " +
    "contributions and the PR description paragraphs. Returns matching " +
    "items with IDs (description hits are desc: IDs). The second-opinion " +
    "role searches only the description.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Case-insensitive substring." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const RESOLVE: McpToolDef = {
  name: "resolve",
  description:
    "Map a natural-language location description (file path, line " +
    "numbers, quoted code, card title, description text) to candidate IDs " +
    "in this review (h:, card: and desc: IDs). The second-opinion role " +
    "gets h: and desc: IDs only, never card: IDs.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Where the agent means." },
    },
    required: ["description"],
    additionalProperties: false,
  },
};

const PIN_CONTEXT: McpToolDef = {
  name: "pin_context",
  description:
    "Pin code into the review context for later turns (reader session " +
    "only). Records path, lines and why; the app refetches it when the " +
    "base is built.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative file path." },
      lines: { type: "string", description: 'Line range, e.g. "10-20" or "10".' },
      why: { type: "string", description: "Why this code matters." },
    },
    required: ["path", "lines", "why"],
    additionalProperties: false,
  },
};

/** Tools every session gets (PRD §10). */
export const COMMON_TOOLS: readonly McpToolDef[] = Object.freeze([
  GET_HUNK,
  GET_CODE,
  SEARCH_REVIEW,
  RESOLVE,
]);

/** Extra tool only the reader session gets (PRD §11.2). */
export const READER_TOOL: McpToolDef = PIN_CONTEXT;

/** Full ordered surface for a role; the golden test pins this JSON. */
export function toolsForRole(role: string): McpToolDef[] {
  if (role === "reader") return [...COMMON_TOOLS, READER_TOOL];
  return [...COMMON_TOOLS];
}

/** Canonical JSON of the tool surface (what L0 caches). */
export function stableToolSpec(): string {
  return JSON.stringify({ common: COMMON_TOOLS, reader: READER_TOOL });
}
