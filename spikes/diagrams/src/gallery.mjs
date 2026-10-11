/**
 * Build out/gallery.html: every candidate rendering the reference diagrams,
 * styled with the prototype's own CSS variables + .dg classes.
 * Static SVGs are embedded; Mermaid + Excalidraw render client-side so the
 * screenshot pass measures real render time, runtime style injection,
 * fonts, and network requests.
 */
import fs from "node:fs";
import { renderDiagramSvg } from "./render.js";
import { flowSkeletons } from "./excalidraw-skeletons.mjs";

const THEME = process.argv[2] === "dark" ? "dark" : "light";
const OUT = `out/gallery.${THEME}.html`;

const CSS = `
:root { --bg:#f5f6f8; --surface:#fff; --sunk:#eef0f3; --ink:#1b1f27; --muted:#5c6472; --line:#dde1e7;
  --accent:#0b6e78; --accent-soft:#e2f1f2; --warn:#a33b16; --ok:#2f7a3f;
  --serif:"Source Serif 4",Georgia,serif; --sans:"IBM Plex Sans",-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace; color-scheme:light; }
:root[data-theme="dark"] { --bg:#121519; --surface:#191d23; --sunk:#20252d; --ink:#e5e8ed; --muted:#98a1b0;
  --line:#2b313b; --accent:#56c2cb; --accent-soft:#15333a; --warn:#f29a72; --ok:#8fd6a2; color-scheme:dark; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 var(--sans); }
.wrap { width:760px; margin:0 auto; padding:16px; }
section { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 16px; margin:0 0 16px; }
h2 { font:600 15px var(--sans); margin:0 0 4px; } .sub { font-size:12px; color:var(--muted); margin:0 0 8px; }
.dg { overflow-x:auto; margin:12px 0 4px; } .dg svg { display:block; min-width:540px; width:100%; height:auto; }
.dg-cap { font-size:12.5px; color:var(--muted); margin:0 0 10px; }
.dg-box { fill:var(--surface); stroke:var(--line); stroke-width:1.2; }
.dg-box.ok { stroke:var(--accent); } .dg-box.bad { stroke:var(--warn); }
.dg-t { fill:var(--ink); font:600 12.5px var(--sans); } .dg-s { fill:var(--muted); font:11px var(--mono); }
.dg-a { stroke:var(--muted); stroke-width:1.3; fill:none; } .dg-ah { fill:var(--muted); }
.dg-l { fill:var(--muted); font:11.5px var(--sans); } .dg-l.ok { fill:var(--accent); } .dg-l.bad { fill:var(--warn); }
.preview { width:400px; border:1px dashed var(--line); padding:8px; } .preview .dg svg { min-width:0; }
.meta { font:11px var(--mono); color:var(--muted); }
`;

const ARROW = (id) =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
const box = (x, y, w, h, t, s, cls = "") =>
  `<rect class="dg-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/><text class="dg-t" x="${x + w / 2}" y="${y + (s ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle">${t}</text>${s ? `<text class="dg-s" x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle">${s}</text>` : ""}`;
