/**
 * Candidate B: minimal JSON diagram spec (spike).
 *
 * Covers the two prototype reference diagrams (flow with six boxes, panels
 * before/after) plus a sequence form for call flows. Pure ESM, zero
 * dependencies — the same code can run service-side (Node) for validation
 * and in the browser for rendering.
 *
 * A diagram is a JSON object:
 *
 * {
 *   "version": 1,                       // must be 1
 *   "kind": "flow" | "panels" | "sequence",
 *   "title": "Header data flow",        // plain text, aria-label
 *   "direction": "LR" | "TB",           // flow only, default LR
 *   "nodes": [                          // flow only
 *     { "id": "srv", "title": "Server", "sub": "folded header",
 *       "state": "default"|"ok"|"bad", "cite": "diff:conn:80-88", "col": 0 }
 *   ],
 *   "edges": [                          // flow only
 *     { "from": "srv", "to": "cli", "label": "new dict",
 *       "cite": "diff:conn:650-651" }
 *   ],
 *   "panels": [                         // panels only (before/after)
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
 * (`diff:<fileKey>:<lines>`, `code:…`, `desc:…`, `h:…`) WITHOUT the
 * surrounding [[…]] — the reply parser adds brackets when extracting, and
 * the existing citation validator checks them. Caps: ≤12 nodes, ≤16 edges,
 * ≤4 panels, ≤6 actors, ≤16 messages; titles ≤48 chars, subs/labels ≤80.
 */

/** Link-token payload kinds the diagram `cite` field accepts. */
export const CITE_KINDS = new Set(["diff", "code", "desc", "h"]);

// Tight ranges only: fileKey chars, then lines like 80, 80-88, 80-88@sha.
const CITE_RE = /^(diff|code|desc|h):[A-Za-z0-9_./-]+:[A-Za-z0-9_.-]+(@[0-9a-f]{4,40})?$/;
const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const LIMITS = {
  nodes: 12,
  edges: 16,
  panels: 4,
  actors: 6,
  messages: 16,
  title: 48,
  sub: 80,
  label: 80,
  line: 80,
  linesPerPanel: 6,
};

function isStr(v) {
  return typeof v === "string";
}

/**
 * Validate a parsed diagram value service-side (no DOM, no deps).
 * @param {unknown} d
 * @returns {{ ok: boolean, errors: string[], cites: string[] }}
 */
