/**
 * Expanded prompts for this review (issue #32, PRD §13–§14): per template,
 * the exact text that would be sent now, with layers L0–L4 marked, token
 * counts per layer, and the cached part set apart. Relocated unchanged from
 * the Settings "Expanded for this review" view to the debug page, which is
 * always review-scoped; the rendering below is the same component.
 */
import { useEffect, useState } from "react";
import type { PromptExpanded, PromptTemplate, PromptsResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { formatTokens, splitLayers } from "../versions/versionUtils.js";
import { Card } from "../ui/index.js";

export function ExpandedPrompts({ reviewId }: { reviewId: string }): React.JSX.Element {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-template open state lives here (not in the cards) so Expand all /
  // Collapse all is one state update, and switching tabs never loses it.
  const [openNames, setOpenNames] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .prompts(reviewId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const expandedByName = new Map((data?.expanded ?? []).map((e) => [e.name, e]));
  const templates = data?.templates ?? [];

  const setAll = (value: boolean): void => {
    const next: Record<string, boolean> = {};
    if (value) for (const t of templates) next[t.name] = true;
    setOpenNames(next);
  };

  return (
    <section aria-label="Prompts">
      {error ? <p className="err">{error}</p> : null}
      {!data && !error ? <p className="hint">Loading expanded prompts…</p> : null}
      {data?.templates.length === 0 ? <p className="hint">No prompts.</p> : null}
      {templates.length > 0 ? (
        <div className="frow" style={{ gap: 8, margin: "6px 0" }}>
          <span className="sp" />
          <button className="x" type="button" onClick={() => setAll(true)}>
            Expand all
          </button>
          <button className="x" type="button" onClick={() => setAll(false)}>
            Collapse all
          </button>
        </div>
      ) : null}
      {templates.map((t) => (
        <PromptCard
          key={t.name}
          template={t}
          expanded={expandedByName.get(t.name)}
          open={openNames[t.name] === true}
          onToggle={() => setOpenNames((prev) => ({ ...prev, [t.name]: !prev[t.name] }))}
        />
      ))}
    </section>
  );
}

function PromptCard({
  template,
  expanded,
  open,
  onToggle,
}: {
  template: PromptTemplate;
  expanded: PromptExpanded | undefined;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <Card variant="plain" style={{ padding: "8px 14px" }} data-testid={`prompt-${template.name}`}>
      <div className="frow" style={{ gap: 8 }}>
        <button
          className="ib"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${template.name}` : `Expand ${template.name}`}
          onClick={onToggle}
        >
          {open ? "▾" : "▸"}
        </button>
        <code>{template.name}</code>
        <span className="hint">
          {template.role} · {template.tier}
        </span>
      </div>
      {open ? (
        expanded ? (
          <ExpandedView expanded={expanded} />
        ) : (
          <p className="hint">No expanded text for this review.</p>
        )
      ) : null}
    </Card>
  );
}

function ExpandedView({ expanded }: { expanded: PromptExpanded }): React.JSX.Element {
  const sections = splitLayers(expanded.expanded);
  const total = expanded.layers.reduce((s, l) => s + l.tokens, 0);
  const [copied, setCopied] = useState(false);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (permissions): the text stays selectable.
    }
  };

  return (
    <div>
      <div className="frow" style={{ gap: 8, margin: "6px 0" }}>
        <span className="hint">
          {formatTokens(total)} total · {formatTokens(expanded.cachedTokens)} cached
        </span>
        <span className="sp" />
        <button className="x" type="button" onClick={() => void copy(expanded.expanded)}>
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      {sections.map((s, i) =>
        s.layer === "" ? (
          <details className="lay" key={i}>
            <summary>
              <b>Text</b>
              <span className="hint">outside any layer</span>
            </summary>
            <pre className="code">{s.text}</pre>
          </details>
        ) : (
          <details className={`lay${s.cached ? " cached" : ""}`} key={`${s.layer}-${i}`} data-layer={s.layer}>
            <summary>
              <b>{s.layer}</b>
              <span className="hint">{s.label}</span>
              <span className="hint">{formatTokens(s.tokens)}</span>
              {s.cached ? <span className="st running">cached</span> : null}
              <span className="sp" />
              <button
                className="x"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void copy(s.text);
                }}
              >
                Copy
              </button>
            </summary>
            <pre className="code">{s.text}</pre>
          </details>
        ),
      )}
    </div>
  );
}
