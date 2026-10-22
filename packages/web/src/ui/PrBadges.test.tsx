/** #230: PrBadges never throws on a decision outside the type — it renders no icon. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PrBadges } from "./index.js";

afterEach(() => {
  cleanup();
});

describe("PrBadges unknown decision", () => {
  it("keeps the state icon and drops an unknown decision without throwing", () => {
    const { container } = render(<PrBadges prState="open" reviewDecision={"review_required" as never} />);
    const badges = container.querySelector('[data-testid="pr-badges"]');
    expect(badges?.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(badges?.textContent).toBe("");
  });

  it("renders nothing when only an unknown decision is passed", () => {
    const { container } = render(<PrBadges reviewDecision={"review_required" as never} />);
    expect(container.querySelector('[data-testid="pr-badges"]')).toBeNull();
    expect(container.textContent).toBe("");
  });
});
