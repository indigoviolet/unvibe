/**
 * D2 diagram tests (D2 decision addendum):
 * - the defensive adopt pass leaves hostile payloads inert while keeping
 *   the contract's citation anchors and the styles D2 needs;
 * - per-instance id/CSS namespacing isolates two copies of one diagram;
 * - status branches (ok / unavailable / error / loading / 404), theme
 *   refetch, and click-to-reveal without navigation.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DiagramBlock } from "@unvibe/shared";
import { DiagramStatusError } from "../api/client.js";
import { D2Diagram, clearD2SvgCache } from "./D2Diagram.js";
import { adoptD2Svg, sanitizeD2Svg, scopeDiagramCss, isAllowedHref } from "./d2sanitize.js";

// jsdom has no matchMedia: pretend the OS prefers light.
function stubMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
    writable: true,
  });
}
stubMatchMedia();

const HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><style>.evil{fill:red;}</style><script>alert(1)</script><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><p>hi</p></body></foreignObject><a href="https://evil.example/x" xlink:href="https://evil.example/x" data-refs="diff:a:1"><rect id="r1" width="10" height="10" onclick="alert(1)" ONMOUSEOVER="alert(2)"/></a><a href="javascript:alert(3)"><text>js</text></a><a href="#local"><use href="#r1"/></a><image href="https://evil.example/i.png"/></svg>`;

const CITED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>.shape{stroke:blue;}.d2-9 .fill-N7{fill:#fff;}@font-face{font-family:d2-9-font;src:url("data:font/woff;base64,AAA");}</style><a href="#" data-refs="diff:conn:80-88" data-src="diff:conn:80-88"><rect id="box" class="shape" x="1" y="1" width="10" height="10" style="fill:url(#grad)"/></a><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></svg>`;

function d2Block(over: Partial<DiagramBlock> = {}): DiagramBlock {
  return {
    type: "diagram",
    id: "b1",
    source: "a -> b",
    citations: [],
    render: { hash: "h1", status: "ok" },
    ...over,
  };
}

function renderD2(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  clearD2SvgCache();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("isAllowedHref", () => {
  it("allows only # and internal fragments", () => {
    expect(isAllowedHref("#")).toBe(true);
    expect(isAllowedHref("#box")).toBe(true);
    expect(isAllowedHref("https://x.example/")).toBe(false);
    expect(isAllowedHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedHref("diff:conn:80-88")).toBe(false);
    expect(isAllowedHref(null)).toBe(false);
  });
});

describe("sanitizeD2Svg hostile payloads", () => {
  it("drops script, foreignObject, image and event handlers", () => {
    const root = sanitizeD2Svg(HOSTILE, "t0");
    expect(root).not.toBeNull();
    const html = root!.outerHTML;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("foreignObject");
    expect(html).not.toContain("<image");
    expect(html).not.toMatch(/onclick|onmouseover/i);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
  });

  it("keeps citation anchors, styles and internal refs", () => {
    const root = sanitizeD2Svg(CITED, "t1");
    expect(root).not.toBeNull();
    const anchor = root!.querySelector("a[href='#']");
    expect(anchor?.getAttribute("data-refs")).toBe("diff:conn:80-88");
    expect(anchor?.getAttribute("data-src")).toBe("diff:conn:80-88");
    expect(anchor?.getAttribute("tabindex")).toBe("0");
    // <style> blocks and inline style= survive (D2 needs them to render).
    expect(root!.querySelector("style")).not.toBeNull();
    expect(root!.querySelector("rect")?.getAttribute("style")).toContain("fill:");
  });

  it("rejects non-SVG and unparsable input", () => {
    expect(sanitizeD2Svg("<div>nope</div>", "t2")).toBeNull();
    expect(sanitizeD2Svg("<<<not xml", "t3")).toBeNull();
    expect(sanitizeD2Svg("", "t4")).toBeNull();
  });

  it("rewrites url() references in presentation attributes", () => {
    // mask / marker / clip-path (and paint servers) arrive as url(#…)
    // presentation attributes; ids are namespaced per instance, so the
    // references must follow or they dangle and stop applying.
    const root = sanitizeD2Svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<defs><mask id="m" maskUnits="userSpaceOnUse"><rect width="10" height="10" fill="white"/></mask>` +
        `<marker id="mk"><path d="M0 0h4"/></marker>` +
        `<clipPath id="c"><rect width="5" height="5"/></clipPath></defs>` +
        `<path d="M0 0H10" mask="url(#m)" marker-end="url(#mk)" clip-path="url(#c)" fill="url(#m)"/></svg>`,
      "u9",
    );
    expect(root).not.toBeNull();
    const path = root!.querySelector("path[mask]") as SVGPathElement;
    expect(path.getAttribute("mask")).toBe("url(#u9-m)");
    expect(path.getAttribute("marker-end")).toBe("url(#u9-mk)");
    expect(path.getAttribute("clip-path")).toBe("url(#u9-c)");
    expect(path.getAttribute("fill")).toBe("url(#u9-m)");
  });
});

describe("scopeDiagramCss", () => {
  it("prefixes global selectors and leaves @font-face alone", () => {
    const out = scopeDiagramCss(
      ".shape{stroke:blue;}.d2-9 .fill-N7{fill:#fff;}@font-face{font-family:f;src:url(\"data:x\");}",
      "u7",
    );
    expect(out).toContain(".u7 .shape{stroke:blue;}");
    expect(out).toContain(".u7 .d2-9 .fill-N7{fill:#fff;}");
    expect(out).toContain("@font-face{font-family:f;");
    expect(out).not.toContain(".u7 @font-face");
  });
});

describe("two-diagram isolation", () => {
  it("gives two copies distinct ids, refs and style scopes", () => {
    const a = adoptD2Svg(CITED, "uA")!;
    const b = adoptD2Svg(CITED, "uB")!;
    expect(a.querySelector("rect")?.getAttribute("id")).toBe("uA-box");
    expect(b.querySelector("rect")?.getAttribute("id")).toBe("uB-box");
    expect(a.querySelector("rect")?.getAttribute("style")).toContain("url(#uA-grad)");
    expect(b.querySelector("rect")?.getAttribute("style")).toContain("url(#uB-grad)");
    expect(a.querySelector("style")?.textContent).toContain(".uA .shape");
    expect(b.querySelector("style")?.textContent).toContain(".uB .shape");
    expect(a.classList.contains("uA")).toBe(true);
    expect(b.classList.contains("uB")).toBe(true);
    // No id is shared between the copies.
    const idsA = new Set([...a.querySelectorAll("[id]")].map((el) => el.id));
    for (const el of b.querySelectorAll("[id]")) expect(idsA.has(el.id)).toBe(false);
  });
});

describe("D2Diagram status branches", () => {
  it("shows a loading state that reserves height", () => {
    let resolve!: (svg: string) => void;
    const fetchSvg = () => new Promise<string>((r) => { resolve = r; });
    const { container } = renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />);
    const loading = screen.getByRole("status", { name: "Rendering diagram" });
    expect(loading).toBeInTheDocument();
    expect(container.querySelector(".dg-loading")).not.toBeNull();
    act(() => resolve(CITED));
  });

  it("inlines the fetched SVG for the ok branch", async () => {
    const fetchSvg = vi.fn(async () => CITED);
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />);
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    expect(fetchSvg).toHaveBeenCalledWith("demo", "h1", "light");
    expect(document.querySelector(".dg-svg a[href='#']")).not.toBeNull();
  });

  it("fetches an unavailable block by hash: a served SVG still renders", async () => {
    // The endpoint serves fixture seeds (and renders on demand) even for
    // `unavailable` blocks: only a missing hash skips the fetch.
    const fetchSvg = vi.fn(async () => CITED);
    renderD2(
      <D2Diagram
        reviewId="demo"
        block={d2Block({ source: "a -> b", render: { hash: "h2", status: "unavailable", error: "no binary" } })}
        fetchSvg={fetchSvg}
      />,
    );
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    expect(fetchSvg).toHaveBeenCalledWith("demo", "h2", "light");
  });

  it("a block with no render result yet shows a neutral working state, never the Settings link", () => {
    // A diagram the service has not rendered or checked yet (still being
    // written, or stored without a render field) must not claim d2 is
    // missing (#130, sixth fault).
    const fetchSvg = vi.fn(async () => CITED);
    renderD2(<D2Diagram reviewId="demo" block={d2Block({ source: "a -> b", render: undefined })} fetchSvg={fetchSvg} />);
    expect(fetchSvg).not.toHaveBeenCalled();
    expect(screen.getByText(/Drawing diagram/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Settings → Environment/ })).toBeNull();
    expect(screen.queryByText(/Diagrams need/)).toBeNull();
  });

  it("a hash-less unavailable block stays pending: no fetch, no Settings note", () => {
    // The service has not checked the block yet: neutral working state,
    // never a claim about d2 (#130).
    const fetchSvg = vi.fn(async () => CITED);
    renderD2(
      <D2Diagram
        reviewId="demo"
        block={d2Block({ source: "a -> b", render: { hash: "", status: "unavailable", error: "no binary" } })}
        fetchSvg={fetchSvg}
      />,
    );
    expect(fetchSvg).not.toHaveBeenCalled();
    expect(screen.getByText(/Drawing diagram/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Settings → Environment/ })).toBeNull();
    expect(screen.queryByText(/Diagrams need/)).toBeNull();
  });

  it("a hash-less error block stays pending: the raw error is never quoted", () => {
    renderD2(
      <D2Diagram
        reviewId="demo"
        block={d2Block({ source: "a - broken", render: { hash: "", status: "error", error: "boom" } })}
        fetchSvg={vi.fn(async () => CITED)}
      />,
    );
    expect(screen.getByText(/Drawing diagram/)).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it("maps a 409 error to a plain fallback with a retry, never quoting the compiler", async () => {
    const fetchSvg = vi.fn(async (): Promise<string> => {
      throw new DiagramStatusError("error", "err: 7:37: invalid text beginning unquoted key");
    });
    renderD2(<D2Diagram reviewId="demo" block={d2Block({ source: "a -> b" })} fetchSvg={fetchSvg} />);
    await waitFor(() => expect(screen.getByText(/Couldn't draw this diagram/)).toBeInTheDocument());
    // Reader-facing text stays plain: the raw reason lives on Debug.
    expect(screen.queryByText(/unquoted key/)).toBeNull();
    expect(screen.getByText("a -> b")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(fetchSvg).toHaveBeenCalledTimes(2));
  });

  it("maps a 409 unavailable to the source fallback without fetching again", async () => {
    const fetchSvg = vi.fn(async (): Promise<string> => {
      throw new DiagramStatusError("unavailable", "too old");
    });
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />);
    await waitFor(() => expect(screen.getByText(/Diagrams need/)).toBeInTheDocument());
    expect(screen.getByText(/too old/)).toBeInTheDocument();
  });

  it("maps a 404 to the not-found fallback", async () => {
    const fetchSvg = vi.fn(async (): Promise<string> => {
      throw new Error("GET /api/reviews/demo/diagrams/h1?theme=light: 404 {\"error\":\"unknown diagram\"}");
    });
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />);
    await waitFor(() => expect(screen.getByText(/no longer has it/)).toBeInTheDocument());
  });
});

describe("D2Diagram theme switch", () => {
  it("refetches with the dark theme when data-theme flips", async () => {
    const fetchSvg = vi.fn(async (_r: string, _h: string, theme: string) =>
      theme === "dark" ? CITED.replace('viewBox="0 0 200 100"', 'viewBox="0 0 200 100" data-t="dark"') : CITED,
    );
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />);
    await waitFor(() => expect(fetchSvg).toHaveBeenCalledWith("demo", "h1", "light"));
    act(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await waitFor(() => expect(fetchSvg).toHaveBeenCalledWith("demo", "h1", "dark"));
    await waitFor(() => expect(document.querySelector('.dg-svg svg[data-t="dark"]')).not.toBeNull());
  });

  it("serves the second identical diagram from cache without refetching", async () => {
    const fetchSvg = vi.fn(async () => CITED);
    renderD2(
      <>
        <D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />
        <D2Diagram reviewId="demo" block={d2Block()} fetchSvg={fetchSvg} />
      </>,
    );
    await waitFor(() => expect(document.querySelectorAll(".dg-svg svg")).toHaveLength(2));
    expect(fetchSvg).toHaveBeenCalledTimes(1);
  });
});

describe("D2Diagram citation clicks", () => {
  it("reveals in place without changing the URL", async () => {
    const seen: string[] = [];
    const onReveal = (e: Event): void => {
      seen.push((e as CustomEvent).detail.ref as string);
    };
    window.addEventListener("unvibe:reveal-source", onReveal);
    try {
      // `desc:` targets dispatch the reveal event with no snapshot needed.
      const svg = CITED.replace('data-src="diff:conn:80-88"', 'data-src="desc:d-p1"').replace(
        'data-refs="diff:conn:80-88"',
        'data-refs="desc:d-p1"',
      );
      renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={async () => svg} />);
      await waitFor(() => expect(document.querySelector(".dg-svg a[href]")).not.toBeNull());
      const before = window.location.href;
      const anchor = document.querySelector(".dg-svg a[href]") as HTMLElement;
      // Own the reveal timers (issue #119 flake): flashParagraph schedules
      // a 60 ms setTimeout that can otherwise fire after this file's jsdom
      // environment is torn down.
      vi.useFakeTimers();
      try {
        fireEvent.click(anchor);
        await vi.advanceTimersByTimeAsync(3000);
        expect(seen).toEqual(["desc:d-p1"]);
        expect(window.location.href).toBe(before);
      } finally {
        vi.useRealTimers();
      }
    } finally {
      window.removeEventListener("unvibe:reveal-source", onReveal);
    }
  });
});

describe("D2Diagram capNaturalWidth (round two, item 2)", () => {
  const WIDE = CITED.replace('viewBox="0 0 200 100"', 'viewBox="0 0 1379 251"');

  it("caps a diagram at its natural width instead of stretching it", async () => {
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={async () => CITED} capNaturalWidth />);
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    expect((document.querySelector(".dg-svg svg") as SVGSVGElement).style.maxWidth).toBe("200px");
  });

  it("sets no cap without the flag (overlay sizes from the viewBox)", async () => {
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={async () => WIDE} />);
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    expect((document.querySelector(".dg-svg svg") as SVGSVGElement).style.maxWidth).toBe("");
  });
});

describe("D2Diagram ok/bad classes (#16)", () => {  // D2 passes unknown classes through on the shape group; the app's
  // stylesheet paints `.ok`/`.bad` in the guide palette (no `classes:`
  // stanza needed, and those stay rejected by the service pre-check).
  const CLASSED =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">` +
    `<g class="YQ== ok"><rect id="a" class="stroke-B1 fill-B6" x="1" y="1" width="10" height="10"/></g>` +
    `<g class="Yg== bad"><rect id="b" class="stroke-B1 fill-B6" x="20" y="1" width="10" height="10"/></g></svg>`;

  it("keeps ok/bad classes through adoption", async () => {
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={async () => CLASSED} />);
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    expect(document.querySelector(".dg-svg svg .ok rect")).not.toBeNull();
    expect(document.querySelector(".dg-svg svg .bad rect")).not.toBeNull();
  });
});

describe("D2Diagram multi-line labels (#16)", () => {
  // The service sanitiser once stripped tspan x/dy and maskUnits,
  // collapsing every line onto one baseline. The web adopt pass keeps
  // them; this pins that half of the contract.
  const LINES =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 140">` +
    `<defs><mask id="m1" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="140">` +
    `<rect x="0" y="0" width="300" height="140" fill="white"/></mask></defs>` +
    `<text x="60" y="40"><tspan x="60" dy="0">first line</tspan><tspan x="60" dy="18.5">second line</tspan></text>` +
    `<path d="M 0 70 H 300" mask="url(#m1)"/></svg>`;

  it("keeps tspan positioning and mask geometry through adoption", async () => {
    renderD2(<D2Diagram reviewId="demo" block={d2Block()} fetchSvg={async () => LINES} />);
    await waitFor(() => expect(document.querySelector(".dg-svg svg")).not.toBeNull());
    const tspans = [...document.querySelectorAll(".dg-svg svg tspan")];
    expect(tspans.map((t) => t.getAttribute("dy"))).toEqual(["0", "18.5"]);
    expect(document.querySelector(".dg-svg svg mask")?.getAttribute("maskUnits")).toBe("userSpaceOnUse");
  });
});
