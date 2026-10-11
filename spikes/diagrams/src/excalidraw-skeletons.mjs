/**
 * Excalidraw skeleton elements for the flow reference diagram.
 *
 * This is the shape of "what an agent actually sends": even the
 * higher-level skeleton API (convertToExcalidrawElements) requires
 * ABSOLUTE x/y/width/height per element. There is no box/edge auto-layout
 * in the OSS package — layout comes from Mermaid (parseMermaidToExcalidraw
 * runs Mermaid in-browser and converts its SVG geometry) or from whoever
 * authors the coordinates. The layout math below is what an agent (or our
 * own draw_diagram tool) would have to do.
 *
 * Note: skeletons carry no fontFamily and no link — style and citation
 * links are applied post-conversion (see excalidraw-entry.mjs).
 */

export function flowSkeletons() {
  const B = (id, x, y, w, h, title, sub, bg) => [
    {
      type: "rectangle",
      id: `${id}-box`,
      x, y, width: w, height: h,
      strokeColor: "#1b1f27",
      backgroundColor: bg ?? "transparent",
      strokeWidth: 1.5,
    },
    {
      type: "text",
      id: `${id}-txt`,
      x: x + 8, y: y + h / 2 - 20,
      width: w - 16, height: 40,
      text: sub ? `${title}\n${sub}` : title,
      fontSize: 15,
    },
  ];
  const A = (id, x1, y1, x2, y2, label, lx, ly) => [
    { type: "arrow", id, x: x1, y: y1, width: x2 - x1, height: y2 - y1,
      points: [[0, 0], [x2 - x1, y2 - y1]], strokeColor: "#5c6472", strokeWidth: 1.5 },
    ...(label ? [{ type: "text", id: `${id}-lbl`, x: lx, y: ly, text: label, fontSize: 13 }] : []),
  ];
  // 4 top boxes + 2 bottom boxes, 760px canvas.
  return [
    ...B("srv", 8, 20, 150, 70, "Server", "folded header"),
    ...B("cli", 188, 20, 160, 70, "http.client", "parse_headers"),
    ...B("msg", 378, 20, 170, 70, "HTTPMessage", "value keeps CRLF"),
    ...B("nrm", 578, 20, 174, 70, "_normalize…", "OWS CRLF→SP", "#e2f1f2"),
    ...B("dct", 378, 160, 170, 70, "HTTPHeaderDict", "r.headers", "#e2f1f2"),
    ...B("sme", 578, 160, 174, 70, "HTTPMessage*", "cookie jar", "#e2f1f2"),
    ...A("e1", 158, 55, 186, 55, null),
    ...A("e2", 348, 55, 376, 55, null),
    ...A("e3", 548, 55, 576, 55, null),
    ...A("e4", 640, 90, 480, 158, "new dict", 500, 118),
    ...A("e5", 700, 90, 690, 158, "rebuilt", 640, 118),
  ];
}

/** Byte cost of the agent output for the flow diagram (skeletons as JSON). */
export function skeletonBytes() {
  return new Blob([JSON.stringify(flowSkeletons())]).size;
}
