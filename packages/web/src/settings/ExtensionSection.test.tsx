import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Settings } from "@unvibe/shared";
import { api } from "../api/client.js";
import { ExtensionSection } from "./ExtensionSection.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settings: Settings = {
  uiTheme: "default",
  main: { provider: "claude", model: "mock-main", effort: "" },
  small: { provider: "claude", model: "mock-small", effort: "" },
  personas: [],
  sessionsPerProvider: 4, inlineBudgetTokens: 40000, rebuildSupersededRatio: 0.2,
  rebuildAppendedTokens: 10000, logBatchTokens: 2000, cacheLifetimeMs: 300000,
  idleExitMinutes: 10, hunkSummaryLimit: 50, versionPickerEnabled: false, fullAccess: false,
  fullAccessAcknowledgedAt: null, autoGoDeeper: true, recordTraces: false,
  extensionActiveRepoIds: null,
  extensionModel: { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" },
};

describe("ExtensionSection", () => {
  it("provider reads pi even when the providers list omits it (tour stub)", async () => {
    vi.spyOn(api, "repos").mockResolvedValue({ repos: [] });
    vi.spyOn(api, "extensionStatus").mockResolvedValue({ extensionPath: "/x/extension", lastWorkerCallAt: null, connected: false });
    vi.spyOn(api, "providers").mockResolvedValue({ providers: ["claude", "codex"] });
    vi.spyOn(api, "models").mockResolvedValue({ provider: "pi", models: [{ id: "muse-spark-1.3-contributor" }] });
    render(<ExtensionSection settings={settings} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveTextContent("pi"));
    expect(screen.getByTestId("extension-status")).toHaveTextContent("Extension not installed");
  });
});
