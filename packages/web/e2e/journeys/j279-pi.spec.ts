/** J279 (#279): pi provider — pickers, a review run on the fake pi, Doctor. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const FAKE_PI = fileURLToPath(new URL("../../../service/test/fake-pi.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));

/** Fake `pi` on PATH: the bundled RPC fake answering from the fixture recordings. */
function writeFakePi(binDir: string): void {
  const script = `#!/bin/sh\nexec "${process.execPath}" "${FAKE_PI}" "$@"\n`;
  writeFileSync(path.join(binDir, "pi"), script, { mode: 0o755 });
}

/**
 * Blocking agent stubs: `claude`, `codex` and `pi` that log every call,
 * print "blocked in tests" and answer `--version` with a fake version.
 * They must succeed (exit 0), not fail: diagnostics probes every PATH
 * candidate and skips broken ones, and the ACP adapter falls back to its
 * bundled binary when its override fails — either would execute a real
 * binary (a real `claude` startup writes first-run files and breaks the
 * temp guard). Answered first on PATH, the stubs are chosen and nothing
 * real ever runs. Every line appended is `<name> <args>`.
 */
function writeBlockedStubs(blockedDir: string, logFile: string): void {
  for (const name of ["claude", "codex", "pi"]) {
    const script = `#!/bin/sh\necho "${name} $*" >> "${logFile}"\necho "blocked in tests: ${name}" >&2\nif [ "$1" = "--version" ]; then echo "0.0.0-blocked"; exit 0; fi\nexit 1\n`;
    writeFileSync(path.join(blockedDir, name), script, { mode: 0o755 });
  }
}

