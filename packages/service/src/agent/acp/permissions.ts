/**
 * Permission policy: deny-by-default, allowlist our MCP tools + read-only
 * file tools.
 *
 * Observed wire shapes (spike):
 * - Claude MCP call: title `mcp__<server>__<tool>` with options
 *   allow_once / allow_always / reject_once.
 * - Codex in `agent` mode executed the MCP call with ZERO permission
 *   round-trips, so the handler alone cannot gate MCP on Codex (mode +
 *   sandbox do that; see runner read-only handling).
 *
 * Policy:
 * - allow: titles starting with `mcp__<server>__` for a server in this
 *   session's allowlist (answer `allow_once`, never `allow_always` so every
 *   call re-prompts and stays auditable), plus read-only file tools.
 * - deny: everything else (edits, shell, network, subagents, terminals).
 *   Prefer an explicit reject/deny option; else answer `cancelled`.
 */

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionQuery {
  sessionId: string;
  toolCallId: string;
  /** e.g. "mcp__unvibe__get_hunk", "Read", "Bash" */
  title: string;
  /** programmatic tool name when the adapter sends one */
  name?: string;
  options: PermissionOption[];
  /** Codex marks MCP tool approvals with `_meta.is_mcp_tool_approval`. */
  mcpApproval?: boolean;
}

export type PermissionDecision =
  | { type: "allow"; optionId: string }
  | { type: "deny"; optionId?: string };

/** Read-only file tools known across both adapters. */
const READ_ONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "read_file",
  "glob_files",
  "grep_files",
  "search",
]);

function normTool(s: string): string {
  return s.toLowerCase().replace(/^mcp[._]+[^_.]+[._]+/, "");
}

/** True when the title is one of our MCP server's tools. */
export function isOurMcpTool(title: string, name: string | undefined, servers: readonly string[]): boolean {
  const candidates = [title, name ?? ""].filter(Boolean);
  for (const c of candidates) {
    // Adapter spellings: Claude `mcp__<server>__<tool>`, Codex
    // `mcp.<server>.<tool>` (dots). Normalize separators before matching.
    if (!/^mcp[._]/i.test(c)) continue;
    const norm = c.toLowerCase().replace(/[._-]+/g, "_");
    if (!norm.startsWith("mcp_")) continue;
    for (const s of servers) {
      const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (norm.startsWith(`mcp_${slug}_`)) return true;
    }
    // Unknown mcp tool from another server: still an MCP tool, but NOT ours.
    return false;
  }
  return false;
}

function isReadOnlyFileTool(title: string, name: string | undefined): boolean {
  for (const c of [title, name ?? ""].filter(Boolean)) {
    // Bare tool names ("Read", "Glob", "Grep") and namespaced variants.
    const base = normTool(c).replace(/[^a-z]/g, "");
    if (READ_ONLY_TOOLS.has(c.toLowerCase()) || READ_ONLY_TOOLS.has(base)) return true;
    if (/^(read|glob|grep)/i.test(c) && !/write|edit|exec|bash|shell/i.test(c)) {
      // Conservative: only exact-known prefixes without write/exec markers.
      if (/^(read|glob|grep)[^a-z]*$/i.test(c)) return true;
    }
  }
  return false;
}

/**
 * Decide a permission request.
 *
 * - Lock-down (`readOnly: true`): allow only our MCP tools + read-only
 *   file tools; deny everything else (edits, shell, network, subagents,
 *   terminals). Unvibe agents must only read code and call our MCP tools.
 * - Full access (`readOnly: false`, issue #160): allow everything the
 *   adapter asks about. The limits live only as instructions in the
 *   system prompt — nothing here enforces them.
 */
export function decidePermission(
  query: PermissionQuery,
  opts: { mcpServers: readonly string[]; readOnly: boolean },
): PermissionDecision {
  if (!opts.readOnly) {
    const opt = query.options.find((o) => o.kind === "allow_once") ??
      query.options.find((o) => /^allow/i.test(o.kind));
    if (opt) return { type: "allow", optionId: opt.optionId };
    return { type: "deny" }; // no allow option offered: cancel below
  }
  // Identity is title/name based (recovered via toolCallId correlation when
  // the adapter sends an empty toolCall, as Codex does in workspace-write).
  // The `mcpApproval` flag is supporting evidence only: an MCP approval for
  // an unrecognized tool (another server) is still denied.
  const allow = isOurMcpTool(query.title, query.name, opts.mcpServers) ||
    isReadOnlyFileTool(query.title, query.name);
  if (allow) {
    const opt = query.options.find((o) => o.kind === "allow_once") ??
      query.options.find((o) => /^allow/i.test(o.kind));
    if (opt) return { type: "allow", optionId: opt.optionId };
    return { type: "deny" }; // no allow option offered: cancel below
  }
  const deny = query.options.find((o) => /reject|deny/i.test(o.kind));
  if (deny) return { type: "deny", optionId: deny.optionId };
  return { type: "deny" };
}

/** Map a decision to the ACP RequestPermissionResponse outcome. */
export function decisionToOutcome(decision: PermissionDecision):
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string } {
  if (decision.type === "allow") return { outcome: "selected", optionId: decision.optionId };
  if (decision.optionId) return { outcome: "selected", optionId: decision.optionId };
  return { outcome: "cancelled" };
}
