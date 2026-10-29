import { useEffect, useState } from "react";
import type { DataFormatStatusResponse } from "@unvibe/shared";
import { DataFormatNotice } from "./data-format/DataFormatNotice.js";
import { BrowserRouter, Route, Routes } from "react-router";
import { api } from "./api/client.js";
import { syncUiThemeFromSettings } from "./theme/theme.js";
import { RouteShellBoundary } from "./components/ErrorBoundary.js";
import { DebugPageRoute } from "./debug/DebugPage.js";
import { ReviewRoute } from "./ReviewRoute.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { StartPage } from "./start/StartPage.js";
import { DocumentsPage } from "./start/DocumentsPage.js";
import { DoctorPage } from "./doctor/DoctorPage.js";

export function App() {
  // #311: a stored-format mismatch gates the whole app on the reset
  // notice — the normal UI never renders against unreadable data.
  const [format, setFormat] = useState<DataFormatStatusResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .dataFormat()
      .then((s) => {
        if (!cancelled) setFormat(s);
      })
      .catch(() => {
        // Unreachable service: the normal UI's own errors stand.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // UI theme (issue #196): the boot script applied the mirrored theme
  // before first paint; reconcile with the persisted setting once known
  // (a theme saved in another browser, or a cleared mirror, wins here).
  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) syncUiThemeFromSettings(s.uiTheme);
      })
      .catch(() => {
        // Settings unreachable: the boot theme stands.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (format?.state === "mismatch")
    return (
      <BrowserRouter>
        <DataFormatNotice status={format} />
      </BrowserRouter>
    );
  return (
    <BrowserRouter>
      <RouteShellBoundary>
        <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        {/* Splat: the guide keeps its page in the URL (`/review/:id/page/:pageId`). */}
        {/* Static `debug` outranks the splat: the per-review debug page. */}
        <Route path="/review/:id/debug" element={<DebugPageRoute />} />
        <Route path="/review/:id/*" element={<ReviewRoute />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/doctor" element={<DoctorPage />} />
        </Routes>
      </RouteShellBoundary>
    </BrowserRouter>
  );
}
