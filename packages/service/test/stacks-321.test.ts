import { describe, expect, it } from "vitest";
import type { Repo } from "@unvibe/shared";
import { fetchRepoStacks, parseStacksPage } from "../src/repos/stacks.js";
import type { CommandRunner } from "../src/exec/index.js";

const repo: Repo = { id: "r1", owner: "acme", name: "widgets", localPath: "/tmp/x", lastOpened: 0 };
const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null): string =>
  JSON.stringify({ data: { repository: { pullRequests: { pageInfo: { hasNextPage, endCursor }, nodes } } } });
const node = (number: number, head: string, base: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  number, title: `PR ${number}`, headRefName: head, baseRefName: base, isCrossRepository: false, ...extra,
});

describe("stacks service (#321)", () => {
  it("parses a page", () => {
    const p = parseStacksPage(page([node(1, "a", "main")]));
    expect(p.prs).toHaveLength(1);
    expect(p.prs[0].headRefName).toBe("a");
  });
  it("infers a 3-stack through the paged fetch", async () => {
    const runner: CommandRunner = {
      run: async () => ({ stdout: page([node(11, "feat-a", "main"), node(12, "feat-b", "feat-a"), node(13, "feat-c", "feat-b")]), stderr: "", code: 0 }),
    } as unknown as CommandRunner;
    const stacks = await fetchRepoStacks(runner, repo);
    expect(stacks[11]).toMatchObject({ position: 1, size: 3, source: "inferred" });
    expect(stacks[12]).toMatchObject({ position: 2, size: 3 });
    expect(stacks[13]).toMatchObject({ position: 3, size: 3 });
  });
  it("prefers native stack data when present", async () => {
    const members = [11, 12, 13].map((n, i) => ({ position: i + 1, pullRequest: node(n, `h${n}`, "main") }));
    const runner: CommandRunner = {
      run: async () => ({
        stdout: page([node(12, "feat-b", "feat-a", { stack: { number: 7, size: 3, baseRefName: "main", entries: { nodes: members } }, stackEntry: { position: 2 } })]),
        stderr: "", code: 0,
      }),
    } as unknown as CommandRunner;
    const stacks = await fetchRepoStacks(runner, repo);
    expect(stacks[12]).toMatchObject({ position: 2, size: 3, source: "native", rootNumber: 11 });
  });
  it("gh failure yields no stacks", async () => {
    const runner: CommandRunner = { run: async () => ({ stdout: "", stderr: "down", code: 1 }) } as unknown as CommandRunner;
    expect(await fetchRepoStacks(runner, repo)).toEqual({});
  });
});
