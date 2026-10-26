/** J279 (#279): pi provider — pickers, a review run on the fake pi, Doctor. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test.describe("J279 pi provider", () => {
  let binDir = "", dataDir = "", plainDir = "", scratchHome = "";
  let svc: RunningService | null = null;
  let plain: RunningService | null = null;

  test.beforeAll(async () => {
    binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j279-bin-"));
    writeFakePi(binDir);
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
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        UNVIBE_FAKE_PI_MODE: "replay",
        UNVIBE_FAKE_PI_FIXTURES: FIXTURES,
        UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "openai-codex", id: "gpt-fake-1", name: "Fake 1" }]),
        UNVIBE_FAKE_PI_THINKING: JSON.stringify(["low", "high"]),
      },
    });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    await plain?.stop().catch(() => {});
    for (const d of [binDir, dataDir, plainDir, scratchHome]) rmSync(d, { recursive: true, force: true });
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
    // override pointing nowhere hides the provider.
    plain = await startService(plainDir, {
      liveRunner: true,
      label: "j279-plain",
      port: "4530",
      extraEnv: { UNVIBE_PI_BIN: path.join(plainDir, "no-such-pi") },
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
});