export function validateDiagram(d) {
  const errors = [];
  const cites = [];
  const pushCite = (c, where) => {
    if (!isStr(c) || !c) {
      errors.push(`${where}: cite must be a non-empty string`);
      return;
    }
    if (!CITE_RE.test(c)) {
      errors.push(`${where}: bad cite ${JSON.stringify(c)}`);
      return;
    }
    const kind = c.split(":")[0];
    if (!CITE_KINDS.has(kind)) errors.push(`${where}: cite kind ${kind} not allowed`);
    else cites.push(c);
  };
  if (typeof d !== "object" || d === null || Array.isArray(d)) {
    return { ok: false, errors: ["diagram must be an object"], cites };
  }
  const { version, kind, title, direction, nodes, edges, panels, actors, messages } = d;
  if (version !== 1) errors.push("version must be 1");
  if (!["flow", "panels", "sequence"].includes(kind)) {
    return { ok: false, errors: [`kind must be flow|panels|sequence`], cites };
  }
  if (!isStr(title) || !title.trim() || title.length > 120) {
    errors.push("title must be 1..120 chars of plain text");
  } else if (/[[\]]/.test(title)) errors.push("title must be plain text (no tokens)");
  if (kind === "flow") {
    if (direction !== undefined && direction !== "LR" && direction !== "TB") {
      errors.push("direction must be LR|TB");
    }
    if (!Array.isArray(nodes) || nodes.length === 0) errors.push("flow needs nodes[]");
    if (!Array.isArray(edges)) errors.push("flow needs edges[]");
    const seen = new Set();
    for (const n of nodes ?? []) {
      if (typeof n !== "object" || n === null) {
        errors.push("node must be an object");
        continue;
      }
      const where = `node ${JSON.stringify(n.id)}`;
      if (!isStr(n.id) || !ID_RE.test(n.id)) errors.push(`${where}: bad id`);
      else if (seen.has(n.id)) errors.push(`${where}: duplicate id`);
      else seen.add(n.id);
      if (!isStr(n.title) || !n.title.trim() || n.title.length > LIMITS.title) {
        errors.push(`${where}: title 1..${LIMITS.title} chars`);
      } else if (/[[\]]/.test(n.title)) errors.push(`${where}: title must be plain text`);
      if (n.sub !== undefined && (!isStr(n.sub) || n.sub.length > LIMITS.sub)) {
        errors.push(`${where}: sub ≤${LIMITS.sub} chars`);
      }
      if (n.state !== undefined && !["default", "ok", "bad"].includes(n.state)) {
        errors.push(`${where}: state must be default|ok|bad`);
      }
      if (ncite(n) !== undefined) pushCite(n.cite, where);
      if (n.col !== undefined && (!Number.isInteger(n.col) || n.col < 0 || n.col > 5)) {
        errors.push(`${where}: col must be 0..5`);
      }
    }
    if ((nodes ?? []).length > LIMITS.nodes) errors.push(`≤${LIMITS.nodes} nodes`);
    for (const e of edges ?? []) {
      if (typeof e !== "object" || e === null) {
        errors.push("edge must be an object");
        continue;
      }
      const where = `edge ${JSON.stringify(e.from)}->${JSON.stringify(e.to)}`;
      if (!seen.has(e.from) || !seen.has(e.to)) errors.push(`${where}: unknown endpoint`);
      if (e.from === e.to) errors.push(`${where}: self-edge`);
      if (e.label !== undefined && (!isStr(e.label) || e.label.length > LIMITS.label)) {
        errors.push(`${where}: label ≤${LIMITS.label} chars`);
      }
      if (ncite(e) !== undefined) pushCite(e.cite, where);
    }
    if ((edges ?? []).length > LIMITS.edges) errors.push(`≤${LIMITS.edges} edges`);
  }
  if (kind === "panels") {
    if (!Array.isArray(panels) || panels.length !== 2) {
      errors.push("panels needs exactly 2 panels");
    }
    for (const p of panels ?? []) {
      if (typeof p !== "object" || p === null) {
        errors.push("panel must be an object");
        continue;
      }
      const where = `panel ${JSON.stringify(p.title)}`;
      if (!isStr(p.title) || !p.title.trim()) errors.push(`${where}: title required`);
      if (!Array.isArray(p.lines) || p.lines.length === 0 || p.lines.length > LIMITS.linesPerPanel) {
        errors.push(`${where}: 1..${LIMITS.linesPerPanel} lines`);
      }
      for (const ln of p.lines ?? []) {
        if (!isStr(ln) || ln.length > LIMITS.line) errors.push(`${where}: line ≤${LIMITS.line} chars`);
      }
      if (p.state !== undefined && !["default", "ok", "bad"].includes(p.state)) {
        errors.push(`${where}: state must be default|ok|bad`);
      }
      if (ncite(p) !== undefined) pushCite(p.cite, where);
      if (p.note !== undefined && (!isStr(p.note) || p.note.length > LIMITS.label)) {
        errors.push(`${where}: note ≤${LIMITS.label} chars`);
      }
    }
    if ((panels ?? []).length > LIMITS.panels) errors.push(`≤${LIMITS.panels} panels`);
  }
  if (kind === "sequence") {
    if (!Array.isArray(actors) || actors.length < 2 || actors.length > LIMITS.actors) {
      errors.push(`sequence needs 2..${LIMITS.actors} actors`);
    }
    for (const a of actors ?? []) {
      if (!isStr(a) || !a.trim() || a.length > LIMITS.title) {
        errors.push(`actor ${JSON.stringify(a)}: 1..${LIMITS.title} chars`);
      }
    }
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > LIMITS.messages) {
      errors.push(`sequence needs 1..${LIMITS.messages} messages`);
    }
    for (const m of messages ?? []) {
      if (typeof m !== "object" || m === null) {
        errors.push("message must be an object");
        continue;
      }
      const n = (actors ?? []).length;
      if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.from < 0 || m.to < 0 || m.from >= n || m.to >= n) {
        errors.push(`message ${JSON.stringify(m.label)}: from/to must be actor indexes`);
      }
      if (m.from === m.to) errors.push(`message ${JSON.stringify(m.label)}: self-message`);
      if (!isStr(m.label) || !m.label.trim() || m.label.length > LIMITS.label) {
        errors.push(`message label 1..${LIMITS.label} chars`);
      }
      if (ncite(m) !== undefined) pushCite(m.cite, "message");
    }
  }
  return { ok: errors.length === 0, errors, cites };
}

function ncite(o) {
  return o.cite;
}

/**
 * Extract a ```diagram-json fenced block from a reply body (agent output).
 * @param {string} body
 * @returns {{ jsonText: string } | { error: string }}
 */
export function extractDiagramBlock(body) {
  const m = body.match(/```diagram-json\s*\n([\s\S]*?)```/);
  if (!m) return { error: "no ```diagram-json block" };
  return { jsonText: m[1].trim() };
}
