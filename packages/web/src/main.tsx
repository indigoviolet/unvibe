import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initTokenFromUrl } from "./api/client.js";
import { initSentry } from "./sentry.js";
// Self-hosted fonts (no external requests, PRD §16). Default theme is
// stack B (issue #274): Literata variable (prose, enables the lighter
// dark-mode weight), Inter variable (UI), JetBrains Mono variable (code).
// Variable faces cover every weight in one file; latin is the subset the
// browser downloads (unicode-range splits the rest). Italic only where
// the old stack had it (prose).
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/prototype.css";
import { currentUiTheme, ensureThemeFonts } from "./theme/theme.js";

initSentry();
initTokenFromUrl();
// Start the selected theme's font bundle before first render (issue
// #196); the boot script has already set `data-ui-theme` on <html>.
ensureThemeFonts(currentUiTheme());

// Installable web app (PRD §14): cache the app shell + offline page.
// Moved here from an inline <script> so the HTML shell can serve a strict
// CSP without `unsafe-inline` for scripts.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
