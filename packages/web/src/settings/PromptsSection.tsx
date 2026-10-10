/**
 * Prompts section (PRD §4.14): every template in two views — Template (raw
 * text with `{{variables}}` marked, front matter as role/tier/variables)
 * and Expanded for this review (exact text that would be sent now, layers
 * L0–L4 marked, token counts per layer, cached part set apart). View-only.
 * Layers stay collapsed by default so large texts stay fast; every layer
 * and the whole expansion are copyable.
 */
import { useEffect, useState } from "react";
import type { PromptExpanded, PromptTemplate, PromptsResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { formatTokens, splitLayers } from "../versions/versionUtils.js";

export function PromptsSection({ reviewId }: { reviewId: string | null }): React.JSX.Element {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .prompts(reviewId ?? undefined)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const expandedByName = new Map((data?.expanded ?? []).map((e) => [e.name, e]));

  return (
    <section aria-label="Prompts">
      <div className="divider">Prompts</div>
      {error ? <p className="err">{error}</p> : null}
      {!data && !error ? <p className="hint">Loading templates…</p> : null}
      {data?.templates.length === 0 ? <p className="hint">No templates.</p> : null}
      {(data?.templates ?? []).map((t) => (
        <PromptCard key={t.name} template={t} expanded={expandedByName.get(t.name)} reviewId={reviewId} />
      ))}
    </section>
  );
}

function PromptCard({
  template,
  expanded,
  reviewId,
}: {
  template: PromptTemplate;
  expanded: PromptExpanded | undefined;
  reviewId: string | null;
}): React.JSX.Element {
  const [view, setView] = useState<"template" | "expanded">("template");
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ padding: "8px 14px" }} data-testid={`prompt-${template.name}`}>
      <div className="frow" style={{ gap: 8 }}>
        <button
          className="ib"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${template.name}` : `Expand ${template.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"}
        </button>
        <code>{template.name}</code>
        <span className="hint">
          {template.role} · {template.tier}
        </span>
        <span className="sp" />
        {open ? (
          <span className="seg" role="group" aria-label={`${template.name} view`}>
            <button type="button" aria-pressed={view === "template"} onClick={() => setView("template")}>
              Template
            </button>
            <button
              type="button"
              aria-pressed={view === "expanded"}
              disabled={!reviewId}
              title={reviewId ? "The exact text that would be sent now" : "Open settings from a review to expand"}
              onClick={() => setView("expanded")}
            >
              Expanded for this review
            </button>
          </span>
        ) : null}
      </div>
      {open && view === "template" ? <TemplateView template={template} /> : null}
      {open && view === "expanded" ? (
        expanded ? (
          <ExpandedView expanded={expanded} />
        ) : (
          <p className="hint">No expansion for this review.</p>
        )
      ) : null}
    </div>
  );
}

/** Raw text with `{{variables}}` marked; front matter as role/tier/variables. */
export function TemplateView({ template }: { template: PromptTemplate }): React.JSX.Element {
  return (
    <div>
      <p className="hint" style={{ margin: "6px 0" }}>
        role: <code>{template.role}</code> · tier: <code>{template.tier}</code> · variables:{" "}
        {template.variables.length > 0 ? template.variables.map((v) => <code key={v}>{`{{${v}}}`}</code>).join(" ") : "—"}
      </p>
      <pre className="code">{renderTemplateText(template.template)}</pre>
    </div>
  );
}

const VAR_RE = /(\{\{[a-zA-Z0-9_.]+\}\})/g;
const VAR_EXACT = /^\{\{[a-zA-Z0-9_.]+\}\}$/;

function renderTemplateText(text: string): React.ReactNode {
  return text.split(VAR_RE).map((part, i) =>
    VAR_EXACT.test(part) ? (
      <mark className="tm" key={i}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
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
          <pre className="code" key={i}>
            {s.text}
          </pre>
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
