/**
 * Shared depth stepper (issue #129): while a depth change runs, + and −
 * keep their icons and are disabled — no dots inside `.depth`, in either
 * direction. One control serves page cards and expansion cards.
 */
import { describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { DepthControl } from "./DepthControl.js";

afterEach(() => {
  cleanup();
});

function pipsOn(container: HTMLElement): number {
  return container.querySelectorAll(".depth .pips i.on").length;
}

describe("DepthControl", () => {
  test("idle: icons, pips for the level, nothing busy", () => {
    const { container } = render(
      <DepthControl level="standard" onSimpler={() => {}} onDeeper={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Simpler" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deeper" })).toBeEnabled();
    expect(pipsOn(container)).toBe(2);
    expect(container.querySelector(".depth .dots")).toBeNull();
    expect(container.querySelector(".depth")?.getAttribute("aria-busy")).toBeNull();
  });

  test("simpler stays off at the simplest level", () => {
    const { container } = render(
      <DepthControl level="simple" onSimpler={() => {}} onDeeper={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Simpler" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deeper" })).toBeEnabled();
    expect(pipsOn(container)).toBe(1);
  });

  test("depth busy: both buttons keep their icons and disable, no dots", () => {
    const onSimpler = vi.fn();
    const onDeeper = vi.fn();
    const { container } = render(
      <DepthControl level="standard" disabled depthBusy onSimpler={onSimpler} onDeeper={onDeeper} />,
    );
    // Icons stay, in both directions — the + never turns into dots.
    expect(screen.getByRole("button", { name: "Simpler" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deeper" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Simpler" })).toHaveTextContent("−");
    expect(screen.getByRole("button", { name: "Deeper" })).toHaveTextContent("+");
    expect(container.querySelector(".depth .dots")).toBeNull();
    expect(container.querySelector(".depth")?.getAttribute("aria-busy")).toBe("true");
  });

  test("other work disabled the control the same way (no dots either)", () => {
    const { container } = render(
      <DepthControl level="deep" disabled onSimpler={() => {}} onDeeper={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Simpler" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deeper" })).toBeDisabled();
    expect(container.querySelector(".depth .dots")).toBeNull();
    expect(pipsOn(container)).toBe(3);
  });
});
