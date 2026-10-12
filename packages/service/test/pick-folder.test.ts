/**
 * Native folder picker (#26): `POST /api/repos/pick-folder` through the
 * injectable command runner — never a real dialog, real GitHub or real
 * agents.
 *
 * Platform selection (`platform`) and the display environment (`env`) are
 * injected per app, so both the macOS and Linux branches are covered on
 * Linux CI.
 */
import { describe, expect, it } from "vitest";
import type { PickFolderResponse } from "@unvibe/shared";
import { FakeCommandRunner, type CommandRunner, type RunResult } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

function enoent(cmd: string): NodeJS.ErrnoException {
  const err = new Error(`spawn ${cmd} ENOENT`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

describe("POST /api/repos/pick-folder", () => {
  it("macOS pick trims the trailing newline and slash", async () => {
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "osascript",
      args: ["-e", "POSIX path of (choose folder)"],
      stdout: "/Users/me/code/app/\n",
      stderr: "",
      code: 0,
    });
    const { app } = await createApp("tok", { runner: fake, pickFolder: { platform: "darwin" } });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "picked", path: "/Users/me/code/app" });
      // The dialog blocks until the user acts: no short timeout may cut it off.
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].opts.timeoutMs).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("macOS cancel (error -128) reports cancelled, not an error", async () => {
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "osascript",
      stdout: "",
      stderr: "execution error: User canceled. (-128)",
      code: 1,
    });
    const { app } = await createApp("tok", { runner: fake, pickFolder: { platform: "darwin" } });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "cancelled" });
    } finally {
      await app.close();
    }
  });

  it("Linux zenity pick trims the trailing newline", async () => {
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "zenity",
      args: ["--file-selection", "--directory"],
      stdout: "/home/me/code/app\n",
      stderr: "",
      code: 0,
    });
    const { app } = await createApp("tok", {
      runner: fake,
      pickFolder: { platform: "linux", env: { DISPLAY: ":0" } },
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "picked", path: "/home/me/code/app" });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].opts.timeoutMs).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("Linux falls back to kdialog when zenity is missing", async () => {
    const seen: string[] = [];
    const runner: CommandRunner = {
      run: async (cmd: string, opts: { args: string[] }): Promise<RunResult> => {
        seen.push(cmd);
        if (cmd === "zenity") throw enoent(cmd);
        if (cmd === "kdialog") {
          expect(opts.args).toEqual(["--getexistingdirectory"]);
          return { stdout: "/home/me/code/kapp\n", stderr: "", code: 0 };
        }
        throw new Error(`unexpected command: ${cmd}`);
      },
    };
    const { app } = await createApp("tok", {
      runner,
      pickFolder: { platform: "linux", env: { DISPLAY: ":0" } },
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "picked", path: "/home/me/code/kapp" });
      expect(seen).toEqual(["zenity", "kdialog"]);
    } finally {
      await app.close();
    }
  });

  it("Linux cancel (exit 1, empty output) reports cancelled", async () => {
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: "zenity", stdout: "", stderr: "", code: 1 });
    const { app } = await createApp("tok", {
      runner: fake,
      pickFolder: { platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } },
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "cancelled" });
    } finally {
      await app.close();
    }
  });

  it("Linux with neither tool reports unavailable", async () => {
    const runner: CommandRunner = {
      run: async (cmd: string): Promise<RunResult> => {
        throw enoent(cmd);
      },
    };
    const { app } = await createApp("tok", {
      runner,
      pickFolder: { platform: "linux", env: { DISPLAY: ":0" } },
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as PickFolderResponse;
      expect(body.status).toBe("unavailable");
      if (body.status === "unavailable") expect(body.reason).toMatch(/zenity|kdialog/);
    } finally {
      await app.close();
    }
  });

  it("Linux with no display reports unavailable without spawning anything", async () => {
    const fake = new FakeCommandRunner();
    const { app } = await createApp("tok", { runner: fake, pickFolder: { platform: "linux", env: {} } });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as PickFolderResponse;
      expect(body.status).toBe("unavailable");
      if (body.status === "unavailable") expect(body.reason).toMatch(/DISPLAY/);
      // Nothing spawned that could hang on a headless machine.
      expect(fake.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("other platforms report unavailable without spawning", async () => {
    const fake = new FakeCommandRunner();
    const { app } = await createApp("tok", { runner: fake, pickFolder: { platform: "win32" } });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/pick-folder",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "unavailable" });
      expect(fake.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("a second pick while one is open gets 409 instead of stacking dialogs", async () => {
    let runs = 0;
    let resolvePick!: (res: RunResult) => void;
    const gate = new Promise<RunResult>((resolve) => {
      resolvePick = resolve;
    });
    const runner: CommandRunner = {
      run: async (cmd: string): Promise<RunResult> => {
        runs += 1;
        if (cmd === "osascript") return gate;
        throw new Error(`unexpected command: ${cmd}`);
      },
    };
    const { app } = await createApp("tok", { runner, pickFolder: { platform: "darwin" } });
    const authed = { authorization: "Bearer tok" };
    try {
      const first = app.inject({ method: "POST", url: "/api/repos/pick-folder", headers: authed });
      // Let the first request reach the handler and open its dialog.
      await new Promise((r) => setImmediate(r));
      const second = await app.inject({ method: "POST", url: "/api/repos/pick-folder", headers: authed });
      expect(second.statusCode).toBe(409);
      expect(runs).toBe(1);

      // The guard releases when the first dialog closes: a new pick runs.
      resolvePick({ stdout: "/tmp/picked\n", stderr: "", code: 0 });
      const done = await first;
      expect(done.statusCode).toBe(200);
      expect(done.json()).toEqual({ status: "picked", path: "/tmp/picked" });

      const after = await app.inject({ method: "POST", url: "/api/repos/pick-folder", headers: authed });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual({ status: "picked", path: "/tmp/picked" });
      expect(runs).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("requires the install token like other mutating routes", async () => {
    const fake = new FakeCommandRunner();
    const { app } = await createApp("tok", { runner: fake, pickFolder: { platform: "darwin" } });
    try {
      const res = await app.inject({ method: "POST", url: "/api/repos/pick-folder" });
      expect(res.statusCode).toBe(401);
      expect(fake.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
