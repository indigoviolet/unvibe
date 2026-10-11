/**
 * Browser entry for the Excalidraw candidate (bundled with esbuild).
 * Reads skeleton JSON from <script type="application/json"> tags,
 * converts via the real convertToExcalidrawElements, applies a style
 * preset + citation link, and renders static SVG via exportToSvg —
 * no editor mount.
 */
import {
  exportToSvg,
  convertToExcalidrawElements,
  FONT_FAMILY,
} from "@excalidraw/excalidraw";

const PRESETS = {
  hand: { font: FONT_FAMILY.Virgil, roughness: 1 },
  clean: { font: FONT_FAMILY.Helvetica, roughness: 0 },
};

window.__renderExcalidraw = async function (name, theme) {
  const t0 = performance.now();
  const el = document.getElementById(`exc-out-${name}`);
  try {
    const skeletons = JSON.parse(document.getElementById(`exc-src-${name}`).textContent);
    const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false });
    const preset = PRESETS[el.dataset.style] ?? PRESETS.hand;
    for (const e of elements) {
      if (e.type === "text") e.fontFamily = preset.font;
      else e.roughness = preset.roughness;
      if (e.id === "msg-box") {
        e.link = "unvibe:diff:conn:650-651"; // citation shaping probe
        e.strokeColor = theme === "dark" ? "#f29a72" : "#a33b16";
      }
      if (e.id === "nrm-box" || e.id === "dct-box" || e.id === "sme-box") {
        e.strokeColor = theme === "dark" ? "#56c2cb" : "#0b6e78";
      }
      if (theme === "dark" && e.type === "text") e.strokeColor = "#e5e8ed";
      if (theme === "dark" && e.type === "arrow") e.strokeColor = "#98a1b0";
    }
    const svg = await exportToSvg({
      elements,
      appState: { theme, viewBackgroundColor: "#ffffff", exportBackground: false },
      files: null,
    });
    svg.setAttribute("width", "100%");
    el.replaceChildren(svg);
    const ms = Math.round(performance.now() - t0);
    el.dataset.renderMs = String(ms);
    el.dataset.svgBytes = String(new XMLSerializer().serializeToString(svg).length);
    el.dataset.svgStyleAttrs = String((el.innerHTML.match(/ style="/g) || []).length);
    el.dataset.svgStyleTags = String((el.innerHTML.match(/<style/g) || []).length);
    el.dataset.svgLinks = String((el.innerHTML.match(/<a /g) || []).length);
    return { ok: true, ms };
  } catch (err) {
    el.dataset.error = String(err && err.message ? err.message : err).slice(0, 300);
    return { ok: false, error: el.dataset.error };
  }
};
