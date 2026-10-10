/**
 * Settings page (`/settings`). Owner: settings agent.
 * Models, prompts (template + expanded), limits, jobs, shared context.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Settings } from "@unvibe/shared";

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch(() => {
        // Scaffold: service stubs return 501.
      });
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div className="pr">
          <b>Settings</b>
        </div>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <h1 className="title">Settings</h1>
          <p className="hint">
            Scaffold placeholder (settings agent owns this): model pickers, prompt templates +
            expanded text, limits/budgets, jobs, shared context.
          </p>
          {settings && <pre className="code">{JSON.stringify(settings, null, 2)}</pre>}
        </div>
      </main>
    </div>
  );
}
