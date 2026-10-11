/**
 * JSON diagram spec (replaces Mermaid; PRD §13/§19.4).
 *
 * Pure, no dependencies (imports only the ID grammar for `cite` checks):
 * runs service-side (Node) for validation and in the browser for rendering.
 *
 * A diagram is a JSON object in a fenced `diagram` block:
 *
 * {
 *   "version": 1,
 *   "kind": "flow" | "panels" | "sequence",
 *   "title": "Header data flow",
 *   "direction": "LR" | "TB",           // flow only, default LR
 *   "nodes": [                          // flow only
 *     { "id": "srv", "title": "Server", "sub": "folded header",
 *       "state": "default"|"ok"|"bad"|"neutral",
 *       "cite": "diff:conn:80-88", "col": 0, "row": 0 }
 *   ],
 *   "edges": [                          // flow only
 *     { "from": "srv", "to": "cli", "label": "new dict",
 *       "cite": "diff:conn:650-651" }
 *   ],
 *   "panels": [                         // panels only, exactly 2 (before/after)
 *     { "title": "On the wire", "lines": ["Set-Cookie: a=1; path=/",
 *        "    Max-Age=900"], "state": "bad", "cite": "diff:tconn:220",
 *       "note": "the fold: …" }
 *   ],
 *   "actors": ["Client", "pool", ...],  // sequence only
 *   "messages": [                       // sequence only
 *     { "from": 0, "to": 1, "label": "request()", "cite": "diff:conn:91-110" }
 *   ]
 * }
 *
 * Rules: ids match /^[a-z][a-z0-9-]*$/; cites are link-token payloads
 * (`diff:…`, `code:…`, `desc:…`, `h:…`) WITHOUT the surrounding [[…]] —
 * the reply parser lifts them into the block's citations, and the existing
 * citation validator checks them. Caps: ≤12 nodes, ≤16 edges, ≤2 panels,
 * ≤6 actors, ≤16 messages; node titles ≤48 chars, subs/labels/lines ≤80.
 * Unknown fields are rejected with a message suitable for a repair prompt.
 */
import { parseId } from "../ids.js";

export type DiagramState = "default" | "ok" | "bad" | "neutral";
export type DiagramKind = "flow" | "panels" | "sequence";
export type DiagramDirection = "LR" | "TB";

export interface DiagramFlowNode {
  id: string;
  title: string;
  sub?: string;
  state?: DiagramState;
  cite?: string;
  col?: number;
  row?: number;
}

export interface DiagramFlowEdge {
  from: string;
  to: string;
  label?: string;
  cite?: string;
}

export interface DiagramPanel {
  title: string;
  lines: string[];
  state?: DiagramState;
  cite?: string;
  note?: string;
}

export interface DiagramMessage {
  from: number;
  to: number;
  label: string;
  cite?: string;
}

export interface DiagramSpec {
  version: 1;
  kind: DiagramKind;
  title: string;
  direction?: DiagramDirection;
  nodes?: DiagramFlowNode[];
  edges?: DiagramFlowEdge[];
  panels?: DiagramPanel[];
  actors?: string[];
  messages?: DiagramMessage[];
}

export interface DiagramValidation {
  ok: boolean;
  errors: string[];
  cites: string[];
}

const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const STATES: ReadonlySet<string> = new Set(["default", "ok", "bad", "neutral"]);
const CITE_KINDS: ReadonlySet<string> = new Set(["diff", "code", "desc", "h"]);

