/**
 * Preview-build badge tests (issues #36, #141): the full pill in app
 * headers and the compact review-bar marker, both linking to
 * Settings → Version with the full build text on hover. Renders nothing
 * for non-preview builds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HealthResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { PreviewBuildBadge } from "./PreviewBuildBadge.js";

const PREVIEW: HealthResponse = {
  ok: true,
  version: "0.0.1-preview.feat-x.abc1234",
  build: {
    version: "0.0.1-preview.feat-x.abc1234",
    sourceBranch: "feat/x",
    sourceCommit: "abc1234def5678",
    baseBranch: "main",
    baseCommit: null,
    commit: "ffff000011112222",
    builtAt: new Date().toISOString(),
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubHealth(build: HealthResponse["build"]): void {
  vi.spyOn(api, "health").mockResolvedValue({ ok: true, version: "mock", build });
}

describe("PreviewBuildBadge", () => {
  it("renders nothing for a non-preview build", async () => {
    stubHealth(null);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PreviewBuildBadge />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(api.health).toHaveBeenCalled());
    expect(screen.queryByTestId("preview-badge")).toBeNull();
    expect(screen.queryByTestId("preview-marker")).toBeNull();
  });

  it("full pill names the branch and links to Settings → Version", async () => {
    stubHealth(PREVIEW.build);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PreviewBuildBadge />
      </MemoryRouter>,
    );
    const badge = await screen.findByTestId("preview-badge");
    expect(badge).toHaveTextContent("feat/x");
    expect(badge).toHaveAttribute("href", "/settings?tab=version");
    expect(badge.getAttribute("title")).toMatch("Preview build");
  });

  it("compact marker is one quiet word with the full text on hover", async () => {
    stubHealth(PREVIEW.build);
    render(
      <MemoryRouter initialEntries={["/review/demo"]}>
        <PreviewBuildBadge compact />
      </MemoryRouter>,
    );
    const marker = await screen.findByTestId("preview-marker");
    expect(marker).toHaveTextContent("preview");
    expect(marker).toHaveAttribute("href", "/settings?tab=version");
    expect(marker.getAttribute("title")).toMatch("feat/x");
  });
});
