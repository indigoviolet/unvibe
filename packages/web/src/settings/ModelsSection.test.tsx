/**
 * ModelsSection provider switch (#87): changing the provider only loads
 * that provider's models; choosing a model saves provider and model
 * together, so the service never sees a mismatched pair.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ModelsSection } from "./ModelsSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MODELS: Record<string, string[]> = {
  claude: ["opus", "haiku"],
  codex: ["gpt-6.1-sol", "gpt-6-luna"],
};

const SETTINGS = {
  main: { provider: "claude", model: "opus", effort: "" },
  small: { provider: "claude", model: "haiku", effort: "" },
  secondOpinion: { provider: "codex", model: "gpt-6.1-sol", effort: "" },
} as Settings;

type ModelsResult = Awaited<ReturnType<typeof api.models>>;

function mockReadiness(): void {
  vi.spyOn(api, "readiness").mockResolvedValue(
    { checks: [] } as unknown as Awaited<ReturnType<typeof api.readiness>>,
  );
}

function mockModels(described?: Record<string, { id: string; description?: string }[]>): void {
  vi.spyOn(api, "models").mockImplementation((provider: string) => {
    if (described) {
      return Promise.resolve({ provider, models: described[provider] ?? [] } as ModelsResult);
    }
    return Promise.resolve({
      models: (MODELS[provider] ?? []).map((id) => ({ id })),
    } as ModelsResult);
  });
}

type ThinkingMap = Record<string, { value: string; name?: string }[]>;

const THINKING_BOTH: ThinkingMap = {
  claude: [
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ],
  codex: [
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ],
};

function mockThinking(byProvider: ThinkingMap = THINKING_BOTH): void {
  vi.spyOn(api, "thinking").mockImplementation((provider: string) =>
    Promise.resolve({ provider, label: "Effort", options: byProvider[provider] ?? [], current: "high" }),
  );
}

// #225: the shared Select is Base UI — the trigger (role=combobox, carrying
// the field id) shows the picked label; picking clicks the popup option.
function provSelect(role: string): HTMLElement {
  return document.getElementById(`prov-${role}`) as HTMLElement;
}

function modelSelect(role: string): HTMLElement {
  return document.getElementById(`model-${role}`) as HTMLElement;
}

function effortSelect(role: string): HTMLElement {
  return document.getElementById(`effort-${role}`) as HTMLElement;
}

async function choose(trigger: HTMLElement, label: string): Promise<void> {
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: label });
  // Base UI commits an item on a full pointer sequence, not a bare click.
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

describe("ModelsSection provider switch", () => {
  it("saves nothing on provider change, then saves the new provider with the chosen model", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const next = { ...SETTINGS, small: { provider: "codex", model: "gpt-6-luna", effort: "" } } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    const provider = provSelect("small");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    await choose(provider, "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();

    await choose(modelSelect("small"), "gpt-6-luna");
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ small: { provider: "codex", model: "gpt-6-luna", effort: "" } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
  });

  it("shows the placeholder in the trigger while browsing, with nothing under the picker; switching back restores the saved model", async () => {
    mockReadiness();
    mockThinking();
    mockModels({
      claude: [
        { id: "opus", description: "Opus description" },
        { id: "haiku", description: "Haiku description" },
      ],
      codex: [{ id: "gpt-6-luna", description: "Luna description" }],
    });
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(SETTINGS);
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    // #225: no description (or status/path line) under the model picker.
    expect(screen.queryByTestId("model-small-desc")).not.toBeInTheDocument();

    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    expect(modelSelect("small")).toHaveTextContent("Pick a codex model…");
    expect(screen.queryByTestId("model-small-desc")).not.toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();

    // Back to the saved provider without choosing: the saved model returns.
    await choose(provSelect("small"), "claude");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    expect(screen.queryByTestId("model-small-desc")).not.toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();
  });

  it("still warns when the saved model is really gone, and hides the alert while browsing", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const retired = {
      ...SETTINGS,
      small: { provider: "claude", model: "retired-x", effort: "" },
    } as Settings;
    render(<ModelsSection settings={retired} onSaved={vi.fn()} />);

    // The saved provider's own list lacks the pick: warn.
    await waitFor(() => expect(screen.getByTestId("model-small-missing")).toBeInTheDocument());

    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();

    await choose(provSelect("small"), "claude");
    await waitFor(() => expect(screen.getByTestId("model-small-missing")).toBeInTheDocument());
  });

  it("failed save shows a readable error, reverts to the saved pick, and clears on the next change", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const saveSettings = vi
      .spyOn(api, "saveSettings")
      .mockRejectedValue(
        new Error('PUT /api/settings: 400 {"errors":["small model \\"gpt-6-luna\\" is not offered by claude"]}'),
      );
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    await choose(modelSelect("small"), "gpt-6-luna");

    const card = await waitFor(() => {
      const alert = within(screen.getByTestId("model-small")).getByRole("alert");
      expect(alert).toBeInTheDocument();
      return screen.getByTestId("model-small");
    });
    const alert = within(card).getByRole("alert");
    expect(alert).toHaveTextContent('small model "gpt-6-luna" is not offered by claude');
    expect(alert.textContent).not.toContain("{");
    expect(onSaved).not.toHaveBeenCalled();
    // Both selects return to the saved pick.
    await waitFor(() => expect(provSelect("small")).toHaveTextContent("claude"));
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));

    // The error clears on the next provider change.
    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    expect(within(screen.getByTestId("model-small")).queryByRole("alert")).not.toBeInTheDocument();
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("does not snap the browse back on a settings refetch, but still syncs when not browsing", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const onSaved = vi.fn();
    const { rerender } = render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));

    // A refetch returning the same saved pick (new object) mid-browse:
    // the browse stays put.
    rerender(<ModelsSection settings={{ ...SETTINGS }} onSaved={onSaved} />);
    expect(provSelect("small")).toHaveTextContent("codex");
    expect(modelSelect("small")).toHaveTextContent("Pick a codex model…");

    // A saved-model change for the saved provider also leaves the browse.
    rerender(
      <ModelsSection settings={{ ...SETTINGS, small: { provider: "claude", model: "opus", effort: "" } }} onSaved={onSaved} />,
    );
    expect(provSelect("small")).toHaveTextContent("codex");
    expect(modelSelect("small")).toHaveTextContent("Pick a codex model…");

    // Not browsing: an external change to the saved provider is adopted.
    await choose(provSelect("small"), "claude");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("opus"));
    rerender(
      <ModelsSection
        settings={{ ...SETTINGS, small: { provider: "codex", model: "gpt-6-luna", effort: "" } }}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(provSelect("small")).toHaveTextContent("codex"));
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("gpt-6-luna"));
  });

  it("follows the browsed provider through loading and error states", async () => {
    mockReadiness();
    mockThinking();
    let resolveCodex!: (v: ModelsResult) => void;
    const codexGate = new Promise<ModelsResult>((res) => {
      resolveCodex = res;
    });
    vi.spyOn(api, "models").mockImplementation((provider: string) => {
      if (provider === "codex") return codexGate;
      return Promise.resolve({
        models: (MODELS[provider] ?? []).map((id) => ({ id })),
      } as ModelsResult);
    });
    render(<ModelsSection settings={SETTINGS} onSaved={vi.fn()} />);

    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    await choose(provSelect("small"), "codex");
    await waitFor(() =>
      expect(within(screen.getByTestId("model-small")).getByText("Loading models…")).toBeInTheDocument(),
    );
    resolveCodex({ provider: "codex", models: [{ id: "gpt-6-luna" }] } as ModelsResult);
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
  });

  it("shows the browsed provider's list error without a false missing alert", async () => {
    mockReadiness();
    mockThinking();
    vi.spyOn(api, "models").mockImplementation((provider: string) => {
      if (provider === "codex") {
        return Promise.reject(
          new Error('GET /api/models?provider=codex: 404 {"error":"no models for provider \\"codex\\": adapter not installed or not logged in"}'),
        );
      }
      return Promise.resolve({
        models: (MODELS[provider] ?? []).map((id) => ({ id })),
      } as ModelsResult);
    });
    render(<ModelsSection settings={SETTINGS} onSaved={vi.fn()} />);

    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("haiku"));
    await choose(provSelect("small"), "codex");
    await waitFor(() =>
      expect(
        within(screen.getByTestId("model-small")).getByText(/adapter not installed or not logged in/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();
  });

  it("second opinion keeps its Not set state while browsing and can be set from another provider", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const unset = {
      ...SETTINGS,
      secondOpinion: { provider: "codex", model: "", effort: "" },
    } as Settings;
    const next = {
      ...unset,
      secondOpinion: { provider: "claude", model: "opus", effort: "" },
    } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    const onSaved = vi.fn();
    render(<ModelsSection settings={unset} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveTextContent("Not set"));
    // Unset copy names the enforced rule (finding 19): a different model
    // from main, not a second provider.
    expect(screen.getByTestId("model-secondOpinion-unset")).toHaveTextContent(
      "need a different model from main",
    );

    await choose(provSelect("secondOpinion"), "claude");
    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveTextContent("Pick a claude model…"));
    expect(screen.getByTestId("model-secondOpinion-unset")).toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();

    // Back without choosing: still Not set.
    await choose(provSelect("secondOpinion"), "codex");
    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveTextContent("Not set"));
    expect(screen.getByTestId("model-secondOpinion-unset")).toBeInTheDocument();

    // Choosing from the browsed provider saves that provider with the model.
    await choose(provSelect("secondOpinion"), "claude");
    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveTextContent("Pick a claude model…"));
    await choose(modelSelect("secondOpinion"), "opus");
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({ secondOpinion: { provider: "claude", model: "opus", effort: "" } }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
  });
});

describe("ModelsSection effort per role (#172)", () => {
  it("offers Default first, then the adapter's values, and saves the pick with the model", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const next = { ...SETTINGS, small: { provider: "claude", model: "haiku", effort: "high" } } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(effortSelect("small")).toHaveTextContent("Default"));
    fireEvent.click(effortSelect("small"));
    const optionEls = await screen.findAllByRole("option");
    const options = optionEls.map((o) => o.textContent?.replace("✓", "").trim());
    expect(options).toEqual(["Default", "Low", "High"]);
    const high = optionEls.find((o) => o.textContent?.includes("High")) as HTMLElement;
    fireEvent.pointerDown(high, { pointerType: "mouse" });
    fireEvent.mouseDown(high);
    fireEvent.pointerUp(high, { pointerType: "mouse" });
    fireEvent.mouseUp(high);
    fireEvent.click(high);
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({ small: { provider: "claude", model: "haiku", effort: "high" } }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
  });

  it("falls back to Default with a notice when the new model does not offer the saved effort", async () => {
    mockReadiness();
    mockModels();
    // Codex offers only low: moving the small role there drops "high".
    mockThinking({
      claude: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
      codex: [{ value: "low", name: "Low" }],
    });
    const saved = { ...SETTINGS, small: { provider: "claude", model: "haiku", effort: "high" } } as Settings;
    const next = { ...saved, small: { provider: "codex", model: "gpt-6-luna", effort: "" } } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    render(<ModelsSection settings={saved} onSaved={vi.fn()} />);

    await waitFor(() => expect(effortSelect("small")).toHaveTextContent("High"));
    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    await choose(modelSelect("small"), "gpt-6-luna");
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        small: { provider: "codex", model: "gpt-6-luna", effort: "" },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("model-small-effort-reset")).toHaveTextContent(
      "“high” isn't available for codex — reset to Default.",
    ));
  });

  it("warns when the saved effort is no longer offered, and stays quiet while browsing", async () => {
    mockReadiness();
    mockModels();
    mockThinking();
    const stale = { ...SETTINGS, small: { provider: "claude", model: "haiku", effort: "ultra" } } as Settings;
    render(<ModelsSection settings={stale} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("model-small-effort-missing")).toBeInTheDocument());

    await choose(provSelect("small"), "codex");
    await waitFor(() => expect(modelSelect("small")).toHaveTextContent("Pick a codex model…"));
    expect(screen.queryByTestId("model-small-effort-missing")).not.toBeInTheDocument();
    // The effort control waits for a model pick while browsing.
    expect(effortSelect("small")).toBeDisabled();
  });
});

describe("friendlyError", () => {
  it("reads the service settings { errors: [...] } body instead of showing raw JSON", () => {
    const message = friendlyError(
      new Error('PUT /api/settings: 400 {"errors":["small model \\"gpt-6-luna\\" is not offered by claude","unknown setting: nope"]}'),
    );
    expect(message).toBe('small model "gpt-6-luna" is not offered by claude; unknown setting: nope');
    expect(message).not.toContain("{");
  });

  it("still prefers a single { error } message", () => {
    expect(friendlyError(new Error('GET /api/models?provider=x: 404 {"error":"adapter missing"}'))).toBe(
      "adapter missing",
    );
  });
});
