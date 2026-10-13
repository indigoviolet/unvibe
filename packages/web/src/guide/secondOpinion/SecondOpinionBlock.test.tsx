/**
 * Second-opinion result block (PRD §4.10): model label, verdict chip,
 * reasoning with citation markers, missed text, and prominent
 * disagreement styling (prototype warn colours).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Card, SecondOpinionResult } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { resetMockState } from "../../mock/index.js";
import { SecondOpinionBlock } from "./SecondOpinionBlock.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
});

function card(): Card {
  return {
    id: "central",
    pageId: "root",
    title: "Central",
    level: "standard",
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
  };
}

function result(verdict: SecondOpinionResult["verdict"]): SecondOpinionResult {
  return {
    id: `so-central-check-mock-${verdict}`,
    cardId: "central",
    mode: "check",
    provider: "codex",
    model: "mock-second",
    verdict,
    reasoning: "Checked.",
    blocks: [
      {
        type: "paragraph",
        id: "b-so-1",
        text: { standard: `Reasoning with code. [[diff:src-urllib3-connection.py:80-82]]` },
        citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
      },
    ],
    missed: "Set-Cookie scope.",
    version: 1,
    createdAt: 1,
  };
}

async function renderWithSnapshot(verdict: SecondOpinionResult["verdict"]): Promise<void> {
  const snap = await api.review("demo");
  useReview.getState().setSnapshot(snap);
  render(
    <SecondOpinionBlock
      reviewId="demo"
      card={card()}
      result={result(verdict)}
      lookupPage={(id) => snap.pages.find((p) => p.id === id)}
      onOpenPage={() => {}}
      onFollowUp={() => {}}
    />,
  );
}

describe("SecondOpinionBlock", () => {
  it("shows model label, verdict chip, reasoning citations and missed", async () => {
    await renderWithSnapshot("agrees");
    expect(screen.getByText("codex/mock-second")).toBeInTheDocument();
    expect(screen.getByText("Agrees")).toBeInTheDocument();
    expect(screen.getByText(/Missed:/)).toBeInTheDocument();
    expect(screen.getByText(/Set-Cookie scope/)).toBeInTheDocument();
    // Citation marker behaves like all others.
    const marker = document.querySelector(".so .lk[data-refs]");
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-refs")).toContain("diff:src-urllib3-connection.py:80-82");
  });

  it("marks disagreement prominently with warn styling", async () => {
    await renderWithSnapshot("disagrees");
    const block = document.querySelector("[data-so]");
    expect(block?.getAttribute("data-verdict")).toBe("disagrees");
    expect(block?.className).toMatch(/so-dis/);
    expect(screen.getByText("Disagrees")).toBeInTheDocument();
  });

  it("offers re-run and remove controls", async () => {
    await renderWithSnapshot("partly");
    expect(screen.getByRole("button", { name: /Re-run second opinion/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove second opinion" })).toBeInTheDocument();
  });
});
