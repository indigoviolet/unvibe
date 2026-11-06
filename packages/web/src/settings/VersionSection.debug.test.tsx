/**
 * VersionSection debug badge (issue #356): debug channels read clearly
 * as debug in the version picker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Settings, UpdateChannel } from "@unvibe/shared";
import { api } from "../api/client.js";
import { VersionSection } from "./VersionSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings: Settings = {
  uiTheme: "default",
  main: { provider: "claude", model: "mock-main", effort: "" },
  small: { provider: "claude", model: "mock-small", effort: "" },
  personas: [],
  sessionsPerProvider: 4, inlineBudgetTokens: 40000, rebuildSupersededRatio: 0.2,
  rebuildAppendedTokens: 10000, logBatchTokens: 2000, cacheLifetimeMs: 300000,
  idleExitMinutes: 10, versionPickerEnabled: true, fullAccess: false,
  fullAccessAcknowledgedAt: null, autoGoDeeper: true, recordTraces: false,
  extensionActiveRepoIds: null,
  extensionModel: { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" },
};

const build = {
  version: "0.0.17", channel: "release", sourceBranch: null, sourceCommit: null,
  baseBranch: null, baseCommit: null, commit: null, builtAt: null, dataFormat: 1,
};

const CHANNELS: UpdateChannel[] = [
  { ref: "release", kind: "release", version: "0.0.17", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: true },
  { ref: "release-debug", kind: "release", version: "0.0.17-debug", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: false },
  { ref: "preview/feat-x-debug", kind: "preview", version: "0.0.17-preview.feat-x-debug.abc1234", commit: null, sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: false },
];

describe("VersionSection debug channels", () => {
  it("marks debug channels with a badge", async () => {
    vi.spyOn(api, "updateStatus").mockResolvedValue({ enabled: true, build, pending: null, outcome: null });
    vi.spyOn(api, "updateChannels").mockResolvedValue({ channels: CHANNELS });
    render(<VersionSection settings={settings} onSaved={() => {}} />);
    const badges = await screen.findAllByTestId("update-debug");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("debug");
    // The lean release row stays unmarked.
    const rows = screen.getAllByTestId("update-channel");
    const releaseRow = rows.find((r) => r.getAttribute("data-ref") === "release")!;
    expect(releaseRow.querySelector('[data-testid="update-debug"]')).toBeNull();
  });
});
