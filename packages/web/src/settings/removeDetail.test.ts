/** Issue #428: the repo Remove confirm names what goes with the repo. */
import { describe, expect, it } from "vitest";
import type { Repo } from "@unvibe/shared";
import { removeDetail } from "./RepositoriesSection.js";

const own: Repo = { id: "r1", owner: "acme", name: "app", localPath: "/src/app", lastOpened: 0 };
const managed: Repo = { ...own, managed: true, localPath: "/data/repos/acme/app" };

describe("removeDetail (#428)", () => {
  it("names the review count and leaves the folder alone", () => {
    expect(removeDetail(own, { preview: { reviews: 1, unsentDrafts: 0 } })).toBe(
      "Remove acme/app and its 1 review from Unvibe? /src/app is not touched.",
    );
    expect(removeDetail(own, { preview: { reviews: 3, unsentDrafts: 0 } })).toBe(
      "Remove acme/app and its 3 reviews from Unvibe? /src/app is not touched.",
    );
  });

  it("drops the review clause when there are none", () => {
    expect(removeDetail(own, { preview: { reviews: 0, unsentDrafts: 0 } })).toBe(
      "Remove acme/app from Unvibe? /src/app is not touched.",
    );
  });

  it("says unsent drafts will be lost", () => {
    expect(removeDetail(own, { preview: { reviews: 2, unsentDrafts: 1 } })).toBe(
      "Remove acme/app and its 2 reviews from Unvibe? /src/app is not touched. 1 unsent draft will be lost.",
    );
  });

  it("a managed clone says its clone is deleted", () => {
    expect(removeDetail(managed, { preview: { reviews: 0, unsentDrafts: 0 } })).toBe(
      "Remove acme/app from Unvibe? Unvibe's clone at /data/repos/acme/app is deleted.",
    );
  });

  it("a failed count still says everything goes", () => {
    expect(removeDetail(own, { preview: null, error: "offline" })).toBe(
      "Remove acme/app and all its reviews from Unvibe? (Couldn't count them: offline.) /src/app is not touched.",
    );
  });
});
