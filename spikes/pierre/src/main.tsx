/**
 * Spike harness (issue #22): renders the real @pierre/diffs + @pierre/trees
 * against the demo fixture and a generated large diff.
 *
 * Routes (hash):
 *  #/unified      demo diff, unified
 *  #/split        demo diff, split
 *  #/annotations  line annotations w/ live textarea + gutter utility
 *  #/perf         generated 300-file / ~5k-hunk diff
 *  #/trees        @pierre/trees file tree
 *  #/shiki        option 3: Shiki tokens in our own rows (no Pierre render)
 *
 * Query: ?theme=light|dark  (default: light; `system` follows OS)
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PatchDiff } from "@pierre/diffs/react";
import "./style.css";
import { DEMO_PATCHES } from "./demoPatches.js";
import { TreesDemo } from "./treesDemo.js";
import { ShikiRows } from "./shikiRows.js";
import { makeLargePatch } from "./largeDiff.js";

type ThemeName = "light" | "dark";

function useTheme(): ThemeName {
  const [t, setT] = useState<ThemeName>(() => {
    const q = new URLSearchParams(location.search).get("theme");
    if (q === "dark" || q === "light") return q;
    document.documentElement.dataset.spikeTheme = "light";
    return "light";
  });
  useEffect(() => {
    document.documentElement.dataset.spikeTheme = t;
    document.body.style.background = t === "dark" ? "#0d1117" : "#ffffff";
    document.body.style.color = t === "dark" ? "#e6edf3" : "#1f2328";
  }, [t]);
  useEffect(() => {
    (window as any).__setSpikeTheme = (x: ThemeName) => setT(x);
  }, []);
  return t;
}

const PIERRE_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;

/** Comment thread with a live textarea (state-survival probe). */
export function ThreadCard({ id, side, line }: { id: string; side: string; line: number }) {
  const [text, setText] = useState(`draft for ${id} `);
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <div className="spike-thread closed" data-thread={id}>
        <span>💬 {id} (closed)</span>{" "}
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
      </div>
    );
  return (
    <div className="spike-thread spike-pin" data-thread={id} data-side={side} data-line={line}>
      <div className="spike-thread-h">
        <b>Thread {id}</b> <span className="hint">
          {side}:{line}
        </span>
        <button type="button" data-act="close" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <p className="spike-card">Explanation card body for {id} — pinned to pane width.</p>
      <textarea
        data-textarea={id}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a reply…"
        style={{ width: "100%" }}
      />
      <div className="hint" data-echo={id}>
        echo:{text}
      </div>
    </div>
  );
}

function DiffList({ diffStyle, annotate }: { diffStyle: "unified" | "split"; annotate?: boolean }) {
  const theme = useTheme();
  const ann = useMemo(
    () =>
      annotate
        ? [
            { side: "additions" as const, lineNumber: 86, metadata: { id: "t1" } },
            { side: "additions" as const, lineNumber: 86, metadata: { id: "t2" } },
            { side: "deletions" as const, lineNumber: 619, metadata: { id: "t3" } },
          ]
        : undefined,
    [annotate],
  );
  return (
    <div className="spike-diffs">
      {DEMO_PATCHES.map((p) => (
        <PatchDiff
          key={p.key}
          patch={p.patch}
          options={useMemo(
            () => ({
              theme: PIERRE_THEME,
              themeType: theme === "dark" ? ("dark" as const) : ("light" as const),
              diffStyle,
              overflow: diffStyle === "unified" ? ("scroll" as const) : ("wrap" as const),
              enableGutterUtility: true,
            }),
            [diffStyle, theme],
          )}
          lineAnnotations={ann as any}
          renderAnnotation={
            annotate
              ? (a: any) => <ThreadCard id={a.metadata.id} side={a.side} line={a.lineNumber} />
              : undefined
          }
          renderGutterUtility={
            annotate
              ? (getLine: any) => (
                  <button
                    type="button"
                    data-gutter-plus="1"
                    onClick={() => {
                      (window as any).__lastGutterClick = getLine?.();
                    }}
                    title="Comment on this line"
                  >
                    +
                  </button>
                )
              : undefined
          }
        />
      ))}
    </div>
  );
}

function PerfView() {
  const theme = useTheme();
  const patches = useMemo(() => makeLargePatch(300, 17), []);
  const [t0] = useState(() => performance.now());
  const [paintMs, setPaintMs] = useState<number | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPaintMs(performance.now() - t0));
    return () => cancelAnimationFrame(raf);
  }, [t0]);
  return (
    <div>
      <p data-perf>
        files={patches.length} paintAfterMount={paintMs === null ? "…" : `${Math.round(paintMs)}ms`}
      </p>
      {patches.map((p, i) => (
        <PatchDiff
          key={i}
          patch={p}
          options={{
            theme: PIERRE_THEME,
            themeType: theme === "dark" ? "dark" : "light",
            diffStyle: "unified",
          }}
        />
      ))}
    </div>
  );
}

function Route() {
  const [hash, setHash] = useState(() => location.hash || "#/unified");
  useEffect(() => {
    const fn = () => setHash(location.hash || "#/unified");
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  if (hash.startsWith("#/split")) return <DiffList diffStyle="split" />;
  if (hash.startsWith("#/annotations")) return <DiffList diffStyle="unified" annotate />;
  if (hash.startsWith("#/annotations-split"))
    return (
      <DiffList diffStyle="split" annotate />
    );
  if (hash.startsWith("#/perf")) return <PerfView />;
  if (hash.startsWith("#/trees")) return <TreesDemo />;
  if (hash.startsWith("#/shiki")) return <ShikiRows />;
  return <DiffList diffStyle="unified" />;
}

function App() {
  useTheme();
  return (
    <div className="spike-app">
      <nav className="spike-nav">
        <a href="#/unified">unified</a> <a href="#/split">split</a>{" "}
        <a href="#/annotations">annotations</a> <a href="#/annotations-split">ann-split</a>{" "}
        <a href="#/perf">perf</a> <a href="#/trees">trees</a> <a href="#/shiki">shiki</a>
      </nav>
      <Route />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
