/**
 * Shared tab strip tests (issues #60, #61): the `?tab=` parsing both pages
 * use, the `#hash` mapping for the older settings section links, and the
 * tablist/panel wiring (history replaced, other params kept, panels kept
 * mounted behind `hidden`).
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Tabs, TabPanel, parseTabId, tabIdFromHash, useQueryTab } from "./Tabs.js";

const DEBUG_IDS = ["jobs", "prompts", "context"];
const SETTINGS_IDS = ["repositories", "models", "environment", "prompts", "limits", "version"];

afterEach(() => {
  cleanup();
});

describe("parseTabId", () => {
  for (const ids of [DEBUG_IDS, SETTINGS_IDS]) {
    it(`accepts known ids and falls back for ${ids[0]}-style lists`, () => {
      expect(parseTabId(ids[1], ids, ids[0])).toBe(ids[1]);
      expect(parseTabId(null, ids, ids[0])).toBe(ids[0]);
      expect(parseTabId("", ids, ids[0])).toBe(ids[0]);
      expect(parseTabId("nope", ids, ids[0])).toBe(ids[0]);
    });
  }
});

describe("tabIdFromHash", () => {
  it("maps section hashes to tab ids", () => {
    expect(tabIdFromHash("#environment", SETTINGS_IDS)).toBe("environment");
    expect(tabIdFromHash("models", SETTINGS_IDS)).toBe("models");
    expect(tabIdFromHash("#nope", SETTINGS_IDS)).toBeNull();
    expect(tabIdFromHash("", SETTINGS_IDS)).toBeNull();
    expect(tabIdFromHash("#", SETTINGS_IDS)).toBeNull();
  });
});

function Harness({ ids, fallback }: { ids: string[]; fallback: string }): React.JSX.Element {
  const [tab, select] = useQueryTab(ids, fallback);
  const location = useLocation();
  return (
    <>
      <p data-testid="location">{location.search}</p>
      <Tabs
        label="Sections"
        tabs={ids.map((id) => ({ id, label: id }))}
        active={tab}
        onSelect={select}
        idPrefix="test"
      />
      {ids.map((id) => (
        <TabPanel key={id} idPrefix="test" id={id} active={tab === id}>
          <span>panel {id}</span>
        </TabPanel>
      ))}
    </>
  );
}

describe("useQueryTab + Tabs + TabPanel", () => {
  it("defaults to the first tab and keeps panels mounted behind hidden", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Harness ids={SETTINGS_IDS} fallback="repositories" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "models" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "repositories" })).toHaveAttribute("aria-selected", "true");
    // All panels stay in the DOM; only the active one is shown.
    expect(screen.getByText("panel models")).not.toBeVisible();
    expect(screen.getByText("panel repositories")).toBeVisible();
  });

  it("unknown ?tab= falls back to the default", () => {
    render(
      <MemoryRouter initialEntries={["/review/demo/debug?tab=bogus"]}>
        <Harness ids={DEBUG_IDS} fallback="jobs" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "jobs" })).toHaveAttribute("aria-selected", "true");
  });

  it("switching tabs keeps other query parameters", () => {
    render(
      <MemoryRouter initialEntries={["/review/demo/debug?token=abc&tab=jobs"]}>
        <Harness ids={DEBUG_IDS} fallback="jobs" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "prompts" }));
    expect(screen.getByRole("tab", { name: "prompts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("location").textContent).toContain("token=abc");
    expect(screen.getByTestId("location").textContent).toContain("tab=prompts");
    // The jobs panel is hidden, not unmounted.
    expect(screen.getByText("panel jobs")).not.toBeVisible();
    expect(screen.getByText("panel jobs")).toBeInTheDocument();
  });

  it("wires aria-controls between tabs and panels", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Harness ids={SETTINGS_IDS} fallback="repositories" />
      </MemoryRouter>,
    );
    const tab = screen.getByRole("tab", { name: "environment" });
    const panelId = tab.getAttribute("aria-controls") ?? "";
    expect(panelId).not.toBe("");
    expect(document.getElementById(panelId)?.getAttribute("aria-labelledby")).toBe(
      tab.getAttribute("id"),
    );
  });
});
