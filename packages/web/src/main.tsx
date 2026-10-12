import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initTokenFromUrl } from "./api/client.js";
import { initSentry } from "./sentry.js";
// Self-hosted fonts (no external requests, PRD §16): latin subsets only.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-400-italic.css";
import "@fontsource/source-serif-4/latin-600.css";
import "./styles/prototype.css";

initSentry();
initTokenFromUrl();

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
