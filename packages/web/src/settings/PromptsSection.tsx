/**
 * Prompts section (PRD §4.14): every template — the raw text with
 * `{{variables}}` marked, front matter as role/tier/variables. View-only.
 * The per-review "Expanded for this review" view lives on the debug page
 * (`/review/:id/debug`, issue #32), so this section is review-agnostic.
 */
import { useEffect, useState } from "react";
import type { PromptTemplate, PromptsResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Card } from "../ui/index.js";

export function PromptsSection(): React.JSX.Element {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .prompts()
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-label="Prompts">
      {error ? <p className="err">{error}</p> : null}
      {!data && !error ? <p className="hint">Loading prompts…</p> : null}
      {data?.templates.length === 0 ? <p className="hint">No prompts.</p> : null}
      {(data?.templates ?? []).map((t) => (
        <PromptCard key={t.name} template={t} />
      ))}
    </section>
  );
}

function PromptCard({ template }: { template: PromptTemplate }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Card variant="raised" data-testid={`prompt-${template.name}`}>
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
      </div>
      {open ? <TemplateView template={template} /> : null}
    </Card>
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
