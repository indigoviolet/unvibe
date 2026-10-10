import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initTokenFromUrl } from "./api/client.js";
import "./styles/prototype.css";

initTokenFromUrl();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
