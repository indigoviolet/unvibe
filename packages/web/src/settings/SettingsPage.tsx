/**
 * Settings page (`/settings`, PRD §4.14): repositories, models, prompts
 * (template + expanded), limits and budgets, jobs, shared context.
 *
 * Reachable from the top bar and the start page; also openable in the
 * context of a review (`/settings?review=:id`), which gives "Expanded for
 * this review" and the Jobs / Shared context sections a subject. The
 * Repositories section carries `#repositories` so the start page's empty
 * state can link straight to it.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ContributionsSection } from "./ContributionsSection.js";
import { EnvironmentSection } from "./EnvironmentSection.js";
import { JobsSection } from "./JobsSection.js";
import { LimitsSection } from "./LimitsSection.js";
import { ModelsSection } from "./ModelsSection.js";
import { PromptsSection } from "./PromptsSection.js";
import { RepositoriesSection } from "./RepositoriesSection.js";
import "./settings.css";

export function SettingsPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const reviewId = params.get("review");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyError(err));
      });
    // Front-screen callouts link to /settings#environment / #models:
    // scroll the anchored section into view after first paint.
    try {
      const hash = window.location.hash;
      if (hash) {
        const t = window.setTimeout(() => {
          document.querySelector(hash)?.scrollIntoView({ block: "start" });
        }, 50);
        return () => {
          cancelled = true;
          window.clearTimeout(t);
        };
      }
    } catch {
      // Ignore.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const back = reviewId ? `/review/${reviewId}` : "/";

  return (
    <div className="app">
      <header className="top">
        <Link className="brand" to="/" title="Back to the start screen">
          Unvibe
        </Link>
        <div className="pr">
          <b>Settings</b>
        </div>
        <Link className="tbtn" to={back}>
          {reviewId ? "Back to review" : "Back to start"}
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <div className="eyebrow">Settings</div>
          <h1 className="title">Repositories, models, prompts, limits, jobs, shared context</h1>
          {error ? (
            <p className="err" role="alert">
              Couldn&apos;t load settings: {error}
            </p>
          ) : null}
          {!settings && !error ? <p className="hint">Loading settings…</p> : null}
          {settings ? (
            <>
              <RepositoriesSection />
              <ModelsSection settings={settings} onSaved={setSettings} />
              <EnvironmentSection />
              <PromptsSection reviewId={reviewId} />
              <LimitsSection settings={settings} onSaved={setSettings} />
              <JobsSection reviewId={reviewId} />
              <ContributionsSection reviewId={reviewId} />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
