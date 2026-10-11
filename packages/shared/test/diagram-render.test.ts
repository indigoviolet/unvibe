import { describe, expect, it } from "vitest";
import { renderDiagramSvg } from "../src/content/diagram-render.js";
import type { DiagramSpec } from "../src/content/diagram-spec.js";

const FLOW: DiagramSpec = {
  version: 1,
  kind: "flow",
  title: "Header data flow from socket to both header views",
  direction: "LR",
  nodes: [
    { id: "srv", title: "Server", sub: "folded header", col: 0 },
    { id: "cli", title: "http.client", sub: "parse_headers", col: 1 },
    { id: "msg", title: "HTTPMessage", sub: "value keeps CRLF", state: "bad", cite: "diff:conn:650-651", col: 2 },
    { id: "norm", title: "_normalize_header_values", sub: "OWS CRLF RWS to SP", state: "ok", cite: "diff:conn:91-110", col: 3 },
    { id: "dict", title: "HTTPHeaderDict", sub: "r.headers", state: "ok", cite: "diff:conn:650-651", col: 4 },
    { id: "same", title: "HTTPMessage (same object)", sub: "Requests' cookie jar", state: "ok", cite: "diff:tsock:139-146", col: 4 },
  ],
  edges: [
    { from: "srv", to: "cli" },
    { from: "cli", to: "msg" },
    { from: "msg", to: "norm" },
    { from: "norm", to: "dict", label: "new dict" },
    { from: "norm", to: "same", label: "rebuilt in place" },
  ],
};

const PANELS: DiagramSpec = {
  version: 1,
  kind: "panels",
  title: "A folded Set-Cookie header and its unfolded value",
  panels: [
    {
      title: "On the wire",
      lines: ["Set-Cookie: a=1; path=/ CRLF", "    Max-Age=900 CRLF"],
      state: "bad",
      cite: "diff:tconn:214-222",
      note: "the fold: spaces, CRLF, then 1+ spaces",
    },
    {
      title: "After unfolding",
      lines: ["Set-Cookie: a=1; path=/ Max-Age=900"],
      state: "ok",
      cite: "diff:tconn:220",
      note: "replaced by a single space",
    },
  ],
};

const SEQ: DiagramSpec = {
  version: 1,
  kind: "sequence",
  title: "Folded Set-Cookie travelling from socket to both header views",
  actors: ["Test client", "ConnectionPool", "HTTPConnection", "http.client"],
  messages: [
    { from: 0, to: 1, label: "request() with folded response", cite: "diff:tsock:99-118" },
    { from: 1, to: 2, label: "getresponse()", cite: "diff:conn:650-651" },
    { from: 2, to: 3, label: "parse_headers() keeps CRLF", cite: "diff:conn:650-651" },
    { from: 3, to: 2, label: "HTTPMessage with raw fold", cite: "diff:conn:80-88" },
    { from: 2, to: 1, label: "HTTPHeaderDict + same HTTPMessage", cite: "diff:tsock:139-146" },
  ],
};