function readBlockedLog(logFile: string): string[] {
  try {
    return readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Assert /api/diagnostics probed and chose only the expected binaries for
 * claude/codex/pi (issue #300, option A). With explicit overrides the
 * service never enumerates PATH, so exactly one candidate per tool proves
 * no real install was executed — by version probes, shim resolution, or
 * adapter sessions. A missing override (plain pi) must be the lone
 * candidate with a null choice.
 */
async function expectDiagnosedOnly(
  target: RunningService,
  expected: { tool: "claude" | "codex" | "pi"; candidates: string[]; chosen: string | null }[],
): Promise<void> {
  const res = await apiJson(target, "GET", "/api/diagnostics");
  expect(res.status).toBe(200);
  const tools = (res.json as {
    tools: { tool: string; candidates: { path: string }[]; chosen: string | null }[];
  }).tools;
  for (const { tool, candidates, chosen } of expected) {
    const t = tools.find((t) => t.tool === tool);
    expect(t, `${tool} diagnosed`).toBeDefined();
    expect(t!.candidates.map((c) => c.path)).toEqual(candidates);
    expect(t!.chosen).toBe(chosen);
  }
}

test.describe("J279 pi provider", () => {
  let binDir = "", blockedDir = "", blockedLog = "", dataDir = "", plainDir = "", scratchHome = "";
  let svc: RunningService | null = null;
  let plain: RunningService | null = null;

  test.beforeAll(async () => {
    binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-bin-"));
    writeFakePi(binDir);
    blockedDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-blocked-"));
    blockedLog = path.join(blockedDir, "calls.log");
    writeBlockedStubs(blockedDir, blockedLog);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-data-"));
    plainDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-plain-"));
    // Hermetic home: the service's login-shell PATH probe must not pick up
    // a real pi from the developer machine (shared box). The fake stays
    // first on the inherited PATH, so detection, Doctor and login probes
    // all see the fake only — no login, no spend.
    scratchHome = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-home-"));
    svc = await startService(dataDir, {
      liveRunner: true,
      label: "j279-pi",
      // Fixed port (not ephemeral): the service's MCP mount URL is built
      // from UNVIBE_PORT, and `:0` would leave agent sessions with dead
      // review-tool URLs.
      port: "4529",
      extraEnv: {
        HOME: scratchHome,
        // Fake pi first, then the blocking stubs, then the rest: no real
        // agent binary is reachable even if settings fall back to
        // claude/codex or a login-shell PATH is applied.
        PATH: `${binDir}${path.delimiter}${blockedDir}${path.delimiter}${process.env.PATH ?? ""}`,
        // Issue #300, option A: pin the agent binaries to the fakes via
        // explicit overrides. An override is probed exclusively (no PATH
        // enumeration, so real installs are never even executed) and is
        // honoured even when "broken", so adapters drive the stubs,
        // which refuse loudly, instead of real CLIs.
        UNVIBE_CLAUDE_BIN: path.join(blockedDir, "claude"),
        UNVIBE_CODEX_BIN: path.join(blockedDir, "codex"),
        UNVIBE_PI_BIN: path.join(binDir, "pi"),
        UNVIBE_FAKE_PI_MODE: "replay",
        UNVIBE_FAKE_PI_FIXTURES: FIXTURES,
        // The fake reports its version from here; 1.4.0 meets the minimum.
        UNVIBE_FAKE_PI_VERSION: "1.4.0",
        UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "openai-codex", id: "gpt-fake-1", name: "Fake 1" }]),
        UNVIBE_FAKE_PI_THINKING: JSON.stringify(["low", "high"]),
      },
    });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    await plain?.stop().catch(() => {});
    for (const d of [binDir, blockedDir, dataDir, plainDir]) rmSync(d, { recursive: true, force: true });
    // Scratch HOME last, with retries: an async first-run flush can
    // recreate entries mid-cleanup (ENOTEMPTY on a bare rmSync, which
    // throws instead of retrying). Anything still present afterwards
    // fails loudly below via the per-run temp guard.
    for (let i = 0; i < 5 && existsSync(scratchHome); i++) {
      try {
        rmSync(scratchHome, { recursive: true, force: true });
      } catch {
        // Best effort per attempt; the existsSync check decides.
      }
      if (existsSync(scratchHome)) await new Promise((r) => setTimeout(r, 1000));
    }
    if (existsSync(scratchHome)) {
      throw new Error(`scratch HOME still present after cleanup: ${scratchHome}`);
    }
  });

  test("providers list pi; settings pickers offer it with models and effort; doctor reports it", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");

    const providers = (await apiJson(svc, "GET", "/api/providers")).json as { providers: string[] };
    expect(providers.providers).toContain("pi");

    const models = (await apiJson(svc, "GET", "/api/models?provider=pi")).json as {
      models: { id: string }[];
    };
    expect(models.models.length).toBeGreaterThan(0);
    const modelId = models.models[0].id;

    const thinking = (await apiJson(svc, "GET", "/api/thinking?provider=pi")).json as {
      options: { value: string }[];
    };
    expect(thinking.options.length).toBeGreaterThan(0);

    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-main"]')).toBeVisible({ timeout: 30_000 });

    // pi is offered alongside claude/codex while detected.
    await page.locator("#prov-main").click();
    const providerOptions = openPopup(page).getByRole("option");
    await expect(providerOptions.first()).toBeVisible({ timeout: 15_000 });
    const providerNames = await providerOptions.evaluateAll((os) => os.map((o) => (o.textContent ?? "").replace("✓", "").trim()));
    expect(providerNames).toContain("pi");
    await page.keyboard.press("Escape");

    // Pick pi for main and small; the fake's models save.
    for (const role of ["main", "small"] as const) {
      await page.locator(`#prov-${role}`).click();
      const target = openPopup(page).getByRole("option", { name: "pi" });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      const saveModel = page.waitForResponse(
        (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
        { timeout: 15_000 },
      );
      await page.locator(`#model-${role}`).click();
      const modelOption = openPopup(page).getByRole("option").filter({ hasText: modelId });
      await modelOption.first().scrollIntoViewIfNeeded();
      await modelOption.first().click();
      await saveModel;
    }
    await expect(page.locator("#model-main")).toContainText(modelId, { timeout: 15_000 });

    // Thinking levels come from pi's adapter (#172).
    await expect(page.locator("#effort-main")).not.toContainText("Couldn't load thinking levels", { timeout: 15_000 });

    // Doctor reports pi installed and logged in, in plain words.
    await page.goto(`${svc.origin}/doctor?token=${svc.token}`);
    await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("doctor-check-pi")).toContainText("logged in", { timeout: 30_000 });
    await expect(page.getByTestId("doctor-tool-pi")).toContainText("fake-pi", { timeout: 30_000 });
  });

  test("a review runs on pi and the guide fills", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Self-contained: pin main+small to the fake pi through the API so this
    // test never depends on the picker test above (and never touches a real
    // agent when run alone).
    const models = (await apiJson(svc, "GET", "/api/models?provider=pi")).json as { models: { id: string }[] };
    const modelId = models.models[0].id;
    const saved = await apiJson(svc, "PUT", "/api/settings", {
      main: { provider: "pi", model: modelId, effort: "" },
      small: { provider: "pi", model: modelId, effort: "" },
    });
    expect(saved.status).toBe(200);
    const reviewId = await createDemoReview(svc, 180_000);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
  });

  test("without pi on PATH the pickers go back to claude/codex", async ({ page }) => {
    test.setTimeout(120_000);
    // Deterministic absence whatever the machine has installed: an
    // override pointing nowhere hides the provider. Blocking stubs stand
    // in for claude/codex/pi so nothing real is reachable here either.
    plain = await startService(plainDir, {
      liveRunner: true,
      label: "j279-plain",
      port: "4530",
      extraEnv: {
        HOME: scratchHome,
        PATH: `${blockedDir}${path.delimiter}${process.env.PATH ?? ""}`,
        UNVIBE_PI_BIN: path.join(plainDir, "no-such-pi"),
        // Same pinning as the main service (issue #300, option A): real
        // claude/codex installs must not be probed or driven here either.
        UNVIBE_CLAUDE_BIN: path.join(blockedDir, "claude"),
        UNVIBE_CODEX_BIN: path.join(blockedDir, "codex"),
      },
    });
    const providers = (await apiJson(plain, "GET", "/api/providers")).json as { providers: string[] };
    expect(providers.providers).not.toContain("pi");
    await page.goto(`${plain.origin}/settings?token=${plain.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    await page.locator("#prov-main").click();
    const providerOptions = openPopup(page).getByRole("option");
    await expect(providerOptions.first()).toBeVisible({ timeout: 15_000 });
    const providerNames = await providerOptions.evaluateAll((os) => os.map((o) => (o.textContent ?? "").replace("✓", "").trim()));
    expect(providerNames).not.toContain("pi");
  });

  test("only stubs and the fake are probed or chosen (no real agent binary runs)", async () => {
    // Runs last: both services above are still up. Issue #300, option A:
    // the services pin claude/codex/pi to the stubs/fake via explicit
    // overrides, and an override is probed exclusively — no PATH
    // enumeration, so a real install is never executed by a version
    // probe, a shim resolution, or an adapter session. The diagnostics
    // report is the direct signal: every probed candidate and the choice
    // must be a stub/fake path. The calls log below is the backstop: only
    // `--version` probes may have reached the stubs.
    if (!svc) throw new Error("no service");
    const claudeStub = path.join(blockedDir, "claude");
    const codexStub = path.join(blockedDir, "codex");
    const fakePi = path.join(binDir, "pi");
    await expectDiagnosedOnly(svc, [
      { tool: "claude", candidates: [claudeStub], chosen: claudeStub },
      { tool: "codex", candidates: [codexStub], chosen: codexStub },
      { tool: "pi", candidates: [fakePi], chosen: fakePi },
    ]);
    if (plain) {
      const missingPi = path.join(plainDir, "no-such-pi");
      await expectDiagnosedOnly(plain, [
        { tool: "claude", candidates: [claudeStub], chosen: claudeStub },
        { tool: "codex", candidates: [codexStub], chosen: codexStub },
        { tool: "pi", candidates: [missingPi], chosen: null },
      ]);
    }
    const calls = readBlockedLog(blockedLog);
    // Full file: both services ran, so probes must have happened (this
    // proves the blockers are on PATH and refusing). Under --grep only
    // this test runs and the log may be empty — the assertions below
    // still hold either way.
    if (plain) expect(calls.length).toBeGreaterThan(0);
    // Option A points the adapters at the stubs, so adapter bootstrap
    // reaches them too — and is refused (exit 1). Only these stub
    // interactions are expected: version probes, the adapter's login
    // and transport checks, and refused session setups. Anything else
    // would mean real work was attempted outside the fake.
    const unexpected = calls.filter(
      (l) =>
        !/^(claude|codex|pi) --version$/.test(l) &&
        !/^claude auth status --json$/.test(l) &&
        !/^codex app-server$/.test(l) &&
        !/^claude --output-format stream-json --verbose --input-format stream-json /.test(l),
    );
    expect(unexpected).toEqual([]);
  });
});
