/**
 * Option 3 probe: highlight our existing diff rows with Shiki tokens directly
 * (no @pierre/diffs render). Measures size + CSP impact of Shiki alone.
 */
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

const SAMPLES: { lang: string; code: string }[] = [
  { lang: "python", code: "def _normalize_header_value(value: str) -> str:\n    if \"\\r\\n\" not in value:\n        return value\n    return _OBSOLETE_FOLD_RE.sub(\" \", value)\n" },
  { lang: "typescript", code: "export function pairSplitRows(lines: HunkLine[]): SplitRow[] {\n  const out: SplitRow[] = [];\n  return out;\n}\n" },
  { lang: "markdown", code: "# Title\n\nSome **bold** text with `code`.\n" },
  { lang: "json", code: "{ \"name\": \"unvibe\", \"private\": true }\n" },
];

export function ShikiRows() {
  const [html, setHtml] = useState<string[]>([]);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const t0 = performance.now();
    Promise.all(
      SAMPLES.map((s) =>
        codeToHtml(s.code, { lang: s.lang as any, theme: "github-light" }),
      ),
    ).then((r) => {
      setHtml(r);
      setMs(performance.now() - t0);
    });
  }, []);
  return (
    <div data-shiki-demo ms={ms ?? undefined}>
      <p data-shiki-time>
        shiki highlight {SAMPLES.length} samples: {ms === null ? "…" : `${Math.round(ms)}ms`}
      </p>
      {html.map((h, i) => (
        <div key={i} className="spike-shiki-row" dangerouslySetInnerHTML={{ __html: h }} />
      ))}
    </div>
  );
}