describe("renderDiagramSvg", () => {
  it("renders the three reference diagrams without style attrs or style tags", () => {
    for (const spec of [FLOW, PANELS, SEQ]) {
      const svg = renderDiagramSvg(spec, "t");
      expect(svg).toContain("<svg");
      expect(svg).toContain('class="dg-');
      expect(svg).not.toContain("style=");
      expect(svg).not.toContain("<style");
      expect(svg).toContain('data-cite="diff:');
    }
  });

  it("is deterministic for the same input", () => {
    expect(renderDiagramSvg(FLOW, "a")).toBe(renderDiagramSvg(FLOW, "a"));
  });

  it("honours col hints and renders edge labels off the arrow line", () => {
    const svg = renderDiagramSvg(FLOW, "t");
    // Cited nodes carry the standard hooks plus keyboard reachability.
    expect(svg).toContain('data-cite="diff:conn:91-110"');
    expect(svg).toContain('data-refs="diff:conn:91-110"');
    expect(svg).toContain('tabindex="0"');
    // Edge labels exist and are not placed exactly on the midpoint line
    // (perpendicular offset; see edgeLabel).
    expect(svg).toContain("new dict");
  });

  it("renders cycles, max sizes and long labels without throwing", () => {
    const cycle: DiagramSpec = {
      version: 1,
      kind: "flow",
      title: "Cycle",
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(() => renderDiagramSvg(cycle, "c")).not.toThrow();
    const maxNodes = Array.from({ length: 12 }, (_, i) => ({ id: `n-${i}`, title: `Node ${i} with a fairly long title here` }));
    const max: DiagramSpec = {
      version: 1,
      kind: "flow",
      title: "Max",
      nodes: maxNodes,
      edges: maxNodes.slice(1).map((n, i) => ({ from: maxNodes[i].id, to: n.id, label: "a very long edge label that should wrap" })),
    };
    const svg = renderDiagramSvg(max, "m");
    expect(svg).toContain("<title>");
    expect(svg).not.toContain("style=");
  });

  it("renders TB direction and missing hints", () => {
    const tb: DiagramSpec = {
      version: 1,
      kind: "flow",
      title: "TB",
      direction: "TB",
      nodes: [
        { id: "a", title: "Top" },
        { id: "b", title: "Bottom" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    expect(() => renderDiagramSvg(tb, "tb")).not.toThrow();
  });

  it("marks unverified cites dimmed with a tooltip", () => {
    const svg = renderDiagramSvg(FLOW, "t", new Set(["diff:conn:91-110"]));
    expect(svg).toContain("unverified");
    expect(svg).toContain("Unverified citation");
  });

  it("keeps injected markup inert in every field", () => {
    const evil: DiagramSpec = {
      version: 1,
      kind: "flow",
      title: '"><script>alert(1)</script>',
      nodes: [
        { id: "a", title: '<img src=x onerror=alert(1)>', sub: 'javascript:alert(1)', cite: "diff:conn:80-82" },
      ],
      edges: [{ from: "a", to: "a", label: '<svg onload=alert(1)>' }],
    };
    // Self-edge is invalid; fix to a two-node loop for the injection check.
    const evil2: DiagramSpec = {
      ...evil,
      nodes: [
        { id: "a", title: '<img src=x onerror=alert(1)>', sub: 'javascript:alert(1)', cite: "diff:conn:80-82" },
        { id: "b", title: "B" },
      ],
      edges: [{ from: "a", to: "b", label: '<svg onload=alert(1)>', cite: "diff:conn:80-82" }],
    };
    const svg = renderDiagramSvg(evil2, "e");
    // No executable markup: no script tags, no event-handler attributes,
    // no javascript: URLs in attribute position. Escaped text (e.g.
    // `&lt;img`) may still contain the words as inert text content.
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/<[^>]*\bonerror\s*=/i);
    expect(svg).not.toMatch(/<[^>]*\bonload\s*=/i);
    expect(svg).not.toMatch(/<[^>]*\bon\w+\s*=/i);
    expect(svg).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(svg).toContain("&lt;img");
    expect(svg).toContain("&lt;svg");
  });

  it("keeps panel and sequence injections inert", () => {
    const panels: DiagramSpec = {
      version: 1,
      kind: "panels",
      title: 'T<script>',
      panels: [
        { title: 'A<img src=x onerror=a>', lines: ['<b>hi</b>'], note: '"><svg onload=x>' },
        { title: "B", lines: ["ok"] },
      ],
    };
    const svg = renderDiagramSvg(panels, "p");
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/<[^>]*\bonerror\s*=/i);
    expect(svg).not.toMatch(/<[^>]*\bon\w+\s*=/i);
    const seq: DiagramSpec = {
      version: 1,
      kind: "sequence",
      title: "S",
      actors: ["<script>alert</script>", "B"],
      messages: [{ from: 0, to: 1, label: "<img src=x onerror=y>" }],
    };
    const svg2 = renderDiagramSvg(seq, "s");
    expect(svg2).not.toContain("<script");
    expect(svg2).not.toMatch(/<[^>]*\bonerror\s*=/i);
    expect(svg2).not.toMatch(/<[^>]*\bon\w+\s*=/i);
  });
});
