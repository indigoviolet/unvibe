import { D2 } from "@d2lang/d2";
import fs from "node:fs";

const src = process.argv[2] ?? "direction: right\nsrv: Server\ncli: http.client\nsrv -> cli: parses\n";
const themeID = Number(process.argv[3] ?? 0);
const sketch = process.argv[4] === "sketch";

const d2 = new D2();
const t0 = Date.now();
const r = await d2.compile(src, { themeID, sketch });
console.log("compile ms=", Date.now() - t0);
const t1 = Date.now();
const svg = await d2.render(r.diagram, r.renderOptions);
console.log("render ms=", Date.now() - t1);
console.log("svg bytes=", svg.length);
console.log("has <style:", svg.includes("<style"), "style-attr count:", (svg.match(/ style="/g) || []).length);
console.log("font-family refs:", (svg.match(/font-family/g) || []).length);
if (process.argv[5]) fs.writeFileSync(process.argv[5], svg);
await d2.dispose();
