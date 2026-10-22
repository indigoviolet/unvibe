/** #230: PrBadges never throws on a decision outside the type — it renders no icon. #234: no icon for open. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PrBadges } from "./index.js";

afterEach(() => {
  cleanup();
});

describe("PrBadges unknown decision", () => {
  it("keeps the state icon and drops an unknown decision without throwing", () => {
    const { container } = render(<PrBadges prState="merged" reviewDecision={"review_required" as never} />);
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

describe("PrBadges open state (#234)", () => {
  it("renders nothing for open with no decision", () => {
    const { container } = render(<PrBadges prState="open" />);
    expect(container.querySelector('[data-testid="pr-badges"]')).toBeNull();
  });

  it("renders only the decision for open with a decision", () => {
    const { container } = render(<PrBadges prState="open" reviewDecision="changes_requested" />);
    const badges = container.querySelector('[data-testid="pr-badges"]');
    expect(badges?.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(badges?.querySelector('[aria-label="Changes requested"]')).not.toBeNull();
  });

  it("keeps tooltips stating the status only", () => {
    const { container } = render(<PrBadges prState="merged" reviewDecision="approved" />);
    const imgs = container.querySelectorAll('[role="img"]');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("data-tip")).toBe("Merged");
    expect(imgs[1].getAttribute("data-tip")).toBe("Approved");
  });
});
