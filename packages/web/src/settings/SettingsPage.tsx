/**
 * Settings page (`/settings`, PRD §4.14): repositories, models, prompt
 * templates, limits and budgets. App-level only: nothing here is
 * review-scoped. Jobs, the per-review prompt expansions and shared
 * context live on the per-review debug page (`/review/:id/debug`,
 * issue #32), not here. The Repositories section carries
 * `#repositories` so the start page's empty state can link straight to
 * it.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { EnvironmentSection } from "./EnvironmentSection.js";
import { LimitsSection } from "./LimitsSection.js";
import { ModelsSection } from "./ModelsSection.js";
import { PromptsSection } from "./PromptsSection.js";
import { RepositoriesSection } from "./RepositoriesSection.js";
import { Toast } from "../floating/Toast.js";
import "./settings.css";

export function SettingsPage(): React.JSX.Element {
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

  return (
    <div className="app">
      <Toast />
      <header className="top">
        <Link className="brand" to="/" title="Back to the start screen">
          Unvibe
        </Link>
        <div className="pr">
          <b>Settings</b>
        </div>
        <Link className="tbtn" to="/">
          Back to start
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <div className="eyebrow">Settings</div>
          <h1 className="title">Repositories, models, prompts, limits</h1>
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
              <PromptsSection />
              <LimitsSection settings={settings} onSaved={setSettings} />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
