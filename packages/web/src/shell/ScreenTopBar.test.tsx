/**
 * ScreenTopBar tests (issue #31 round 2): app-wide header contents —
 * home link, breadcrumb trail, gear Settings button.
 */
import { describe, expect, it, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ScreenTopBar } from "./ScreenTopBar.js";

afterEach(() => {
  cleanup();
});

function renderBar(props: Parameters<typeof ScreenTopBar>[0]): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ScreenTopBar {...props} />
    </MemoryRouter>,
  );
}

describe("ScreenTopBar", () => {
  it("shows the home link and the gear Settings button with an accessible name", () => {
    renderBar({});
    expect(screen.getByRole("link", { name: "Unvibe" })).toHaveAttribute("href", "/");
    const gear = screen.getByRole("link", { name: "Settings" });
    expect(gear).toHaveAttribute("href", "/settings");
    expect(gear).toHaveAttribute("title", "Settings");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("puts the Documents icon next to the home link, before the breadcrumb and Settings (#238)", () => {
    renderBar({ crumbs: [{ label: "Settings", to: "/settings?tab=environment" }, { label: "Doctor" }] });
    const docs = screen.getByRole("link", { name: "Documents" });
    expect(docs).toHaveAttribute("href", "/documents");
    expect(docs).toHaveAttribute("title", "Documents");
    const order = [...(document.querySelector("header.top")?.children ?? [])].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
    );
    expect(order[0]).toBe("Unvibe");
    expect(order[1]).toBe("Documents");
    expect(order.indexOf("Documents")).toBeLessThan(order.indexOf("Breadcrumb"));
    expect(order.indexOf("Documents")).toBeLessThan(order.indexOf("Settings"));
  });

  it("renders the breadcrumb trail with the current page marked", () => {
    renderBar({ crumbs: [{ label: "Settings", to: "/settings?tab=environment" }, { label: "Doctor" }] });
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent("Settings");
    expect(nav).toHaveTextContent("Doctor");
    const settings = within(nav).getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/settings?tab=environment");
    const current = screen.getByText("Doctor");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");
  });

  it("renders no Settings button on the Settings screen", () => {
    renderBar({ crumbs: [{ label: "Settings" }], hideSettings: true });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("has no Tips control anywhere (issue #141: removed entirely)", () => {
    renderBar({ crumbs: [{ label: "Settings" }] });
    expect(screen.queryByRole("button", { name: "Usage tips" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Usage tips" })).toBeNull();
  });
});
