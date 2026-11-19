/**
 * Experimental features (issue #422): gates for unfinished work. Both
 * toggles are off by default and take effect without a restart — the
 * gated surfaces read settings when they render.
 *
 * - Explain terms: the card's Help-me-understand button. Off, it is a
 *   plain Simplify press (one click runs Simplify); term picking is
 *   unreachable. On, it opens the Simplify / Explain terms… menu (#418).
 * - Markdown docs: document reviews. Off, every document entry point
 *   hides (the top-bar link, the document form and list, doc creation)
 *   while existing doc reviews stay in storage. On, they work.
 */
import { useState } from "react";
import type { ExperimentalSettings, Settings } from "@unvibe/shared";
import { api } from "../api/client.js";
import { Card, Checkbox, Field as UiField } from "../ui/index.js";
import { putErrors } from "./LimitsSection.js";

export function ExperimentalSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current: ExperimentalSettings = settings.experimental ?? {
    explainTerms: false,
    markdownDocs: false,
  };

  const toggle = async (leaf: keyof ExperimentalSettings): Promise<void> => {
    setToggling(leaf);
    setError(null);
    try {
      const next = await api.saveSettings({
        experimental: { ...current, [leaf]: !current[leaf] },
      });
      onSaved(next);
    } catch (err) {
      setError(putErrors(err).join("; "));
    } finally {
      setToggling(null);
    }
  };

  return (
    <section aria-label="Experimental">
      {/* No title here: the Settings tab names the section, like the other sections. */}
      <Card variant="raised">
        <div className="ui-fields">
          <UiField
            label="Explain terms"
            htmlFor="experimental-explain-terms"
            help="When on, a card's Help me understand button offers Simplify or picking words in the card to explain. When off, it runs Simplify at once."
          >
            <Checkbox
              id="experimental-explain-terms"
              testId="experimental-explain-terms"
              ariaLabel="Explain terms"
              checked={current.explainTerms === true}
              disabled={toggling !== null}
              onChange={() => void toggle("explainTerms")}
            />
          </UiField>
          <UiField
            label="Markdown docs"
            htmlFor="experimental-markdown-docs"
            help="When on, pasted-Markdown documents open as reviews with repos as context. When off, the Documents entry points hide and doc creation is refused."
          >
            <Checkbox
              id="experimental-markdown-docs"
              testId="experimental-markdown-docs"
              ariaLabel="Markdown docs"
              checked={current.markdownDocs === true}
              disabled={toggling !== null}
              onChange={() => void toggle("markdownDocs")}
            />
          </UiField>
        </div>
        {error ? (
          <p className="err" role="alert">
            Couldn&apos;t save: {error}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
