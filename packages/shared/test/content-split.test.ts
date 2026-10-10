import { describe, expect, it } from "vitest";
import { splitReply } from "../src/content/split.js";

describe("splitReply", () => {
  it("splits body from a tagged trailing JSON block", () => {
    const r = splitReply("Hello [[diff:conn:80-82]]\n\n```json\n{\"title\": \"T\"}\n```\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toBe("Hello [[diff:conn:80-82]]");
    expect(r.data).toEqual({ title: "T" });
  });

  it("accepts an untagged trailer and prose after it", () => {
    const r = splitReply("Body.\n\n```\n{\"a\": 1}\n```\nHope this helps!\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toBe("Body.");
    expect(r.data).toEqual({ a: 1 });
  });

  it("returns missing (not a throw) when there is no fence", () => {
    const r = splitReply("Just prose, no metadata.");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("missing");
    expect(r.body).toBe("Just prose, no metadata.");
  });

  it("returns missing when the last fence is content, not JSON", () => {
    const r = splitReply("See:\n\n```python\nx = 1\n```\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("missing");
  });

  it("returns malformed for a json-tagged fence that does not parse", () => {
    const r = splitReply("Body.\n\n```json\n{nope\n```\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("malformed");
    expect(r.body).toBe("Body.");
  });

  it("returns not-object for a JSON array trailer", () => {
    const r = splitReply("Body.\n\n```json\n[1, 2]\n```\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("not-object");
  });

  it("keeps earlier content fences and splits on the last one", () => {
    const r = splitReply(
      "Example:\n\n```python\nx = 1\n```\n\nDone.\n\n```json\n{\"hunk\": {\"summary\": \"s\"}}\n```",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toContain("```python");
    expect(r.data).toEqual({ hunk: { summary: "s" } });
  });
});
