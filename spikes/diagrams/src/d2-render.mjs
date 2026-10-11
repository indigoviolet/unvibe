/**
 * Render all D2 reference diagrams (light + dark + sketch + links probe).
 * Usage: node src/d2-render.mjs [outdir]
 */
import { D2 } from "@d2lang/d2";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "out/d2";
fs.mkdirSync(out, { recursive: true });

const d2 = new D2();
const files = ["flow", "fold", "sequence", "links"];
for (const f of files) {
  const src = fs.readFileSync(`src/d2/${f}.d2`, "utf8");
  for (const [themeID, tag] of [[0, "light"], [200, "dark"]]) {
    const t0 = Date.now();
    try {
      const r = await d2.compile(src, { themeID });
      const svg = await d2.render(r.diagram, r.renderOptions);
      fs.writeFileSync(path.join(out, `${f}.${tag}.svg`), svg);
      console.log(f, tag, `compile+render=${Date.now() - t0}ms`, `bytes=${svg.length}`);
    } catch (e) {
      console.log(f, tag, "ERR", String(e).slice(0, 200));
    }
  }
}
// sketch variant of flow
try {
  const src = fs.readFileSync("src/d2/flow.d2", "utf8");
  const r = await d2.compile(src, { sketch: true });
  const svg = await d2.render(r.diagram, r.renderOptions);
  fs.writeFileSync(path.join(out, "flow.sketch.svg"), svg);
  console.log("flow sketch bytes=", svg.length);
} catch (e) {
  console.log("sketch ERR", String(e).slice(0, 200));
}
await d2.dispose();
