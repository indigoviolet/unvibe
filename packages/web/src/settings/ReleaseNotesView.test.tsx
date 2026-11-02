/** ReleaseNotesView (#330): What changed shows only when it adds more than the one-liner. */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReleaseNotes } from "@unvibe/shared";
import { ReleaseNotesView } from "./ReleaseNotesView.js";

afterEach(() => cleanup());

function notesWith(whatChanged: string): ReleaseNotes {
  return {
    channel: "preview/feat-x",
    version: "0.0.1-preview.feat-x.abc1234",
    previousVersion: "0.0.1",
    commit: null,
    previousCommit: null,
    dataFormat: 1,
    previousDataFormat: 1,
    dataResetNeeded: false,
    generatedAt: "2026-10-31T00:00:00.000Z",
    items: [
      {
        number: 330,
        title: "Ships notes.",
        summary: "Ships notes.",
        url: "https://github.com/indigoviolet/unvibe/issues/330",
        whatChanged,
      },
    ],
  };
}

describe("ReleaseNotesView whatChanged", () => {
  it("does not repeat What changed when it equals the summary", () => {
    render(<ReleaseNotesView notes={notesWith("Ships notes.")} />);
    expect(screen.queryByText(/What changed:/)).toBeNull();
    expect(screen.getAllByText("Ships notes.")).toHaveLength(1);
  });

  it("shows What changed when it adds more than the first line", () => {
    render(<ReleaseNotesView notes={notesWith("Ships notes.\nExtra detail here.")} />);
    expect(screen.getByText(/What changed:/)).toBeVisible();
    expect(screen.getByText(/Extra detail here\./)).toBeVisible();
  });
});