const arr = (id, x1, y1, x2, y2) => `<path class="dg-a" d="M${x1},${y1} L${x2},${y2}" marker-end="url(#${id})"/>`;
const lbl = (x, y, t, cls = "", anchor = "middle") =>
  `<text class="dg-l ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;
const mono = (x, y, t) => `<text class="dg-s" x="${x}" y="${y}">${t}</text>`;

// Prototype originals, copied from prototype.html DIAGRAMS (marker ids namespaced).
const PROTO_FLOW = `<svg viewBox="0 0 790 215" role="img" aria-label="Header data flow">${ARROW("ah-p1")}
${box(10, 30, 120, 52, "Server", "folded header")}${box(150, 30, 140, 52, "http.client", "parse_headers")}
${box(310, 30, 150, 52, "HTTPMessage", "value keeps CRLF", "bad")}${box(480, 30, 190, 52, "_normalize_header_values", "OWS CRLF RWS → SP", "ok")}
${arr("ah-p1", 130, 56, 148, 56)}${arr("ah-p1", 290, 56, 308, 56)}${arr("ah-p1", 460, 56, 478, 56)}
${box(400, 145, 170, 52, "HTTPHeaderDict", "r.headers", "ok")}${box(600, 145, 180, 52, "HTTPMessage (same object)", "Requests' cookie jar", "ok")}
${arr("ah-p1", 560, 82, 495, 143)}${arr("ah-p1", 600, 82, 680, 143)}
${lbl(505, 118, "new dict", "", "end")}${lbl(650, 118, "rebuilt in place", "", "start")}</svg>`;
const PROTO_FOLD = `<svg viewBox="0 0 760 170" role="img" aria-label="Folded header before/after">${ARROW("ah-p2")}
<rect class="dg-box bad" x="10" y="20" width="330" height="92" rx="6"/>${lbl(20, 40, "On the wire", "", "start")}
${mono(20, 66, "Set-Cookie: a=1; path=/ CRLF")}${mono(20, 88, "    Max-Age=900 CRLF")}
${arr("ah-p2", 345, 66, 403, 66)}
<rect class="dg-box ok" x="410" y="20" width="340" height="92" rx="6"/>${lbl(420, 40, "After unfolding", "", "start")}
${mono(420, 66, "Set-Cookie: a=1; path=/ Max-Age=900")}
${lbl(175, 140, "the fold: spaces, CRLF, then 1+ spaces", "bad")}${lbl(580, 140, "replaced by a single space", "ok")}</svg>`;

function specSvg(kind, mid) {
  const d = JSON.parse(fs.readFileSync(`src/diagrams/${kind}.json`, "utf8"));
  return renderDiagramSvg(d, mid);
}
const read = (p) => fs.readFileSync(p, "utf8");

const mmd = {
  flow: read("src/mermaid/flow.mmd"),
  fold: read("src/mermaid/fold.mmd"),
  sequence: read("src/mermaid/sequence.mmd"),
};
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const d2svg = (f) => read(`out/d2/${f}.${THEME}.svg`);
const gvFlow = fs.existsSync("out/graphviz/flow.svg") ? read("out/graphviz/flow.svg") : "<p>missing</p>";

const sec = (id, title, sub, inner) =>
  `<section id="${id}"><h2>${title}</h2><p class="sub">${sub}</p>${inner}<p class="meta" data-meta-for="${id}"></p></section>`;
const dg = (svg, cap) => `<div class="dg">${svg}</div><p class="dg-cap">${cap}</p>`;

const html = `<!doctype html><html lang="en" data-theme="${THEME}"><head><meta charset="utf-8">
<title>Diagram spike gallery (${THEME})</title><style>${CSS}</style></head><body><div class="wrap">
${sec("proto-flow", "Reference · data-flow (prototype original)", "Hand-drawn SVG in prototype.html DIAGRAMS.path — the look to match.",
  dg(PROTO_FLOW, "Where a response's headers go after parsing, and the one place they are now unfolded."))}
${sec("proto-fold", "Reference · before/after (prototype original)", "Hand-drawn SVG in prototype.html DIAGRAMS.fold.",
  dg(PROTO_FOLD, "An obs-fold on the wire, and the value urllib3 now hands to callers."))}
${sec("b-flow", "B · JSON spec + own SVG renderer · flow", "Static SVG, prototype classes only, data-cite on cited nodes.",
  dg(specSvg("flow", "gb-flow"), "Header data flow from socket to both header views."))}
${sec("b-panels", "B · panels (before/after)", "Static SVG.",
  dg(specSvg("panels", "gb-pan"), "A folded Set-Cookie header and its unfolded value."))}
${sec("b-seq", "B · sequence (4 participants)", "Static SVG.",
  dg(specSvg("sequence", "gb-seq"), "Folded Set-Cookie travelling from socket to both header views."))}
