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
  main: { provider: "claude", model: "opus" },
  small: { provider: "claude", model: "haiku" },
  secondOpinion: { provider: "codex", model: "gpt-6.1-sol" },
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

function provSelect(role: string): HTMLSelectElement {
  return document.getElementById(`prov-${role}`) as HTMLSelectElement;
}

function modelSelect(role: string): HTMLSelectElement {
  return document.getElementById(`model-${role}`) as HTMLSelectElement;
}

describe("ModelsSection provider switch", () => {
  it("saves nothing on provider change, then saves the new provider with the chosen model", async () => {
    mockReadiness();
    mockModels();
    const next = { ...SETTINGS, small: { provider: "codex", model: "gpt-6-luna" } } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    const provider = provSelect("small");
    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    fireEvent.change(provider, { target: { value: "codex" } });
    await screen.findByText("Pick a codex model…");
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();

    fireEvent.change(modelSelect("small"), { target: { value: "gpt-6-luna" } });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ small: { provider: "codex", model: "gpt-6-luna" } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
  });

  it("shows a disabled placeholder with no stale description while browsing; switching back restores the saved model", async () => {
    mockReadiness();
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

    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    expect(screen.getByTestId("model-small-desc")).toHaveTextContent("Haiku description");

    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    const placeholder = await screen.findByText("Pick a codex model…");
    expect(placeholder.tagName).toBe("OPTION");
    expect(placeholder).toBeDisabled();
    expect(modelSelect("small")).toHaveValue("");
    expect(screen.queryByTestId("model-small-desc")).not.toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();

    // Back to the saved provider without choosing: the saved model returns.
    fireEvent.change(provSelect("small"), { target: { value: "claude" } });
    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    await waitFor(() => expect(screen.getByTestId("model-small-desc")).toHaveTextContent("Haiku description"));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();
  });

  it("still warns when the saved model is really gone, and hides the alert while browsing", async () => {
    mockReadiness();
    mockModels();
    const retired = {
      ...SETTINGS,
      small: { provider: "claude", model: "retired-x" },
    } as Settings;
    render(<ModelsSection settings={retired} onSaved={vi.fn()} />);

    // The saved provider's own list lacks the pick: warn.
    await waitFor(() => expect(screen.getByTestId("model-small-missing")).toBeInTheDocument());

    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    await screen.findByText("Pick a codex model…");
    expect(screen.queryByTestId("model-small-missing")).not.toBeInTheDocument();

    fireEvent.change(provSelect("small"), { target: { value: "claude" } });
    await waitFor(() => expect(screen.getByTestId("model-small-missing")).toBeInTheDocument());
  });

  it("failed save shows a readable error, reverts to the saved pick, and clears on the next change", async () => {
    mockReadiness();
    mockModels();
    const saveSettings = vi
      .spyOn(api, "saveSettings")
      .mockRejectedValue(
        new Error('PUT /api/settings: 400 {"errors":["small model \\"gpt-6-luna\\" is not offered by claude"]}'),
      );
    const onSaved = vi.fn();
    render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    await screen.findByText("Pick a codex model…");
    fireEvent.change(modelSelect("small"), { target: { value: "gpt-6-luna" } });

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
    await waitFor(() => expect(provSelect("small")).toHaveValue("claude"));
    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));

    // The error clears on the next provider change.
    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    await screen.findByText("Pick a codex model…");
    expect(within(screen.getByTestId("model-small")).queryByRole("alert")).not.toBeInTheDocument();
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("does not snap the browse back on a settings refetch, but still syncs when not browsing", async () => {
    mockReadiness();
    mockModels();
    const onSaved = vi.fn();
    const { rerender } = render(<ModelsSection settings={SETTINGS} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    await screen.findByText("Pick a codex model…");

    // A refetch returning the same saved pick (new object) mid-browse:
    // the browse stays put.
    rerender(<ModelsSection settings={{ ...SETTINGS }} onSaved={onSaved} />);
    expect(provSelect("small")).toHaveValue("codex");
    expect(screen.getByText("Pick a codex model…")).toBeInTheDocument();

    // A saved-model change for the saved provider also leaves the browse.
    rerender(
      <ModelsSection settings={{ ...SETTINGS, small: { provider: "claude", model: "opus" } }} onSaved={onSaved} />,
    );
    expect(provSelect("small")).toHaveValue("codex");
    expect(screen.getByText("Pick a codex model…")).toBeInTheDocument();

    // Not browsing: an external change to the saved provider is adopted.
    fireEvent.change(provSelect("small"), { target: { value: "claude" } });
    await waitFor(() => expect(modelSelect("small")).toHaveValue("opus"));
    rerender(
      <ModelsSection
        settings={{ ...SETTINGS, small: { provider: "codex", model: "gpt-6-luna" } }}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(provSelect("small")).toHaveValue("codex"));
    await waitFor(() => expect(modelSelect("small")).toHaveValue("gpt-6-luna"));
  });

  it("follows the browsed provider through loading and error states", async () => {
    mockReadiness();
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

    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
    await waitFor(() =>
      expect(within(screen.getByTestId("model-small")).getByText("Loading models…")).toBeInTheDocument(),
    );
    resolveCodex({ provider: "codex", models: [{ id: "gpt-6-luna" }] } as ModelsResult);
    await screen.findByText("Pick a codex model…");
  });

  it("shows the browsed provider's list error without a false missing alert", async () => {
    mockReadiness();
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

    await waitFor(() => expect(modelSelect("small")).toHaveValue("haiku"));
    fireEvent.change(provSelect("small"), { target: { value: "codex" } });
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
    const unset = {
      ...SETTINGS,
      secondOpinion: { provider: "codex", model: "" },
    } as Settings;
    const next = {
      ...unset,
      secondOpinion: { provider: "claude", model: "opus" },
    } as Settings;
    const saveSettings = vi.spyOn(api, "saveSettings").mockResolvedValue(next);
    const onSaved = vi.fn();
    render(<ModelsSection settings={unset} onSaved={onSaved} />);

    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveValue(""));
    // Unset copy names the enforced rule (finding 19): a different model
    // from main, not a second provider.
    expect(screen.getByTestId("model-secondOpinion-unset")).toHaveTextContent(
      "need a different model from main",
    );

    fireEvent.change(provSelect("secondOpinion"), { target: { value: "claude" } });
    await screen.findByText("Pick a claude model…");
    expect(screen.getByTestId("model-secondOpinion-unset")).toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();

    // Back without choosing: still Not set.
    fireEvent.change(provSelect("secondOpinion"), { target: { value: "codex" } });
    await waitFor(() => expect(modelSelect("secondOpinion")).toHaveValue(""));
    expect(screen.getByTestId("model-secondOpinion-unset")).toBeInTheDocument();

    // Choosing from the browsed provider saves that provider with the model.
    fireEvent.change(provSelect("secondOpinion"), { target: { value: "claude" } });
    await screen.findByText("Pick a claude model…");
    fireEvent.change(modelSelect("secondOpinion"), { target: { value: "opus" } });
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({ secondOpinion: { provider: "claude", model: "opus" } }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
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
