/**
 * D2 diagram rendering (web-guide owner; D2 decision addendum).
 *
 * The `d2` binary runs on the service, which renders light + dark SVGs;
 * the web app only inlines the cached SVG for the current theme:
 * - fetch `/api/reviews/:id/diagrams/:hash?theme=` as text through the API
 *   client (an `<img src>` could neither carry the token header nor keep
 *   the citation anchors interactive) whenever the block carries a hash —
 *   including `unavailable`/`error` blocks, for which the endpoint serves
 *   fixture seeds or renders on demand;
 * - in-memory cache by hash+theme; refetch on theme change;
 * - loading state reserves height so the page does not jump;
 * - the SVG is adopted via `d2sanitize.ts` (DOMParser + defensive pass +
 *   per-instance id/CSS namespacing), never `dangerouslySetInnerHTML`;
 * - `render.status: "unavailable"` with no usable SVG behind it shows the
 *   D2 source with a short note + link to Settings → Environment;
 *   `"error"` shows the source with the error text. Neither breaks the card.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DiagramBlock, DiagramTheme } from "@unvibe/shared";
import { api, DiagramStatusError, friendlyError } from "../api/client.js";
import { revealSource } from "../source/reveal.js";
import { adoptD2Svg } from "./d2sanitize.js";

export type FetchDiagramSvg = (
  reviewId: string,
  hash: string,
  theme: DiagramTheme,
) => Promise<string>;

/** Current page theme: explicit `data-theme` wins, else the OS setting. */
export function pageTheme(): DiagramTheme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return "dark";
  if (attr === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Track the page theme (attribute flips + OS changes) for re-render. */
export function usePageTheme(): DiagramTheme {
  const [theme, setTheme] = useState<DiagramTheme>(() => pageTheme());
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (): void => setTheme(pageTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return theme;
}

/** In-memory SVG cache by hash+theme (shared across diagram instances). */
const svgCache = new Map<string, string>();

/** In-flight fetches by hash+theme: concurrent mounts share one request. */
const pendingFetches = new Map<string, Promise<string>>();

/** Test-only: clear the module cache between cases. */
export function clearD2SvgCache(): void {
  svgCache.clear();
  pendingFetches.clear();
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; svgText: string }
  | { kind: "fallback"; note: "unavailable" | "error" | "not-found"; message: string };

interface Props {
  reviewId: string;
  block: DiagramBlock;
  /** Override the fetch (unit tests); defaults to the API client. */
  fetchSvg?: FetchDiagramSvg;
}

/**
 * Tolerate blocks stored before D2 rendering (e.g. the pre-decision
 * fixture, which carries a legacy `mermaid` field and no `render`): show
 * the source fallback instead of breaking the card.
 */
export function d2SourceOf(block: DiagramBlock): string {
  if (typeof block.source === "string" && block.source !== "") return block.source;
  const legacy = (block as unknown as { mermaid?: unknown }).mermaid;
  return typeof legacy === "string" ? legacy : "";
}

export function D2Diagram({ reviewId, block, fetchSvg }: Props): React.JSX.Element {
  const theme = usePageTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const render = block.render;
  const status = render?.status;
  const hash = render?.hash ?? "";
  // Fetch whenever there is a hash to address: the endpoint serves
  // fixture-seeded SVGs — and renders on demand when the binary is
  // present — even for `unavailable`/`error` blocks, healing them to ok.
  // Only a missing hash (nothing to fetch by) falls back immediately.
  const [state, setState] = useState<LoadState>(() => {
    if (hash !== "") return { kind: "loading" };
    if (!render || status === "unavailable") {
      return { kind: "fallback", note: "unavailable", message: render?.error ?? "" };
    }
    return { kind: "fallback", note: "error", message: render?.error ?? "" };
  });

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    setState({ kind: "loading" });
    const key = `${hash}:${theme}`;
    const cached = svgCache.get(key);
    const done = (svgText: string): void => {
      if (!cancelled) setState({ kind: "ready", svgText });
    };
    const fail = (err: unknown): void => {
      if (cancelled) return;
      if (err instanceof DiagramStatusError) {
        setState({
          kind: "fallback",
          note: err.status,
          message: err.detail ?? "",
        });
        return;
      }
      const raw = err instanceof Error ? err.message : String(err);
      if (/: 404(\s|$)/.test(raw)) {
        setState({ kind: "fallback", note: "not-found", message: "the service no longer has it" });
        return;
      }
      setState({ kind: "fallback", note: "error", message: friendlyError(err) });
    };
    if (cached !== undefined) {
      done(cached);
      return () => {
        cancelled = true;
      };
    }
    let flight = pendingFetches.get(key);
    if (!flight) {
      flight = (fetchSvg ?? api.diagramSvg)(reviewId, hash, theme).then((svgText) => {
        svgCache.set(key, svgText);
        return svgText;
      });
      pendingFetches.set(key, flight);
      // Drop the entry once settled so later failures can retry.
      void flight.then(
        () => pendingFetches.delete(key),
        () => pendingFetches.delete(key),
      );
    }
    flight.then(done, fail);
    return () => {
      cancelled = true;
    };
  }, [reviewId, hash, theme, status, fetchSvg]);

  // Adopt the sanitised SVG into the host div (never innerHTML).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || state.kind !== "ready") return;
    host.textContent = "";
    const node = adoptD2Svg(state.svgText);
    if (node) {
      host.appendChild(node);
      return () => {
        host.textContent = "";
      };
    }
    setState({
      kind: "fallback",
      note: "error",
      message: "the service returned a file the app couldn't read",
    });
    return undefined;
  }, [state]);

  // Each branch carries a key so React never reuses the adopted-SVG host
  // div for the loading/fallback trees (or vice versa): the adopt effect
  // owns that div's children imperatively, and reuse makes React's own
  // removeChild throw on nodes it no longer finds.
  if (state.kind === "loading") {
    return (
      <div key="d2-loading" className="dg-loading" role="status" aria-label="Rendering diagram">
        <span className="working">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Rendering diagram…</span>
        </span>
      </div>
    );
  }

  if (state.kind === "fallback") {
    const source = d2SourceOf(block);
    return (
      <div key="d2-fallback" className="dg-fallback">
        {source !== "" ? <pre className="code">{source}</pre> : null}
        {state.note === "unavailable" ? (
          <p className="hint">
            Diagrams need <code>d2</code>
            {state.message !== "" ? ` (${state.message})` : ""}. The diagram&apos;s source is shown above. To install d2, see <Link to="/settings?tab=environment">Settings → Environment</Link>.
          </p>
        ) : (
          <p className="hint">
            Couldn&apos;t draw this diagram
            {state.message !== "" ? `: ${state.message}` : ""}. Its source is shown above.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      key="d2-ready"
      ref={hostRef}
      className="dg-svg"
      onClick={(e) => {
        // Citation anchors must reveal in place, never navigate: `href="#"`
        // would otherwise change the URL and scroll.
        const anchor = (e.target as Element | null)?.closest?.("a[href]");
        if (!anchor) return;
        e.preventDefault();
        const target = anchor.getAttribute("data-src");
        if (target) revealSource(target);
      }}
    />
  );
}
