import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DebugPageRoute } from "./debug/DebugPage.js";
import { ReviewRoute } from "./ReviewRoute.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { StartPage } from "./start/StartPage.js";
import { DoctorPage } from "./doctor/DoctorPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartPage />} />
        {/* Splat: the guide keeps its page in the URL (`/review/:id/page/:pageId`). */}
        {/* Static `debug` outranks the splat: the per-review debug page. */}
        <Route path="/review/:id/debug" element={<DebugPageRoute />} />
        <Route path="/review/:id/*" element={<ReviewRoute />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/doctor" element={<DoctorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
