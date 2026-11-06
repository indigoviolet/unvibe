// DISABLED(#188): covered by J11 (full-access toggle)
/**
 * AccessSection (issue #160): read-only state, the warning confirm step,
 * enabling with the acknowledgement, and turning it off again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Settings } from "@unvibe/shared";
import { api } from "../api/client.js";
import { AccessSection } from "./AccessSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function settingsWith(fullAccess: boolean): Settings {
  return {
    main: { provider: "claude", model: "mock-main", effort: "" },
    small: { provider: "claude", model: "mock-small", effort: "" },
    personas: [],
    sessionsPerProvider: 4,
    inlineBudgetTokens: 40000,
    rebuildSupersededRatio: 0.2,
    rebuildAppendedTokens: 10000,
    logBatchTokens: 2000,
    cacheLifetimeMs: 300000,
    idleExitMinutes: 10,
    uiTheme: "default",
  versionPickerEnabled: false,
    fullAccess,
    autoGoDeeper: true,
  extensionActiveRepoIds: null,
  extensionModel: { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" },
  fullAccessAcknowledgedAt: fullAccess ? 123 : null,
  };
}

describe("AccessSection", () => {
  it("read-only state offers the warning confirm step, then enables with the acknowledgement", async () => {
    let saved: Partial<Settings> = {};
    vi.spyOn(api, "saveSettings").mockImplementation(async (body) => {
      saved = body;
      return settingsWith(true);
    });
    const onSaved = vi.fn();
    render(<AccessSection settings={settingsWith(false)} onSaved={onSaved} />);
    expect(screen.getByTestId("access-state")).toHaveTextContent("Read-only.");
    expect(screen.queryByTestId("access-warning")).toBeNull();

    // #346: the shared inline confirm ("Confirm full access" ✓ ✕) with
    // one short line for what it means; the full warning is the tooltip.
    fireEvent.click(screen.getByRole("button", { name: "Turn on full access" }));
    const warning = screen.getByTestId("access-warning");
    expect(warning).toHaveTextContent("Confirm full access");
    expect(warning).toHaveTextContent("can run shell commands, git and gh as you");

    fireEvent.click(screen.getByRole("button", { name: "Confirm full access" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saved).toMatchObject({ fullAccess: true });
    expect(saved.fullAccessAcknowledgedAt).toEqual(expect.any(Number));
  });

  it("full-access state offers turning off", async () => {
    let saved: Partial<Settings> = {};
    vi.spyOn(api, "saveSettings").mockImplementation(async (body) => {
      saved = body;
      return settingsWith(false);
    });
    const onSaved = vi.fn();
    render(<AccessSection settings={settingsWith(true)} onSaved={onSaved} />);
    expect(screen.getByTestId("access-state")).toHaveTextContent("Full access is on.");

    fireEvent.click(screen.getByRole("button", { name: "Turn off full access" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saved).toMatchObject({ fullAccess: false });
  });

  it("save failures render inline", async () => {
    vi.spyOn(api, "saveSettings").mockRejectedValue(new Error("PUT /api/settings: 400 no"));
    render(<AccessSection settings={settingsWith(false)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on full access" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm full access" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  });
});
