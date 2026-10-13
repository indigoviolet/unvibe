import { describe, expect, it } from "vitest";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { runGh } from "../src/exec/gh.js";

describe("FakeCommandRunner", () => {
  // DISABLED(#119): tests the test double, not product code; every injecting test already fails if it breaks.
  it.skip("replays scripted results and records calls", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "git", args: ["rev-parse", "HEAD"], stdout: "abc\n", stderr: "", code: 0 });
    const res = await runner.run("git", { args: ["rev-parse", "HEAD"] });
    expect(res.stdout).toBe("abc\n");
    expect(runner.calls).toHaveLength(1);
  });

  // DISABLED(#119): tests the test double, not product code; unmatched commands throwing is exercised implicitly.
  it.skip("throws on unexpected commands", async () => {
    const runner = new FakeCommandRunner();
    await expect(runner.run("gh", { args: ["pr", "view"] })).rejects.toThrow(/unexpected command/);
  });
});

describe("runGh", () => {
  it("unsets GITHUB_TOKEN", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "", code: 0 });
    process.env.GITHUB_TOKEN = "leaked";
    await runGh(runner, ["pr", "view", "1"], { args: ["pr", "view", "1"] });
    delete process.env.GITHUB_TOKEN;
    expect(runner.calls[0].opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
    expect(runner.calls[0].cmd).toBe("gh");
  });
});

describe("FakeAgentRunner", () => {
  it("replays scripted events per prompt", async () => {
    const runner = new FakeAgentRunner([
      { match: "hello", events: [{ type: "text", delta: "hi" }, { type: "done", stopReason: "end" }] },
    ]);
    const session = await runner.start({
      provider: "test",
      model: "m",
      cwd: "/",
      systemPrompt: "sys",
      mcpServers: [],
    });
    const seen = [];
    for await (const e of runner.prompt(session, "say hello")) seen.push(e);
    expect(seen).toHaveLength(2);
    expect(runner.prompts[0].text).toBe("say hello");
    await runner.close(session);
  });

  it("ends unmatched prompts cleanly", async () => {
    const runner = new FakeAgentRunner();
    const session = await runner.start({
      provider: "t",
      model: "m",
      cwd: "/",
      systemPrompt: "",
      mcpServers: [],
    });
    const seen = [];
    for await (const e of runner.prompt(session, "anything")) seen.push(e);
    expect(seen).toEqual([{ type: "done", stopReason: "end_turn" }]);
  });
});
