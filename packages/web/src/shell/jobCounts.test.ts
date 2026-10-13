/**
 * Job-count mapping (issue #98): running vs queued across every job state
 * the service has.
 */
import type { Job, JobState } from "@unvibe/shared";
import { describe, expect, it } from "vitest";
import { jobCounts } from "./jobCounts.js";

function job(id: string, state: JobState): Job {
  return { id, kind: "explain", model: "mock-main", priority: 1, state };
}

describe("jobCounts", () => {
  it("is empty with no jobs", () => {
    expect(jobCounts([])).toEqual({ running: 0, queued: 0 });
  });

  it("counts running separately from queued and backing-off", () => {
    expect(
      jobCounts([
        job("a", "running"),
        job("b", "running"),
        job("c", "queued"),
        job("d", "queued"),
        job("e", "queued"),
        job("f", "backing-off"),
      ]),
    ).toEqual({ running: 2, queued: 4 });
  });

  it("maps each live state", () => {
    expect(jobCounts([job("a", "running")])).toEqual({ running: 1, queued: 0 });
    expect(jobCounts([job("a", "queued")])).toEqual({ running: 0, queued: 1 });
    // Backing-off waits for its next retry: queued, not running.
    expect(jobCounts([job("a", "backing-off")])).toEqual({ running: 0, queued: 1 });
  });

  it("ignores terminal states", () => {
    expect(
      jobCounts([job("a", "done"), job("b", "error"), job("c", "cancelled")]),
    ).toEqual({ running: 0, queued: 0 });
  });

  it("mixes live and terminal jobs", () => {
    expect(
      jobCounts([
        job("a", "running"),
        job("b", "queued"),
        job("c", "done"),
        job("d", "error"),
        job("e", "cancelled"),
      ]),
    ).toEqual({ running: 1, queued: 1 });
  });
});
