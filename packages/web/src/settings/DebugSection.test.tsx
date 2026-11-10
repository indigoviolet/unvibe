/**
 * Debug section units (#356, #366, `VITE_MOCK=1`): the recording switch
 * saves the setting and arms the browser SDK, size/capped status
 * renders, Clear runs through the inline confirm, and the trace export
 * downloads a file. The lean build records no stats at all and names
 * the debug install instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Settings, TraceStatusResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { DebugSection } from "./DebugSection.js";

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
  idleExitMinutes: 10, hunkSummaryLimit: 50, versionPickerEnabled: false, fullAccess: false,
  fullAccessAcknowledgedAt: null, autoGoDeeper: true, recordTraces: false,
  extensionActiveRepoIds: null,
  extensionModel: { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" },
};

const idle: TraceStatusResponse = { recording: false, spans: 0, bytes: 0, capped: false };

/** jsdom has no PointerEvent; Base UI's Switch constructs one on click. */
function stubPointerEvent(): void {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w["PointerEvent"] !== "function") {
    w["PointerEvent"] = class extends MouseEvent {
      constructor(type: string, init?: MouseEventInit) {
        super(type, init);
      }
    };
  }
}

function mockUrls(): string[] {
  const urls: string[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      urls.push(blob.type);
      return "blob:mock";
    }),
    revokeObjectURL: vi.fn(),
  });
  return urls;
}

describe("DebugSection", () => {
  it("switch saves recordTraces and reports the state", async () => {
    stubPointerEvent();
    vi.spyOn(api, "traceStatus").mockResolvedValue(idle);
    const save = vi.spyOn(api, "saveSettings").mockImplementation(async (body) => ({ ...settings, ...body }));
    const onSaved = vi.fn();
    const { rerender } = render(<DebugSection settings={settings} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByTestId("trace-state")).toHaveTextContent("Off"));
    fireEvent.click(screen.getByLabelText("Record performance traces"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ recordTraces: true }));
    expect(onSaved).toHaveBeenCalled();
    rerender(<DebugSection settings={{ ...settings, recordTraces: true }} onSaved={onSaved} />);
    expect(screen.getByTestId("trace-state")).toHaveTextContent("Recording");
    vi.unstubAllGlobals();
  });

  it("shows size, recording state and the cap notice", async () => {
    vi.spyOn(api, "traceStatus").mockResolvedValue({ recording: false, spans: 42, bytes: 2048, capped: true });
    render(<DebugSection settings={{ ...settings, recordTraces: true }} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("trace-size")).toHaveTextContent("42 spans"));
    expect(screen.getByTestId("trace-size")).toHaveTextContent("2.0 KB");
    expect(screen.getByTestId("trace-size")).toHaveTextContent("paused");
    expect(screen.getByTestId("trace-state")).toHaveTextContent("Paused (size limit)");
    expect(screen.getByRole("alert")).toHaveTextContent("256");
  });

  it("Clear stays enabled on an over-cap store with no counted spans", async () => {
    vi.spyOn(api, "traceStatus").mockResolvedValue({ recording: false, spans: 0, bytes: 300 * 1024 * 1024, capped: true });
    vi.spyOn(api, "traceClear").mockResolvedValue({ recording: false, spans: 0, bytes: 0, capped: false });
    render(<DebugSection settings={settings} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear traces" })).toBeEnabled());
    // ...while Export still needs spans to write.
    await waitFor(() => expect(screen.getByRole("button", { name: "Export traces" })).toBeDisabled());
  });

  it("lean build records no stats and shows the matching debug install command", async () => {
    vi.spyOn(api, "traceStatus").mockRejectedValue(new Error("GET /api/traces/status: 501 no traces"));
    vi.spyOn(api, "updateStatus").mockResolvedValue({
      enabled: true,
      build: { version: "0.0.15", channel: "preview/feat-x", sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: null, builtAt: null, dataFormat: 1 },
      pending: null,
      outcome: null,
    });
    render(<DebugSection settings={settings} onSaved={() => {}} />);
    expect(await screen.findByText(/records no usage statistics/)).toBeInTheDocument();
    // The debug install command shows once, under Performance traces.
    expect(await screen.findAllByText(/aren't available in this build/)).toHaveLength(1);
    expect(screen.getAllByText("npm install -g github:indigoviolet/unvibe#preview/feat-x-debug")).toHaveLength(1);
    expect(screen.queryByLabelText("Record performance traces")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export traces" })).not.toBeInTheDocument();
  });

  it("debug build points usage statistics at the trace export", async () => {
    vi.spyOn(api, "traceStatus").mockResolvedValue(idle);
    render(<DebugSection settings={settings} onSaved={() => {}} />);
    expect(await screen.findByText(/Usage statistics live in the performance-trace export/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export statistics" })).not.toBeInTheDocument();
  });

  it(" Clear runs through the inline confirm and reports", async () => {
    vi.spyOn(api, "traceStatus").mockResolvedValue({ recording: true, spans: 7, bytes: 512, capped: false });
    const clear = vi.spyOn(api, "traceClear").mockResolvedValue({ recording: true, spans: 0, bytes: 0, capped: false });
    render(<DebugSection settings={settings} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear traces" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Clear traces" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear traces" }));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(await screen.findByText("Cleared the recorded traces.")).toBeInTheDocument();
  });

  it("trace export downloads a file with the span count", async () => {
    mockUrls();
    vi.spyOn(api, "traceStatus").mockResolvedValue({ recording: true, spans: 1, bytes: 128, capped: false });
    vi.spyOn(api, "traceExport").mockResolvedValue({
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: { name: "unvibe" },
              spans: [{ traceId: "a".repeat(32), spanId: "b".repeat(16), name: "x", startTimeUnixNano: "1", endTimeUnixNano: "2" }],
            },
          ],
        },
      ],
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<DebugSection settings={settings} onSaved={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: "Export traces" }));
      expect(await screen.findByText(/Exported 1 span as OTLP JSON/)).toBeInTheDocument();
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
