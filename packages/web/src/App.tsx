import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ReviewRoute } from "./ReviewRoute.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { StartPage } from "./start/StartPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/review/:id" element={<ReviewRoute />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
