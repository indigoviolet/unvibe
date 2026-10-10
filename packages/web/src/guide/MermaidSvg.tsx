/** Lazy Mermaid renderer with a readable fallback. Split for `React.lazy`. */
import { useEffect, useRef, useState } from "react";

interface Props {
  source: string;
  fallbackId: string;
}

function pageTheme(): "dark" | "default" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return "dark";
  if (attr === "light") return "default";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

export default function MermaidSvg({ source, fallbackId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, theme: pageTheme() });
        const id = `mmd-${fallbackId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, fallbackId]);

  if (failed) {
    return (
      <div>
        <pre className="code">{source}</pre>
        <p className="hint">This diagram could not be rendered, so its source is shown.</p>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Diagram"
      // Mermaid emits its own SVG; an empty div flashes while it renders.
      suppressHydrationWarning
    />
  );
}
