/**
 * Settings page (`/settings`, PRD §4.14): repositories, models,
 * environment, prompt templates, limits and budgets, plus the version
 * picker (Settings → Version, issue #36, off by default). App-level only:
 * nothing here is review-scoped. Jobs, the per-review prompt expansions
 * and shared context live on the per-review debug page
 * (`/review/:id/debug`, issue #32), not here.
 *
 * The six sections sit in tabs (issue #61) sharing the tab strip with the
 * debug page. The selected tab lives in the `?tab=` query parameter;
 * older `#section` links (the start page's empty state, readiness
 * callouts, Doctor) still land on the right tab. Every panel stays
 * mounted behind `hidden`, so unsaved form edits survive a tab switch.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { TabPanel, Tabs, tabIdFromHash, useQueryTab } from "../tabs/Tabs.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import { DataSection } from "./DataSection.js";
import { AccessSection } from "./AccessSection.js";
import { EnvironmentSection } from "./EnvironmentSection.js";
import { LimitsSection } from "./LimitsSection.js";
import { ModelsSection } from "./ModelsSection.js";
import { PromptsSection } from "./PromptsSection.js";
import { VersionSection } from "./VersionSection.js";
import { AppearanceSection } from "./AppearanceSection.js";
import { RepositoriesSection } from "./RepositoriesSection.js";
import { Toast } from "../floating/Toast.js";
import "./settings.css";

const SETTING_TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "repositories", label: "Repos" },
  { id: "models", label: "Models" },
  { id: "access", label: "Access" },
  { id: "environment", label: "Environment" },
  { id: "prompts", label: "Prompts" },
  { id: "limits", label: "Limits" },
  { id: "version", label: "Version" },
  { id: "data", label: "Data" },
] as const;

const SETTING_TAB_IDS: readonly string[] = SETTING_TABS.map((t) => t.id);

export function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useQueryTab(SETTING_TAB_IDS, "repositories");
  const location = useLocation();

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
    return () => {
      cancelled = true;
    };
  }, []);

  // Older `#section` links land on the matching tab (only when no `?tab=`
  // is given), then scroll the anchored section into view after paint.
  // Location-driven (not window-driven) so a hash-only navigation while
  // the page is already open switches tabs too.
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.get("tab")) {
        const fromHash = tabIdFromHash(location.hash, SETTING_TAB_IDS);
        if (fromHash) setTab(fromHash);
      }
      if (location.hash) {
        const t = window.setTimeout(() => {
          document.querySelector(location.hash)?.scrollIntoView({ block: "start" });
        }, 50);
        return () => window.clearTimeout(t);
      }
    } catch {
      // Ignore.
    }
    return () => {};
  }, [location.search, location.hash, setTab, tab]);

  return (
    <div className="app">
      <Toast />
      <ScreenTopBar crumbs={[{ label: "Settings" }]} showBadge hideSettings />
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          {error ? (
            <p className="err" role="alert">
              Couldn&apos;t load settings: {error}
            </p>
          ) : null}
          {!settings && !error ? <p className="hint">Loading settings…</p> : null}
          {settings ? (
            <>
              <Tabs
                label="Settings sections"
                tabs={SETTING_TABS}
                active={tab}
                onSelect={setTab}
                idPrefix="settings"
              />
              <TabPanel idPrefix="settings" id="appearance" active={tab === "appearance"}>
                <AppearanceSection settings={settings} onSaved={setSettings} />
              </TabPanel>
              <TabPanel idPrefix="settings" id="repositories" active={tab === "repositories"}>
                <RepositoriesSection />
              </TabPanel>
              <TabPanel idPrefix="settings" id="models" active={tab === "models"}>
                <ModelsSection settings={settings} onSaved={setSettings} />
              </TabPanel>
              <TabPanel idPrefix="settings" id="access" active={tab === "access"}>
                <AccessSection settings={settings} onSaved={setSettings} />
              </TabPanel>
              <TabPanel idPrefix="settings" id="environment" active={tab === "environment"}>
                <EnvironmentSection />
              </TabPanel>
              <TabPanel idPrefix="settings" id="prompts" active={tab === "prompts"}>
                <PromptsSection />
              </TabPanel>
              <TabPanel idPrefix="settings" id="limits" active={tab === "limits"}>
                <LimitsSection settings={settings} onSaved={setSettings} />
              </TabPanel>
              <TabPanel idPrefix="settings" id="version" active={tab === "version"}>
                <VersionSection settings={settings} onSaved={setSettings} />
              </TabPanel>
              <TabPanel idPrefix="settings" id="data" active={tab === "data"}>
                <DataSection />
              </TabPanel>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
