/** #224 DiffStat: one shared `+N −M` rendering (PR list, diff headers, file tree). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DiffStat } from "./index.js";

afterEach(() => {
  cleanup();
});

describe("DiffStat", () => {
  it("renders both sides with coloured spans and no pill", () => {
    const { container } = render(<DiffStat added={120} removed={34} />);
    const stat = container.querySelector(".ui-diffstat");
    expect(stat?.textContent).toBe("+120 −34");
    expect(stat?.querySelector(".a")?.textContent).toBe("+120");
    expect(stat?.querySelector(".d")?.textContent).toBe("−34");
  });

  it("keeps zero sides and separates thousands", () => {
    render(<DiffStat added={1200} removed={0} />);
    expect(screen.getByText("+1,200")).toBeInTheDocument();
    expect(screen.getByText("−0")).toBeInTheDocument();
  });

  it("renders the known side alone", () => {
    const { container } = render(<DiffStat added={9} />);
    expect(container.querySelector(".ui-diffstat")?.textContent).toBe("+9");
  });

  it("renders nothing when neither side is known", () => {
    const { container } = render(<DiffStat />);
    expect(container.querySelector(".ui-diffstat")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