${sec("d2-flow", "D2 · flow", "Pre-rendered with @d2lang/d2 (themeID " + (THEME === "dark" ? "200" : "0") + ").", dg(d2svg("flow"), "D2 dagre layout."))}
${sec("d2-fold", "D2 · before/after as flow", "Pre-rendered.", dg(d2svg("fold"), "D2 before/after."))}
${sec("d2-seq", "D2 · sequence_diagram", "Pre-rendered.", dg(d2svg("sequence"), "D2 sequence diagram."))}
${sec("gv-flow", "E · Graphviz (dot, via @hpcc-js/wasm in Node)", "Static SVG, presentation attributes only.", dg(gvFlow, "Graphviz dot layout."))}
${sec("mmd-flow", "A · Mermaid baseline · flow", "Client-rendered with the repo's mermaid " + read("../../node_modules/mermaid/package.json").match(/"version": "([^"]+)"/)[1] + ".", `<div class="dg"><div id="mmd-out-flow"></div></div>`)}
${sec("mmd-fold", "A · Mermaid baseline · before/after", "Client-rendered.", `<div class="dg"><div id="mmd-out-fold"></div></div>`)}
${sec("mmd-seq", "A · Mermaid baseline · sequence", "Client-rendered.", `<div class="dg"><div id="mmd-out-seq"></div></div>`)}
${sec("exc-flow-hand", "D · Excalidraw · flow, hand-drawn", "exportToSvg, no editor mount. Skeletons carry absolute coords.", `<div class="dg"><div id="exc-out-flow-hand" data-style="hand"></div></div><script type="application/json" id="exc-src-flow-hand">${JSON.stringify(flowSkeletons())}</script>`)}
${sec("exc-flow-clean", "D · Excalidraw · flow, clean", "Helvetica + roughness 0 — the non-sketch style.", `<div class="dg"><div id="exc-out-flow-clean" data-style="clean"></div></div><script type="application/json" id="exc-src-flow-clean">${JSON.stringify(flowSkeletons())}</script>`)}
${sec("preview-400", "Readability · 400px hover preview", "Candidate B flow + prototype flow at preview width.",
  `<div class="preview"><div class="dg">${specSvg("flow", "gb-prev-b")}</div></div><div class="preview"><div class="dg">${PROTO_FLOW.replaceAll("ah-p1", "ah-prev")}</div></div>`)}
</div>
<script type="module">
const MMD = ${JSON.stringify(mmd)};
const meta = (id, text) => { const m = document.querySelector('[data-meta-for="' + id + '"]'); if (m) m.textContent = text; };
window.__done = false;
try {
  const { default: mermaid } = await import("/nm/mermaid/dist/mermaid.esm.min.mjs");
  mermaid.initialize({ startOnLoad: false, theme: "${THEME === "dark" ? "dark" : "default"}" });
  for (const [k, mk] of [["flow","flow"], ["fold","fold"], ["seq","sequence"]]) {
    const t0 = performance.now();
    try {
      const { svg } = await mermaid.render("mm-" + k, MMD[mk].replaceAll("[[", "[").replaceAll("]]", "]"));
      document.getElementById("mmd-out-" + k).innerHTML = svg;
      
      meta("mmd-" + k, "renderMs=" + Math.round(performance.now() - t0) + " svgBytes=" + svg.length +
        " styleAttrs=" + ((svg.match(/ style="/g) || []).length) + " styleTags=" + ((svg.match(/<style/g) || []).length));
    } catch (e) { meta("mmd-" + k, "ERROR " + String(e).slice(0, 200)); }
  }
} catch (e) { meta("mmd-flow", "MERMAID IMPORT ERROR " + String(e).slice(0, 200)); }
try {
  window.EXCALIDRAW_ASSET_PATH = ["/"];
  await import("/excalidraw-bundle.js");
  for (const [name, theme] of [["flow-hand", "${THEME}"], ["flow-clean", "${THEME}"]]) {
    const r = await window.__renderExcalidraw(name, theme);
    const el = document.getElementById("exc-out-" + name);
    meta("exc-" + name, r.ok ? ("renderMs=" + el.dataset.renderMs + " svgBytes=" + el.dataset.svgBytes +
      " styleAttrs=" + el.dataset.svgStyleAttrs + " styleTags=" + el.dataset.svgStyleTags + " links=" + el.dataset.svgLinks)
      : ("ERROR " + el.dataset.error));
  }
} catch (e) { meta("exc-flow-hand", "EXCALIDRAW IMPORT ERROR " + String(e).slice(0, 200)); }
window.__done = true;
</script></body></html>`;

fs.mkdirSync("out", { recursive: true });
fs.writeFileSync(OUT, html);
console.log("wrote", OUT, html.length, "bytes");
