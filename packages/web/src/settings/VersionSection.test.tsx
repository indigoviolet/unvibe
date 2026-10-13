/**
 * VersionSection switch-anyway flow (#36 follow-up): a running-jobs
 * refusal renders inline on the row (which jobs, what switching does to
 * them) with "Switch anyway" (re-posts with `force: true`) and Cancel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Settings, UpdateChannel, UpdateStatusResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { UpdateJobsBlockedError } from "../api/updateBlocked.js";
import { VersionSection } from "./VersionSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SETTINGS: Settings = {
  main: { provider: "claude", model: "mock-main" },
  small: { provider: "claude", model: "mock-small" },
  secondOpinion: { provider: "codex", model: "mock-second" },
  sessionsPerProvider: 4,
  inlineBudgetTokens: 40000,
  rebuildSupersededRatio: 0.2,
  rebuildAppendedTokens: 10000,
  logBatchTokens: 2000,
  cacheLifetimeMs: 300000,
  idleExitMinutes: 10,
  versionPickerEnabled: true,
};

const BUILD = { version: "0.0.1", sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: null, builtAt: null };

const CHANNELS: UpdateChannel[] = [
  { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, current: true },
  {
    ref: "preview/feat-x",
    kind: "preview",
    version: "0.0.1-preview.feat-x.abc1234",
    commit: "abc1234def5678",
    sourceBranch: "feat/x",
    sourceCommit: null,
    baseBranch: null,
    baseCommit: null,
    builtAt: new Date(Date.now() - 3600_000).toISOString(),
    current: false,
  },
];

function statusWith(outcome: UpdateStatusResponse["outcome"]): UpdateStatusResponse {
  return { enabled: true, build: BUILD, pending: null, outcome };
}

describe("VersionSection switch anyway", () => {
  it("refused switch shows the jobs inline; Switch anyway re-posts with force", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { reload }, writable: true });
    vi.spyOn(api, "health").mockResolvedValue({ ok: true, version: "0.0.1", build: BUILD });
    vi.spyOn(api, "updateChannels").mockResolvedValue({ channels: CHANNELS });
    let switched = false;
    vi.spyOn(api, "updateStatus").mockImplementation(async () =>
      switched
        ? statusWith({ status: "ok", from: "release", to: "preview/feat-x", finishedAt: new Date().toISOString() })
        : statusWith(null),
    );
    const updateSwitch = vi
      .spyOn(api, "updateSwitch")
      .mockRejectedValueOnce(
        new UpdateJobsBlockedError(
          2,
          [
            { id: "j1", kind: "explain", reviewId: "demo", state: "running", label: "Streaming answer…" },
            { id: "j2", kind: "hunk-pass", reviewId: "demo", state: "queued" },
          ],
          "cannot switch while 2 jobs are running",
        ),
      )
      .mockImplementation(async () => {
        switched = true;
        return { from: "release", to: "preview/feat-x" };
      });

    render(<VersionSection settings={SETTINGS} onSaved={() => {}} />);
    await screen.findByText("preview/feat-x");
    const feat = document.querySelector('[data-testid="update-channel"][data-ref="preview/feat-x"]')!;
    fireEvent.click(feat.querySelector("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm switch to preview/feat-x" }));

    // Inline on the row: which jobs, what switching does, both actions.
    const panel = await screen.findByTestId("update-blocked");
    expect(panel).toHaveTextContent("2 running jobs — switching stops them");
    expect(panel).toHaveTextContent("show as interrupted");
    expect(panel).toHaveTextContent("stay with this channel");
    expect(panel).toHaveTextContent("switch back to resume or retry them");
    expect(screen.getByTestId("update-blocked-jobs")).toHaveTextContent("explain · demo · running");
    expect(updateSwitch).toHaveBeenCalledWith("preview/feat-x", undefined);

    fireEvent.click(screen.getByRole("button", { name: "Switch anyway" }));
    await waitFor(() => expect(updateSwitch).toHaveBeenCalledWith("preview/feat-x", true));
    // Forced switch committed: the page waits out the restart, then reloads.
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("Cancel drops the refusal and restores the row", async () => {
    vi.spyOn(api, "health").mockResolvedValue({ ok: true, version: "0.0.1", build: BUILD });
    vi.spyOn(api, "updateChannels").mockResolvedValue({ channels: CHANNELS });
    vi.spyOn(api, "updateStatus").mockResolvedValue(statusWith(null));
    vi.spyOn(api, "updateSwitch").mockRejectedValue(
      new UpdateJobsBlockedError(1, [{ id: "j1", kind: "reader", state: "running" }]),
    );

    render(<VersionSection settings={SETTINGS} onSaved={() => {}} />);
    await screen.findByText("preview/feat-x");
    const feat = document.querySelector('[data-testid="update-channel"][data-ref="preview/feat-x"]')!;
    fireEvent.click(feat.querySelector("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm switch to preview/feat-x" }));
    await screen.findByTestId("update-blocked");

    fireEvent.click(screen.getByRole("button", { name: "Cancel switch to preview/feat-x" }));
    await waitFor(() => expect(screen.queryByTestId("update-blocked")).not.toBeInTheDocument());
    expect(feat.querySelector("button")).toHaveTextContent("Switch");
  });
});
