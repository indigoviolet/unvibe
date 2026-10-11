/** Graphviz spot-check: render the flow reference in Node (service-side). */
import { Graphviz } from "@hpcc-js/wasm/graphviz";

const dot = `digraph {
  rankdir=LR;
  node [shape=box, style=rounded];
  srv [label="Server\\nfolded header"];
  cli [label="http.client\\nparse_headers"];
  msg [label="HTTPMessage\\nvalue keeps CRLF", color=red];
  norm [label="_normalize_header_values\\nOWS CRLF RWS -> SP", color=teal];
  dict [label="HTTPHeaderDict\\nr.headers", color=teal];
  same [label="HTTPMessage (same)\\ncookie jar", color=teal, URL="#cite-tsock"];
  srv -> cli -> msg -> norm;
  norm -> dict [label="new dict"];
  norm -> same [label="rebuilt in place"];
}`;
const t0 = Date.now();
const gv = await Graphviz.load();
console.log("wasm load ms=", Date.now() - t0);
const t1 = Date.now();
const svg = gv.dot(dot);
console.log("layout ms=", Date.now() - t1, "bytes=", svg.length);
console.log("style-attr:", (svg.match(/ style="/g) || []).length, "<style:", svg.includes("<style"), "<a:", svg.includes("<a "));
import fs from "node:fs";
fs.mkdirSync("out/graphviz", { recursive: true });
fs.writeFileSync("out/graphviz/flow.svg", svg);