export const DIAGRAM_LIMITS = {
  nodes: 12,
  edges: 16,
  panels: 2,
  actors: 6,
  messages: 16,
  title: 120,
  nodeTitle: 48,
  sub: 80,
  label: 80,
  line: 80,
  linesPerPanel: 6,
  colMax: 5,
} as const;

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function unknownFields(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

const TOP_ALLOWED: Record<string, ReadonlySet<string>> = {
  flow: new Set(["version", "kind", "title", "direction", "nodes", "edges"]),
  panels: new Set(["version", "kind", "title", "panels"]),
  sequence: new Set(["version", "kind", "title", "actors", "messages"]),
};
const NODE_ALLOWED = new Set(["id", "title", "sub", "state", "cite", "col", "row"]);
const EDGE_ALLOWED = new Set(["from", "to", "label", "cite"]);
const PANEL_ALLOWED = new Set(["title", "lines", "state", "cite", "note"]);
const MSG_ALLOWED = new Set(["from", "to", "label", "cite"]);

/**
 * Validate a parsed diagram value service-side (no DOM, no deps).
 * `cite` fields are checked against the shared ID grammar (same as
 * everywhere else); range-against-hunk checks happen in the citation
 * validator, not here.
 */
export function validateDiagram(d: unknown): DiagramValidation {
  const errors: string[] = [];
  const cites: string[] = [];

  const pushCite = (c: unknown, where: string): void => {
    if (!isStr(c) || !c) {
      errors.push(`${where}: cite must be a non-empty string`);
      return;
    }
    const parsed = parseId(c);
    if (parsed === null || !CITE_KINDS.has(parsed.kind)) {
      errors.push(`${where}: bad cite ${JSON.stringify(c)} (want diff:<fileKey>:<lines>, code:<path>:<lines>, desc:<id> or h:<fileKey>:<hash>)`);
      return;
    }
    cites.push(c);
  };

  if (typeof d !== "object" || d === null || Array.isArray(d)) {
    return { ok: false, errors: ["diagram must be an object"], cites };
  }
  const obj = d as Record<string, unknown>;

  // Parser sentinel for a fence whose JSON did not parse: surface the
  // syntax error directly so the repair turn sees it.
  if (isStr(obj["__parseError"])) {
    return { ok: false, errors: [`invalid JSON: ${obj["__parseError"]}`], cites };
  }

  const { version, kind, title, direction, nodes, edges, panels, actors, messages } = obj;

  if (version !== 1) errors.push("version must be 1");
  if (kind !== "flow" && kind !== "panels" && kind !== "sequence") {
    return { ok: false, errors: ["kind must be flow|panels|sequence"], cites };
  }

  const allowed = TOP_ALLOWED[kind];
  for (const k of unknownFields(obj, allowed)) {
    errors.push(`unknown field ${JSON.stringify(k)} for kind ${kind}`);
  }

  if (!isStr(title) || !title.trim() || title.length > DIAGRAM_LIMITS.title) {
    errors.push(`title must be 1..${DIAGRAM_LIMITS.title} chars of plain text`);
  } else if (/[[\]]/.test(title)) {
    errors.push("title must be plain text (no [[tokens]])");
  }

  if (kind === "flow") {
    if (direction !== undefined && direction !== "LR" && direction !== "TB") {
      errors.push("direction must be LR|TB");
    }
    if (!Array.isArray(nodes) || nodes.length === 0) errors.push("flow needs nodes[] with at least 1 node");
    if (!Array.isArray(edges)) errors.push("flow needs edges[]");
    const seen = new Set<string>();
    for (const n of (nodes as unknown[]) ?? []) {
      if (typeof n !== "object" || n === null || Array.isArray(n)) {
        errors.push("node must be an object");
        continue;
      }
      const no = n as Record<string, unknown>;
      const where = `node ${JSON.stringify(no["id"])}`;
      for (const k of unknownFields(no, NODE_ALLOWED)) {
        errors.push(`${where}: unknown field ${JSON.stringify(k)}`);
      }
      if (!isStr(no["id"]) || !ID_RE.test(no["id"])) errors.push(`${where}: bad id (want /^[a-z][a-z0-9-]*$/, ≤24 chars)`);
      else if (seen.has(no["id"])) errors.push(`${where}: duplicate id`);
      else seen.add(no["id"]);
      if (!isStr(no["title"]) || !no["title"].trim() || (no["title"] as string).length > DIAGRAM_LIMITS.nodeTitle) {
        errors.push(`${where}: title 1..${DIAGRAM_LIMITS.nodeTitle} chars`);
      } else if (/[[\]]/.test(no["title"] as string)) {
        errors.push(`${where}: title must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (no["sub"] !== undefined && (!isStr(no["sub"]) || (no["sub"] as string).length > DIAGRAM_LIMITS.sub)) {
        errors.push(`${where}: sub ≤${DIAGRAM_LIMITS.sub} chars`);
      } else if (isStr(no["sub"]) && /[[\]]/.test(no["sub"])) {
        errors.push(`${where}: sub must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (no["state"] !== undefined && (!isStr(no["state"]) || !STATES.has(no["state"]))) {
        errors.push(`${where}: state must be default|ok|bad|neutral`);
      }
      if (no["cite"] !== undefined) pushCite(no["cite"], where);
      for (const hk of ["col", "row"] as const) {
        if (no[hk] !== undefined && (!Number.isInteger(no[hk]) || (no[hk] as number) < 0 || (no[hk] as number) > DIAGRAM_LIMITS.colMax)) {
          errors.push(`${where}: ${hk} must be 0..${DIAGRAM_LIMITS.colMax}`);
        }
      }
    }
    if (Array.isArray(nodes) && nodes.length > DIAGRAM_LIMITS.nodes) {
      errors.push(`≤${DIAGRAM_LIMITS.nodes} nodes (got ${nodes.length})`);
    }
    for (const e of (edges as unknown[]) ?? []) {
      if (typeof e !== "object" || e === null || Array.isArray(e)) {
        errors.push("edge must be an object");
        continue;
      }
      const eo = e as Record<string, unknown>;
      const where = `edge ${JSON.stringify(eo["from"])}->${JSON.stringify(eo["to"])}`;
      for (const k of unknownFields(eo, EDGE_ALLOWED)) {
        errors.push(`${where}: unknown field ${JSON.stringify(k)}`);
      }
      if (!isStr(eo["from"]) || !isStr(eo["to"]) || !seen.has(eo["from"]) || !seen.has(eo["to"])) {
        errors.push(`${where}: unknown endpoint (from/to must be node ids)`);
      }
      if (eo["from"] === eo["to"]) errors.push(`${where}: self-edge`);
      if (eo["label"] !== undefined && (!isStr(eo["label"]) || (eo["label"] as string).length > DIAGRAM_LIMITS.label)) {
        errors.push(`${where}: label ≤${DIAGRAM_LIMITS.label} chars`);
      } else if (isStr(eo["label"]) && /[[\]]/.test(eo["label"])) {
        errors.push(`${where}: label must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (eo["cite"] !== undefined) pushCite(eo["cite"], where);
    }
    if (Array.isArray(edges) && edges.length > DIAGRAM_LIMITS.edges) {
      errors.push(`≤${DIAGRAM_LIMITS.edges} edges (got ${edges.length})`);
    }
  }

  if (kind === "panels") {
    if (!Array.isArray(panels) || panels.length !== DIAGRAM_LIMITS.panels) {
      errors.push(`panels needs exactly ${DIAGRAM_LIMITS.panels} panels (before/after)`);
    }
    for (const p of (panels as unknown[]) ?? []) {
      if (typeof p !== "object" || p === null || Array.isArray(p)) {
        errors.push("panel must be an object");
        continue;
      }
      const po = p as Record<string, unknown>;
      const where = `panel ${JSON.stringify(po["title"])}`;
      for (const k of unknownFields(po, PANEL_ALLOWED)) {
        errors.push(`${where}: unknown field ${JSON.stringify(k)}`);
      }
      if (!isStr(po["title"]) || !po["title"].trim() || (po["title"] as string).length > DIAGRAM_LIMITS.nodeTitle) {
        errors.push(`${where}: title 1..${DIAGRAM_LIMITS.nodeTitle} chars`);
      } else if (/[[\]]/.test(po["title"] as string)) {
        errors.push(`${where}: title must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (!Array.isArray(po["lines"]) || (po["lines"] as unknown[]).length === 0 || (po["lines"] as unknown[]).length > DIAGRAM_LIMITS.linesPerPanel) {
        errors.push(`${where}: 1..${DIAGRAM_LIMITS.linesPerPanel} lines`);
      }
      for (const ln of (po["lines"] as unknown[]) ?? []) {
        if (!isStr(ln) || ln.length > DIAGRAM_LIMITS.line) errors.push(`${where}: line ≤${DIAGRAM_LIMITS.line} chars`);
        else if (/[[\]]/.test(ln)) errors.push(`${where}: lines must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (po["state"] !== undefined && (!isStr(po["state"]) || !STATES.has(po["state"]))) {
        errors.push(`${where}: state must be default|ok|bad|neutral`);
      }
      if (po["cite"] !== undefined) pushCite(po["cite"], where);
      if (po["note"] !== undefined && (!isStr(po["note"]) || (po["note"] as string).length > DIAGRAM_LIMITS.label)) {
        errors.push(`${where}: note ≤${DIAGRAM_LIMITS.label} chars`);
      } else if (isStr(po["note"]) && /[[\]]/.test(po["note"])) {
        errors.push(`${where}: note must be plain text (no [[tokens]]; put citations in cite)`);
      }
    }
  }

  if (kind === "sequence") {
    if (!Array.isArray(actors) || actors.length < 2 || actors.length > DIAGRAM_LIMITS.actors) {
      errors.push(`sequence needs 2..${DIAGRAM_LIMITS.actors} actors`);
    }
    for (const a of (actors as unknown[]) ?? []) {
      if (!isStr(a) || !a.trim() || a.length > DIAGRAM_LIMITS.nodeTitle) {
        errors.push(`actor ${JSON.stringify(a)}: 1..${DIAGRAM_LIMITS.nodeTitle} chars of plain text`);
      } else if (/[[\]]/.test(a)) {
        errors.push(`actor ${JSON.stringify(a)}: must be plain text (no [[tokens]])`);
      }
    }
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > DIAGRAM_LIMITS.messages) {
      errors.push(`sequence needs 1..${DIAGRAM_LIMITS.messages} messages`);
    }
    for (const m of (messages as unknown[]) ?? []) {
      if (typeof m !== "object" || m === null || Array.isArray(m)) {
        errors.push("message must be an object");
        continue;
      }
      const mo = m as Record<string, unknown>;
      for (const k of unknownFields(mo, MSG_ALLOWED)) {
        errors.push(`message ${JSON.stringify(mo["label"])}: unknown field ${JSON.stringify(k)}`);
      }
      const n = Array.isArray(actors) ? actors.length : 0;
      if (!Number.isInteger(mo["from"]) || !Number.isInteger(mo["to"]) || (mo["from"] as number) < 0 || (mo["to"] as number) < 0 || (mo["from"] as number) >= n || (mo["to"] as number) >= n) {
        errors.push(`message ${JSON.stringify(mo["label"])}: from/to must be actor indexes 0..${Math.max(0, n - 1)}`);
      }
      if (mo["from"] === mo["to"]) errors.push(`message ${JSON.stringify(mo["label"])}: self-message`);
      if (!isStr(mo["label"]) || !mo["label"].trim() || (mo["label"] as string).length > DIAGRAM_LIMITS.label) {
        errors.push(`message label 1..${DIAGRAM_LIMITS.label} chars`);
      } else if (/[[\]]/.test(mo["label"] as string)) {
        errors.push(`message ${JSON.stringify(mo["label"])}: label must be plain text (no [[tokens]]; put citations in cite)`);
      }
      if (mo["cite"] !== undefined) pushCite(mo["cite"], "message");
    }
  }

  return { ok: errors.length === 0, errors, cites };
}

/** Every `cite` in a spec, in document order (for lifting into citations). */
export function diagramCites(spec: DiagramSpec): string[] {
  const v = validateDiagram(spec);
  return v.cites;
}

/** One-line problem summary for the repair prompt. */
export function diagramProblem(spec: unknown): string {
  const v = validateDiagram(spec);
  if (v.ok) return "the diagram is valid";
  return v.errors[0] ?? "invalid diagram";
}
